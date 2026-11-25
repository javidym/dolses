/* Almacenamiento de datos.
 * - Lectura pública: data/datos.json del repositorio (vía API de GitHub para tenerlo
 *   al instante; si falla, la copia publicada en GitHub Pages).
 * - Escritura: solo en modo edición. La clave de acceso a GitHub está cifrada en
 *   data/config.json con la contraseña de edición (AES-GCM + PBKDF2), así que solo
 *   quien conoce la contraseña puede guardar cambios.
 */
const Store = (() => {
  const DATA_PATH = 'data/datos.json';
  const CONFIG_PATH = 'data/config.json';
  const LS_DATA = 'sustituciones.datos';
  const LS_SESSION = 'sustituciones.sesion';
  const ITER = 250000;

  let config = {};
  let data = null;
  let sha = null;
  let token = null;
  let password = null;
  let dirty = new Set();
  let saveTimer = null;
  let saving = false;
  let listeners = [];

  const enc = new TextEncoder();
  const dec = new TextDecoder();

  /* ---------- utilidades ---------- */
  const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const utf8ToB64 = (str) => {
    const bytes = enc.encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  };
  const b64ToUtf8 = (s) => dec.decode(unb64(s.replace(/\n/g, '')));

  function emit(type, detail) { listeners.forEach((fn) => fn(type, detail)); }

  async function deriveBits(pw, saltB64, bits = 256) {
    const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits', 'deriveKey']);
    return crypto.subtle.deriveBits({ name: 'PBKDF2', salt: unb64(saltB64), iterations: ITER, hash: 'SHA-256' }, key, bits);
  }
  async function aesKey(pw, saltB64) {
    const raw = await deriveBits(pw, saltB64);
    return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  }
  function randomB64(n) { return b64(crypto.getRandomValues(new Uint8Array(n))); }

  async function makeVerifier(pw) {
    const salt = randomB64(16);
    return { salt, hash: b64(await deriveBits(pw, salt)) };
  }
  async function checkPassword(pw) {
    if (!config.clave) return false;
    const h = b64(await deriveBits(pw, config.clave.salt));
    return h === config.clave.hash;
  }
  async function encryptToken(tok, pw) {
    const salt = randomB64(16);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(pw, salt), enc.encode(tok));
    return { salt, iv: b64(iv), ct: b64(ct) };
  }
  async function decryptToken(pw) {
    const t = config.token;
    if (!t) return null;
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(t.iv) }, await aesKey(pw, t.salt), unb64(t.ct));
    return dec.decode(pt);
  }

  /* ---------- GitHub ---------- */
  function repoInfo() {
    if (config.owner && config.repo) return { owner: config.owner, repo: config.repo, branch: config.branch || 'main' };
    // Deducirlo de usuario.github.io/repositorio
    const m = location.hostname.match(/^([^.]+)\.github\.io$/i);
    if (m) {
      const repo = location.pathname.split('/').filter(Boolean)[0];
      if (repo) return { owner: m[1], repo, branch: 'main' };
    }
    return null;
  }
  function apiUrl(path) {
    const r = repoInfo();
    return `https://api.github.com/repos/${r.owner}/${r.repo}/contents/${path}?ref=${r.branch}`;
  }
  function headers(tok) {
    const h = { Accept: 'application/vnd.github+json' };
    if (tok) h.Authorization = 'Bearer ' + tok;
    return h;
  }
  async function ghGet(path, tok) {
    const res = await fetch(apiUrl(path) + '&_=' + Date.now(), { headers: headers(tok), cache: 'no-store' });
    if (!res.ok) throw new Error('GitHub ' + res.status);
    const j = await res.json();
    return { sha: j.sha, text: b64ToUtf8(j.content) };
  }
  async function ghPut(path, text, fileSha, message, tok) {
    const r = repoInfo();
    const body = { message, content: utf8ToB64(text), branch: r.branch };
    if (fileSha) body.sha = fileSha;
    const res = await fetch(`https://api.github.com/repos/${r.owner}/${r.repo}/contents/${path}`, {
      method: 'PUT', headers: { ...headers(tok), 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = new Error('GitHub ' + res.status);
      err.status = res.status;
      throw err;
    }
    const j = await res.json();
    return j.content.sha;
  }

  /* ---------- carga ---------- */
  async function loadConfig() {
    try {
      const res = await fetch(CONFIG_PATH + '?_=' + Date.now(), { cache: 'no-store' });
      config = res.ok ? await res.json() : {};
    } catch { config = {}; }
    // La versión del repositorio manda (por si se acaba de cambiar la clave)
    if (repoInfo()) {
      try { config = JSON.parse((await ghGet(CONFIG_PATH)).text); } catch { /* usar la publicada */ }
    }
  }

  async function loadData() {
    let loaded = null;
    if (repoInfo()) {
      try {
        const r = await ghGet(DATA_PATH, token);
        loaded = JSON.parse(r.text);
        sha = r.sha;
      } catch { /* límite de la API o sin conexión: probar la copia publicada */ }
    }
    if (!loaded) {
      try {
        const res = await fetch(DATA_PATH + '?_=' + Date.now(), { cache: 'no-store' });
        if (res.ok) loaded = await res.json();
      } catch { /* sin conexión */ }
    }
    if (!loaded) {
      try { loaded = JSON.parse(localStorage.getItem(LS_DATA)); } catch { /* nada */ }
    }
    // En local (sin GitHub) se conservan los cambios hechos en este navegador
    if (!repoInfo()) {
      try {
        const local = JSON.parse(localStorage.getItem(LS_DATA));
        if (local && (!loaded || (local.actualizado || '') > (loaded.actualizado || ''))) loaded = local;
      } catch { /* nada */ }
    }
    data = normalize(loaded || {});
    cacheLocal();
    return data;
  }

  function normalize(d) {
    d.version = d.version || 1;
    d.ajustes = d.ajustes || {};
    d.ajustes.mesesIntensivos = d.ajustes.mesesIntensivos || [6, 9];
    d.ajustes.horarios = d.ajustes.horarios || { normal: [], intensivo: [] };
    d.personal = d.personal || [];
    d.grupos = d.grupos || {};
    d.calendario = d.calendario || {};
    d.dias = d.dias || {};
    return d;
  }

  function cacheLocal() {
    try { localStorage.setItem(LS_DATA, JSON.stringify(data)); } catch { /* sin almacenamiento */ }
  }

  /* ---------- guardado ---------- */
  // key: 'personal' | 'grupos' | 'ajustes' | 'calendario:YYYY-MM-DD' | 'dias:YYYY-MM-DD'
  function markDirty(key) {
    dirty.add(key);
    data.actualizado = new Date().toISOString();
    cacheLocal();
    emit('dirty');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 1200);
  }

  function applyDirty(remote, keys) {
    const merged = normalize(remote);
    for (const k of keys) {
      const [part, sub] = k.split(':');
      if (sub) {
        if (data[part][sub] === undefined) delete merged[part][sub];
        else merged[part][sub] = data[part][sub];
      } else {
        merged[part] = data[part];
      }
    }
    merged.actualizado = data.actualizado;
    return merged;
  }

  async function save() {
    if (!dirty.size) return;
    if (!canSync()) { dirty.clear(); emit('saved', { local: true }); return; }
    if (saving) { clearTimeout(saveTimer); saveTimer = setTimeout(save, 800); return; }
    saving = true;
    const keys = [...dirty];
    dirty.clear();
    emit('saving');
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const text = JSON.stringify(data, null, 1);
          sha = await ghPut(DATA_PATH, text, sha, 'Sustituciones: actualización ' + new Date().toLocaleString('es-ES'), token);
          emit('saved', {});
          return;
        } catch (e) {
          if (e.status === 409 || e.status === 422) {
            // Otro dispositivo guardó antes: mezclar y reintentar
            const r = await ghGet(DATA_PATH, token);
            sha = r.sha;
            data = applyDirty(JSON.parse(r.text), keys);
            cacheLocal();
            emit('merged');
            continue;
          }
          throw e;
        }
      }
      throw new Error('No se pudo guardar tras varios intentos');
    } catch (e) {
      keys.forEach((k) => dirty.add(k));
      emit('error', e);
      clearTimeout(saveTimer);
      saveTimer = setTimeout(save, 15000);
    } finally {
      saving = false;
    }
  }

  /* ---------- sesión de edición ---------- */
  async function login(pw) {
    if (!(await checkPassword(pw))) return false;
    password = pw;
    try { token = await decryptToken(pw); } catch { token = null; }
    try { sessionStorage.setItem(LS_SESSION, pw); } catch { /* nada */ }
    if (token && repoInfo()) {
      // Releer con la clave para obtener la versión más reciente
      try {
        const r = await ghGet(DATA_PATH, token);
        data = normalize(JSON.parse(r.text));
        sha = r.sha;
        cacheLocal();
      } catch { /* seguir con lo cargado */ }
    }
    return true;
  }
  async function restoreSession() {
    let pw = null;
    try { pw = sessionStorage.getItem(LS_SESSION); } catch { /* nada */ }
    if (pw) return login(pw);
    return false;
  }
  function logout() {
    password = null; token = null;
    try { sessionStorage.removeItem(LS_SESSION); } catch { /* nada */ }
  }

  function canSync() { return !!(token && repoInfo()); }

  async function saveConfig(newConfig, tok) {
    const r = repoInfo();
    if (!r) throw new Error('La aplicación no está publicada en GitHub Pages');
    let cfgSha = null;
    try { cfgSha = (await ghGet(CONFIG_PATH, tok)).sha; } catch { /* nuevo */ }
    await ghPut(CONFIG_PATH, JSON.stringify(newConfig, null, 2), cfgSha, 'Configuración de acceso', tok);
    config = newConfig;
  }

  async function connectGitHub(tok) {
    const r = repoInfo();
    if (!r) throw new Error('La aplicación tiene que estar abierta desde su dirección de GitHub Pages.');
    const res = await fetch(`https://api.github.com/repos/${r.owner}/${r.repo}`, { headers: headers(tok) });
    if (!res.ok) throw new Error('La clave no es válida o no tiene acceso al repositorio.');
    const repo = await res.json();
    if (repo.permissions && repo.permissions.push === false) throw new Error('La clave no tiene permiso de escritura.');
    const newConfig = { ...config, owner: r.owner, repo: r.repo, branch: r.branch, token: await encryptToken(tok, password) };
    await saveConfig(newConfig, tok);
    token = tok;
    const d = await ghGet(DATA_PATH, tok);
    sha = d.sha;
    // Si en este dispositivo hay cambios más recientes que en GitHub, se suben ahora
    const remote = JSON.parse(d.text);
    if ((data.actualizado || '') > (remote.actualizado || '')) markDirty('personal');
    else { data = normalize(remote); cacheLocal(); emit('merged'); }
  }

  async function changePassword(newPw) {
    const newConfig = { ...config, clave: await makeVerifier(newPw) };
    if (token) newConfig.token = await encryptToken(token, newPw);
    if (canSync()) await saveConfig(newConfig, token);
    else config = newConfig;
    password = newPw;
    try { sessionStorage.setItem(LS_SESSION, newPw); } catch { /* nada */ }
  }

  return {
    async init() { await loadConfig(); await loadData(); },
    reload: loadData,
    get data() { return data; },
    replaceData(d) { data = normalize(d); },
    get config() { return config; },
    get editing() { return !!password; },
    get pending() { return dirty.size > 0 || saving; },
    canSync, repoInfo, markDirty, save, login, logout, restoreSession, connectGitHub, changePassword,
    makeVerifier,
    on(fn) { listeners.push(fn); },
  };
})();
