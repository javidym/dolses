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
  const LS_PENDING = 'sustituciones.pendientes';
  const LS_LIMIT = 'sustituciones.limiteApi';
  const ITER = 250000;

  let config = {};
  let data = null;
  let sha = null;
  let token = null;
  let password = null;
  let dirty = new Set();
  let saving = false;
  let source = null;     // de dónde salieron los datos: 'api' | 'pages' | 'local'
  let published = null;  // fecha de la última publicación conocida
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
  // Sin token, GitHub solo permite 60 consultas por hora y por conexión (en el
  // colegio todos los móviles comparten la misma). Si se agotan, no se vuelve a
  // intentar hasta que GitHub renueve el cupo y se usa la copia publicada.
  function apiBlocked() {
    try { return Date.now() < Number(localStorage.getItem(LS_LIMIT) || 0); } catch { return false; }
  }
  function noteRateLimit(res) {
    const left = res.headers.get('x-ratelimit-remaining');
    if (res.status === 403 || res.status === 429 || (left !== null && Number(left) <= 1)) {
      const reset = Number(res.headers.get('x-ratelimit-reset')) * 1000 || Date.now() + 15 * 60000;
      try { localStorage.setItem(LS_LIMIT, String(reset)); } catch { /* nada */ }
    }
  }
  async function ghGet(path, tok) {
    if (!tok && apiBlocked()) throw new Error('Límite de consultas de GitHub');
    const res = await fetch(apiUrl(path) + '&_=' + Date.now(), { headers: headers(tok), cache: 'no-store' });
    if (!tok) noteRateLimit(res);
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
  async function fetchPublished(path) {
    try {
      const res = await fetch(path + '?_=' + Date.now(), { cache: 'no-store' });
      if (res.ok) return await res.json();
    } catch { /* sin conexión */ }
    return null;
  }

  async function loadConfig() {
    config = (await fetchPublished(CONFIG_PATH)) || {};
  }
  // Al entrar en edición se lee la configuración directamente del repositorio
  // (por si se acaba de cambiar la contraseña o el token)
  async function refreshConfig() {
    if (!repoInfo()) return;
    try { config = JSON.parse((await ghGet(CONFIG_PATH)).text); } catch { /* usar la publicada */ }
  }

  // fresh: consultar también la API de GitHub (al instante). Sin fresh solo se mira
  // la copia publicada en GitHub Pages, que tarda 1-2 minutos en ponerse al día.
  async function loadData({ fresh = true } = {}) {
    const fromApi = async () => {
      if (!repoInfo() || (!fresh && !token)) return null;
      try {
        const r = await ghGet(DATA_PATH, token);
        return { d: JSON.parse(r.text), sha: r.sha };
      } catch { return null; }
    };
    const [api, pages] = await Promise.all([fromApi(), fetchPublished(DATA_PATH)]);
    let loaded = null;
    source = null;
    if (api) { loaded = api.d; sha = api.sha; source = 'api'; }
    // Quedarse con la versión más reciente de las dos
    if (pages && (!loaded || (pages.actualizado || '') > (loaded.actualizado || ''))) { loaded = pages; source = 'pages'; }
    published = loaded ? loaded.actualizado || null : published;
    let local = null;
    try { local = JSON.parse(localStorage.getItem(LS_DATA)); } catch { /* nada */ }
    if (!loaded) { loaded = local; source = 'local'; }
    // Borrador sin publicar de este dispositivo: se conserva encima de lo publicado
    const pending = loadPending();
    dirty = new Set(pending);
    if (pending.length && local && loaded && loaded !== local) loaded = mergeKeys(loaded, local, pending);
    // En local (sin GitHub) se conservan los cambios hechos en este navegador
    if (!repoInfo() && local && (!loaded || (local.actualizado || '') > (loaded.actualizado || ''))) loaded = local;
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

  /* ---------- borrador y publicación ----------
   * Los cambios se guardan como borrador en este dispositivo y solo llegan
   * a todos cuando se pulsa «Publicar para todos». */
  // key: 'personal' | 'grupos' | 'ajustes' | 'calendario:YYYY-MM-DD' | 'dias:YYYY-MM-DD'
  function persistPending() {
    try { localStorage.setItem(LS_PENDING, JSON.stringify([...dirty])); } catch { /* sin almacenamiento */ }
  }
  function loadPending() {
    try { return JSON.parse(localStorage.getItem(LS_PENDING)) || []; } catch { return []; }
  }

  function markDirty(key) {
    dirty.add(key);
    data.actualizado = new Date().toISOString();
    persistPending();
    cacheLocal();
    emit('dirty');
  }

  // Parte de la versión remota y le aplica las partes cambiadas en local
  function mergeKeys(remote, local, keys) {
    const merged = normalize(remote);
    for (const k of keys) {
      const [part, sub] = k.split(':');
      if (sub) {
        if (!local[part] || local[part][sub] === undefined) delete merged[part][sub];
        else merged[part][sub] = local[part][sub];
      } else if (local[part] !== undefined) {
        merged[part] = local[part];
      }
    }
    if (local.curso) merged.curso = local.curso;
    merged.actualizado = local.actualizado;
    return merged;
  }

  function err(code, message) { const e = new Error(message); e.code = code; return e; }

  async function publish() {
    if (!dirty.size) return false;
    if (!repoInfo()) throw err('LOCAL', 'La aplicación no está publicada en GitHub Pages.');
    if (!token) throw err('NO_TOKEN', 'Falta conectar la aplicación con GitHub.');
    if (saving) throw err('BUSY', 'Ya se está publicando…');
    saving = true;
    const keys = [...dirty];
    emit('saving');
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        // Partir siempre de lo último publicado para no pisar cambios de otros dispositivos
        const r = await ghGet(DATA_PATH, token);
        sha = r.sha;
        data = mergeKeys(JSON.parse(r.text), data, keys);
        try {
          sha = await ghPut(DATA_PATH, JSON.stringify(data, null, 1), sha, 'Sustituciones publicadas ' + new Date().toLocaleString('es-ES'), token);
          keys.forEach((k) => dirty.delete(k));
          persistPending();
          cacheLocal();
          published = data.actualizado;
          source = 'api';
          emit('saved');
          return true;
        } catch (e) {
          if (e.status === 409 || e.status === 422) continue;
          if (e.status === 401 || e.status === 403) throw err('AUTH', 'GitHub ha rechazado la clave (puede haber caducado). Vuelve a conectarla en Ajustes › Acceso y datos.');
          throw e;
        }
      }
      throw err('RETRY', 'No se pudo publicar tras varios intentos.');
    } catch (e) {
      emit('error', e);
      throw e.code ? e : err('NET', 'No se pudo conectar con GitHub. Comprueba la conexión a internet.');
    } finally {
      saving = false;
    }
  }

  /* ---------- sesión de edición ---------- */
  async function login(pw) {
    // Si la clave no coincide con la copia publicada, comprobar la del repositorio
    // por si se acaba de cambiar la contraseña o conectar el token
    if (!(await checkPassword(pw))) {
      await refreshConfig();
      if (!(await checkPassword(pw))) return false;
    } else if (!config.token) {
      await refreshConfig();
    }
    password = pw;
    try { token = await decryptToken(pw); } catch { token = null; }
    try { sessionStorage.setItem(LS_SESSION, pw); } catch { /* nada */ }
    if (token && repoInfo()) {
      // Releer con la clave para obtener la versión más reciente
      try {
        const r = await ghGet(DATA_PATH, token);
        const remote = JSON.parse(r.text);
        data = mergeKeys(remote, data, [...dirty]);
        sha = r.sha;
        published = remote.actualizado || published;
        source = 'api';
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
    tok = tok.replace(/\s+/g, '');
    if (!/^(github_pat_|ghp_)/.test(tok)) throw new Error('Eso no parece un token de GitHub: debe empezar por «github_pat_». Cópialo con el botón 📋 de GitHub.');
    const res = await fetch(`https://api.github.com/repos/${r.owner}/${r.repo}`, { headers: headers(tok) });
    if (res.status === 401) throw new Error(`GitHub no reconoce este token (error 401). Está incompleto, es antiguo o se regeneró después de copiarlo. Genera uno nuevo con «Regenerate token», cópialo con el botón 📋 y pégalo aquí (tiene ${tok.length} caracteres; uno correcto tiene unos 93).`);
    if (!res.ok) throw new Error(`GitHub ha rechazado el token (error ${res.status}).`);
    const repo = await res.json();
    if (repo.permissions && repo.permissions.push === false) throw new Error(`El token funciona pero no tiene permiso para escribir en «${r.repo}». En GitHub, edita el token: Repository access → ${r.repo}, y Contents → Read and write.`);
    const newConfig = { ...config, owner: r.owner, repo: r.repo, branch: r.branch, token: await encryptToken(tok, password) };
    await saveConfig(newConfig, tok);
    token = tok;
    const d = await ghGet(DATA_PATH, tok);
    sha = d.sha;
    // Partir de lo publicado conservando el borrador de este dispositivo
    data = mergeKeys(JSON.parse(d.text), data, [...dirty]);
    cacheLocal();
    emit('merged');
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
    get pendingCount() { return dirty.size; },
    get publishing() { return saving; },
    get publishedAt() { return published; },
    get source() { return source; },
    get apiLimited() { return !token && apiBlocked(); },
    canSync, repoInfo, markDirty, publish, login, logout, restoreSession, connectGitHub, changePassword,
    makeVerifier,
    on(fn) { listeners.push(fn); },
  };
})();
