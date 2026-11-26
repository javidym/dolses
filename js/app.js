/* Sustituciones · CEIP Los Dolses */
(() => {
  'use strict';

  const CATS = [
    { id: 'especialista', name: 'Especialistas' },
    { id: 'apoyo', name: 'Apoyos de Infantil' },
    { id: 'tutor', name: 'Tutores y tutoras' },
    { id: 'inclusion', name: 'PT · AL · Orientación' },
    { id: 'direccion', name: 'Equipo directivo' },
    { id: 'otros', name: 'Otros docentes' },
    { id: 'nodocente', name: 'Personal no docente' },
  ];
  const CAT_ORDER = Object.fromEntries(CATS.map((c, i) => [c.id, i]));
  const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const uid = () => Math.random().toString(36).slice(2, 9);
  const ICON = {
    x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
    clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v5h1"/></svg>',
    left: '<svg viewBox="0 0 24 24"><path d="m15 5-7 7 7 7"/></svg>',
    right: '<svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></svg>',
  };

  const state = {
    date: null,
    selected: null, // id del maestro/a elegido para asignar tocando
    query: '',
  };

  /* ================= utilidades de datos ================= */
  const D = () => Store.data;
  const pad = (n) => String(n).padStart(2, '0');
  const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fromISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const isWeekend = (s) => [0, 6].includes(fromISO(s).getDay());
  function shiftSchoolDay(s, dir) {
    const d = fromISO(s);
    do { d.setDate(d.getDate() + dir); } while ([0, 6].includes(d.getDay()));
    return toISO(d);
  }
  function defaultDate() {
    const now = new Date();
    let s = toISO(now);
    if (isWeekend(s)) s = shiftSchoolDay(s, 1);
    return s;
  }
  const longDate = (s) => fromISO(s).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  // Valor especial para las horas en las que no hace falta que sustituya nadie
  const NONE = '-';
  const NONE_PERSON = { id: NONE, nombre: 'Nadie', cargo: 'No hace falta sustituir', cat: 'none' };
  const staffMap = () => ({ ...Object.fromEntries(D().personal.map((p) => [p.id, p])), [NONE]: NONE_PERSON });
  const shortName = (p) => (p ? p.alias || p.nombre : '¿?');
  const fullName = (p) => (p ? `${p.nombre} ${p.apellidos || ''}`.trim() : 'Persona eliminada');
  const activeStaff = () => D().personal.filter((p) => !p.baja);
  function sortStaff(list) {
    return [...list].sort((a, b) => (CAT_ORDER[a.cat] ?? 9) - (CAT_ORDER[b.cat] ?? 9) || norm(shortName(a)).localeCompare(norm(shortName(b))));
  }
  function matches(p, q) {
    if (!q) return true;
    const hay = norm(`${p.alias || ''} ${p.nombre} ${p.apellidos || ''} ${p.cargo || ''}`);
    return norm(q).split(/\s+/).every((w) => hay.includes(w));
  }

  function slotsFor(date) {
    const m = fromISO(date).getMonth() + 1;
    const h = D().ajustes.horarios;
    return D().ajustes.mesesIntensivos.includes(m) ? h.intensivo : h.normal;
  }
  const isIntensive = (date) => D().ajustes.mesesIntensivos.includes(fromISO(date).getMonth() + 1);
  const calOf = (date) => D().calendario[date] || {};
  function guardOf(date) {
    const g = calOf(date).g;
    if (!g) return null;
    return { num: g, members: (D().grupos[g] || []) };
  }
  function dayOf(date, create) {
    let d = D().dias[date];
    if (!d && create) d = D().dias[date] = { ausencias: [] };
    return d || { ausencias: [] };
  }
  function countsAll() {
    const c = {};
    for (const day of Object.values(D().dias)) {
      for (const a of day.ausencias || []) for (const id of Object.values(a.s || {})) if (id && id !== NONE) c[id] = (c[id] || 0) + 1;
    }
    return c;
  }
  function countsDay(date) {
    const c = {};
    for (const a of dayOf(date).ausencias) for (const id of Object.values(a.s || {})) if (id && id !== NONE) c[id] = (c[id] || 0) + 1;
    return c;
  }

  /* ================= avisos ================= */
  let toastTimer;
  function toast(msg, bad) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.toggle('bad', !!bad);
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  /* ================= modales ================= */
  function modal({ title, body, foot, wide, onClose }) {
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<div class="modal${wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-head"><h3>${esc(title)}</h3><button class="close-x" aria-label="Cerrar">${ICON.x}</button></div>
      <div class="modal-body"></div>${foot ? '<div class="modal-foot"></div>' : ''}</div>`;
    const m = back.firstElementChild;
    const close = () => { back.remove(); document.removeEventListener('keydown', onKey); onClose && onClose(); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
    $('.close-x', m).onclick = close;
    const bodyEl = $('.modal-body', m);
    if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.append(body);
    if (foot) foot($('.modal-foot', m), close);
    $('#modalRoot').append(back);
    return { el: m, body: bodyEl, close };
  }
  function confirmBox(title, text, okText, onOk, danger = true) {
    const m = modal({
      title, body: `<p style="margin:0;font-size:1.02rem">${text}</p>`,
      foot: (f, close) => {
        f.innerHTML = `<button class="btn btn-outline">Cancelar</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}">${esc(okText)}</button>`;
        f.children[0].onclick = close;
        f.children[1].onclick = () => { close(); onOk(); };
      },
    });
    m.el.querySelector('.btn-danger, .btn-primary').focus();
  }

  /* ================= cabecera de día ================= */
  function renderDay() {
    const date = state.date;
    $('#dateText').textContent = longDate(date);
    $('#dateInput').value = date;
    const map = staffMap();
    const cal = calOf(date);
    const g = guardOf(date);
    const gc = $('#guardCard');
    gc.className = 'guard';
    if (isWeekend(date)) {
      gc.classList.add('none');
      gc.innerHTML = `<div class="guard-num">–</div><div class="guard-body"><div class="guard-title">Grupo de guardia</div><div class="guard-members">Fin de semana</div></div>`;
    } else if (cal.festivo) {
      gc.classList.add('none', 'holiday');
      gc.innerHTML = `<div class="guard-num">–</div><div class="guard-body"><div class="guard-title">Grupo de guardia</div><div class="guard-members">Día no lectivo</div></div>`;
    } else if (g) {
      const names = g.members.map((id) => map[id]).filter(Boolean)
        .map((p) => `${esc(shortName(p))} <small>(${esc(p.cargo || '')})</small>`).join(', ');
      gc.innerHTML = `<div class="guard-num" aria-label="Grupo ${esc(g.num)}">${esc(g.num)}</div><div class="guard-body"><div class="guard-title">Grupo de guardia de hoy</div><div class="guard-members">${names || 'Grupo sin miembros asignados'}</div></div>`;
    } else {
      gc.classList.add('none');
      gc.innerHTML = `<div class="guard-num">?</div><div class="guard-body"><div class="guard-title">Grupo de guardia</div><div class="guard-members">Sin grupo asignado en el calendario</div></div>`;
    }

    const notes = [];
    if (cal.festivo) notes.push(['red', `Día festivo o no lectivo${cal.nota ? ': ' + esc(cal.nota) : ''}.`]);
    else if (cal.nota) notes.push(['', esc(cal.nota)]);
    if (isIntensive(date) && !isWeekend(date)) notes.push(['blue', `Horario de ${MONTHS[fromISO(date).getMonth()]}: jornada de 9:00 a 13:00.`]);
    $('#dayNotice').innerHTML = notes.map(([c, t]) => `<div class="notice ${c}">${ICON.info}<span>${t}</span></div>`).join('');
  }

  /* ================= acompañamientos UECO =================
   * D().ueco = { alumnos: [{id, nombre, clase}],
   *              semanas: [{ini, fin, a: {idAlumno: idMaestro}}] } */
  const LS_UECO_FOLD = 'sustituciones.uecoPlegado';
  function uecoData() {
    const u = D().ueco || (D().ueco = {});
    u.alumnos = u.alumnos || [];
    u.semanas = u.semanas || [];
    return u;
  }
  const uecoWeek = (date) => uecoData().semanas.find((w) => w.ini <= date && date <= w.fin) || null;
  const shortDate = (iso) => { const d = fromISO(iso); return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`; };
  function renderUeco() {
    const el = $('#ueco');
    const date = state.date;
    const u = uecoData();
    const w = uecoWeek(date);
    if (!w || !u.alumnos.length || isWeekend(date) || calOf(date).festivo) { el.hidden = true; return; }
    const map = staffMap();
    const day = dayOf(date);
    const absent = new Set(day.ausencias.map((a) => a.t));
    let folded = false;
    try { folded = localStorage.getItem(LS_UECO_FOLD) === '1'; } catch { /* nada */ }
    const items = u.alumnos.map((al) => {
      const p = map[(w.a || {})[al.id]];
      const off = p && absent.has(p.id);
      return `<div class="ueco-item${off ? ' off' : ''}${p ? '' : ' empty'}" title="${esc(al.nombre)} ${esc(al.clase || '')} → ${p ? esc(fullName(p)) + ' · ' + esc(p.cargo || '') : 'sin asignar'}${off ? ' · falta hoy' : ''}">
        <span class="ueco-kid">${esc(al.nombre)}${al.clase ? ` <small>${esc(al.clase)}</small>` : ''}</span>
        <span class="ueco-who"><b>${p ? esc(shortName(p)) : '—'}</b>${p ? `<small>${off ? '⚠ falta hoy' : esc(p.cargo || '')}</small>` : ''}</span>
      </div>`;
    }).join('');
    el.hidden = false;
    el.classList.toggle('folded', folded);
    el.innerHTML = `<button class="ueco-head" aria-expanded="${!folded}">
        <span class="ueco-title">Acompañamientos UECO</span>
        <span class="ueco-week">Semana del ${esc(shortDate(w.ini))} al ${esc(shortDate(w.fin))}</span>
        <span class="ueco-fold">${folded ? 'Mostrar' : 'Ocultar'}</span>
      </button>
      <div class="ueco-list">${items}</div>`;
    $('.ueco-head', el).onclick = () => {
      try { localStorage.setItem(LS_UECO_FOLD, folded ? '0' : '1'); } catch { /* nada */ }
      renderUeco();
      if (present.on && present.auto) fitScreen();
    };
  }

  /* ================= modo pizarra (ajustar a la pantalla) ================= */
  const LS_ZOOM = 'sustituciones.zoomPizarra';
  const present = { on: false, auto: true, zoom: 1 };
  function applyZoom() {
    $('main.wrap').style.zoom = present.on ? String(present.zoom) : '';
    $('#zoomVal').textContent = Math.round(present.zoom * 100) + '%';
  }
  // Buscar el tamaño más grande con el que todo cabe sin hacer scroll
  function fitScreen() {
    if (!present.on) return;
    const doc = document.documentElement;
    let z = 2;
    for (; z > 0.3; z = Math.round((z - 0.05) * 100) / 100) {
      present.zoom = z;
      applyZoom();
      if (doc.scrollHeight <= window.innerHeight + 1 && doc.scrollWidth <= window.innerWidth + 1) break;
    }
    present.auto = true;
  }
  function setPresent(on) {
    present.on = on;
    document.body.classList.toggle('present', on);
    $('#presentBar').hidden = !on;
    if (on) {
      let saved = null;
      try { saved = JSON.parse(localStorage.getItem(LS_ZOOM)); } catch { /* nada */ }
      if (saved && !saved.auto && saved.zoom) { present.auto = false; present.zoom = saved.zoom; applyZoom(); } else fitScreen();
      if (document.documentElement.requestFullscreen && !document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
    } else {
      applyZoom();
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    }
  }
  function zoomBy(d) {
    present.auto = false;
    present.zoom = Math.min(3, Math.max(0.3, Math.round((present.zoom + d) * 100) / 100));
    applyZoom();
    try { localStorage.setItem(LS_ZOOM, JSON.stringify({ auto: false, zoom: present.zoom })); } catch { /* nada */ }
  }
  function initPresent() {
    $('#btnPresent').onclick = () => setPresent(true);
    $('#presentExit').onclick = () => setPresent(false);
    $('#zoomIn').onclick = () => zoomBy(0.1);
    $('#zoomOut').onclick = () => zoomBy(-0.1);
    $('#zoomFit').onclick = () => {
      try { localStorage.removeItem(LS_ZOOM); } catch { /* nada */ }
      fitScreen();
    };
    let t;
    window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => { if (present.on && present.auto) fitScreen(); }, 200); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && present.on && !document.fullscreenElement && !$('#modalRoot').children.length) setPresent(false); });
  }

  /* ================= horas de cada ausencia =================
   * Cada ausencia puede tener:
   *  - a.ocultas: franjas quitadas a mano (solo falta unas horas)
   *  - a.dia: true → todas sus sesiones se muestran en una sola fila «Todo el día»
   *    cuyo sustituto se guarda en a.s.D (el patio sigue aparte) */
  const DAY_KEY = 'D';
  // Franjas de esa ausencia que siguen a la vista, en el orden del horario
  function absSlots(a, date = state.date) {
    const hidden = new Set(a.ocultas || []);
    return slotsFor(date).filter((s) => !hidden.has(s.k));
  }
  function absSessions(a, date) { return absSlots(a, date).filter((s) => !s.patio); }
  // Filas que se pintan en la tarjeta
  function visibleSlots(a, date = state.date) {
    const all = absSlots(a, date);
    if (!a.dia) return all;
    const ses = all.filter((s) => !s.patio);
    if (!ses.length) return all;
    return [{ k: DAY_KEY, ini: ses[0].ini, fin: ses[ses.length - 1].fin, dia: true }, ...all.filter((s) => s.patio)];
  }
  // Quién cubre cada franja real (para detectar solapes entre ausencias)
  function coverage(a, date = state.date) {
    const out = {};
    for (const s of absSlots(a, date)) {
      const id = a.dia && !s.patio ? (a.s || {})[DAY_KEY] : (a.s || {})[s.k];
      if (id && id !== NONE) out[s.k] = id;
    }
    return out;
  }
  // Franjas reales que representa una fila (la de «Todo el día» representa varias)
  const rowKeys = (a, k) => (k === DAY_KEY ? absSessions(a).map((s) => s.k) : [k]);

  /* ================= tablero ================= */
  function renderBoard() {
    const date = state.date;
    const editing = Store.editing;
    const map = staffMap();
    const day = dayOf(date);
    const board = $('#board');
    board.className = 'board ' + (editing ? 'editing-mode' : 'view-mode') + (state.selected ? ' selecting' : '');

    if (!day.ausencias.length) {
      board.innerHTML = `<div class="empty-board"><img src="icons/icon.svg" alt=""><strong>No hay ausencias registradas para este día</strong>${editing ? 'Pulsa «Añadir maestro/a que falta» para empezar.' : '¡Todo el claustro está en su puesto!'}</div>`;
    } else {
      // Quién está ocupado en cada hora (para avisar de solapes)
      const busy = {};
      for (const a of day.ausencias) for (const [k, id] of Object.entries(coverage(a, date))) (busy[k + '|' + id] = busy[k + '|' + id] || []).push(a.t);
      const absentIds = new Set(day.ausencias.map((a) => a.t));

      let html = '<div class="board-grid">';
      for (const a of day.ausencias) {
        const p = map[a.t];
        html += `<div class="absence" data-abs="${a.id}"><div class="abs-head">
          <div class="abs-name">${esc(shortName(p))}</div>
          <div class="abs-role">${esc(p ? p.cargo || '' : '')}</div>
          ${a.nota ? `<div class="abs-note">${esc(a.nota)}</div>` : ''}
          ${editing ? `<div class="abs-actions"><button class="mini-btn" data-act="note">${ICON.edit}Nota</button><button class="mini-btn" data-act="hours">${ICON.clock}Horas</button><button class="mini-btn del" data-act="del">${ICON.trash}Quitar</button></div>` : ''}
        </div>`;
        const rows = visibleSlots(a, date);
        if (!rows.length) html += `<div class="slot-none-left">Sin horas seleccionadas${editing ? ' · pulsa «Horas» para elegirlas' : ''}</div>`;
        for (const s of rows) {
          const sid = (a.s || {})[s.k];
          const sp = sid ? map[sid] : null;
          let inner;
          if (sid === NONE) {
            inner = `<div class="sub none" title="No hace falta que sustituya nadie">
              <span class="sub-name"><span class="none-x" aria-hidden="true">✕</span> Nadie</span>
              <span class="sub-role">No hace falta sustituir</span>
              ${editing ? `<button class="sub-x" data-act="clear" aria-label="Quitar marca">${ICON.x}</button>` : ''}
            </div>`;
          } else if (sid) {
            const clash = rowKeys(a, s.k).some((k) => (busy[k + '|' + sid] || []).length > 1);
            const isAbsent = absentIds.has(sid);
            const warn = clash ? 'Tiene otra sustitución a esta hora' : isAbsent ? 'También está ausente hoy' : '';
            inner = `<div class="sub${warn ? ' conflict' : ''}" title="${esc(fullName(sp))}${warn ? ' · ' + warn : ''}">
              <span class="sub-name">${esc(shortName(sp))}</span>
              <span class="sub-role">${esc(sp ? sp.cargo || '' : '')}</span>
              ${warn ? `<span class="sub-warn">⚠ ${warn}</span>` : ''}
              ${editing ? `<button class="sub-x" data-act="clear" aria-label="Quitar a ${esc(shortName(sp))}">${ICON.x}</button>` : ''}
            </div>`;
          } else {
            inner = `<div class="slot-empty">${editing ? (state.selected ? 'Toca para asignar' : '<span class="only-wide">Arrastra aquí o haz clic</span><span class="only-narrow">Toca para elegir</span>') : '–'}</div>`;
          }
          const kind = s.dia ? 'Todo el día' : s.patio ? 'Patio' : 'Sesión';
          const time = s.dia
            ? `<div class="slot-time">Todo el día<small>${esc(s.ini)} – ${esc(s.fin)}</small></div>`
            : `<div class="slot-time">${esc(s.ini)} – ${esc(s.fin)}<small>${kind}${editing ? ` <button class="slot-hide" data-act="hide" title="Quitar esta hora de la tarjeta">− quitar</button>` : ''}</small></div>`;
          html += `<div class="slot${s.patio ? ' patio' : ''}${s.dia ? ' whole' : ''}" data-slot="${esc(s.k)}" ${editing ? 'tabindex="0" role="button"' : ''} aria-label="${kind} ${esc(s.ini)} a ${esc(s.fin)}">
            ${time}${inner}</div>`;
        }
        html += '</div>';
      }
      html += '</div>';
      board.innerHTML = html;
    }

    const blocked = isWeekend(date) || calOf(date).festivo;
    $('#btnAddAbsence').hidden = !editing || blocked;
    const hint = $('#selectHint');
    if (editing && state.selected) {
      const p = map[state.selected];
      hint.hidden = false;
      hint.innerHTML = `<span>${state.selected === NONE ? 'Toca la hora en la que <b>no hace falta sustituir</b>.' : `Toca la hora en la que sustituirá <b>${esc(shortName(p))}</b>.`}</span><button class="btn btn-outline btn-sm" id="cancelSel">Cancelar</button>`;
      $('#cancelSel').onclick = () => { state.selected = null; renderAll(); };
    } else hint.hidden = true;
  }

  /* ================= panel de sustitutos ================= */
  function substituteCandidates(date) {
    const absent = new Set(dayOf(date).ausencias.map((a) => a.t));
    return activeStaff().filter((p) => p.cat !== 'nodocente' && !absent.has(p.id));
  }
  function chipHTML(p, totals, today) {
    const cat = p.cat || 'otros';
    const t = today[p.id] || 0;
    const n = totals[p.id] || 0;
    return `<button class="chip${state.selected === p.id ? ' selected' : ''}" data-id="${p.id}" style="--c:var(--cat-${cat})" title="${esc(fullName(p))} · ${n} sustituciones este curso${t ? ` · ${t} hoy` : ''}">
      <span class="chip-text"><span class="chip-name">${esc(shortName(p))}</span><span class="chip-role">${esc(p.cargo || '')}${p.alias ? ' · ' + esc(p.nombre) : ''}</span></span>
      ${t || n ? `<span class="chip-count${t ? ' today' : ''}">${t ? t + ' hoy' : n}</span>` : ''}</button>`;
  }
  // Opción fija al principio de la lista: en esa hora no sustituye nadie
  function noneChipHTML() {
    return `<div class="pal-none"><button class="chip chip-none${state.selected === NONE ? ' selected' : ''}" data-id="${NONE}" title="En esa hora no hace falta que sustituya nadie">
      <span class="none-x" aria-hidden="true">✕</span>
      <span class="chip-text"><span class="chip-name">Nadie</span><span class="chip-role">No hace falta sustituir</span></span></button></div>`;
  }
  function groupedListHTML(list, date, q, { guardFirst = true, withNone = false } = {}) {
    const totals = countsAll();
    const today = countsDay(date);
    const filtered = sortStaff(list.filter((p) => matches(p, q)));
    const none = withNone ? noneChipHTML() : '';
    if (!filtered.length) return none + `<div class="no-results">Nadie coincide con «${esc(q)}».</div>`;
    let html = none;
    const g = guardFirst ? guardOf(date) : null;
    const inGuard = new Set(g ? g.members : []);
    const guardList = filtered.filter((p) => inGuard.has(p.id));
    if (guardList.length) {
      html += `<div class="pal-section" style="--c:var(--teal)"><div class="pal-title">De guardia hoy · Grupo ${esc(g.num)}</div><div class="pal-chips">${guardList.map((p) => chipHTML(p, totals, today)).join('')}</div></div>`;
    }
    for (const c of CATS) {
      const items = filtered.filter((p) => (p.cat || 'otros') === c.id && !inGuard.has(p.id));
      if (!items.length) continue;
      html += `<div class="pal-section" style="--c:var(--cat-${c.id})"><div class="pal-title">${c.name}</div><div class="pal-chips">${items.map((p) => chipHTML(p, totals, today)).join('')}</div></div>`;
    }
    return html;
  }
  function renderPalette() {
    const editing = Store.editing;
    $('#palette').hidden = !editing;
    $('#layout').classList.toggle('editing', editing);
    if (!editing) return;
    const blocked = isWeekend(state.date) || calOf(state.date).festivo;
    $('#paletteList').innerHTML = blocked
      ? '<div class="no-results">No hay clase este día.</div>'
      : groupedListHTML(substituteCandidates(state.date), state.date, state.query, { withNone: true });
  }

  function renderAll() {
    renderDay();
    renderUeco();
    renderBoard();
    renderPalette();
    renderTopbar();
    renderPublished();
    if (present.on && present.auto) fitScreen();
  }

  /* ================= acciones sobre el día ================= */
  function findAbs(id) { return dayOf(state.date).ausencias.find((a) => a.id === id); }
  // Otras ausencias de ese día que ya tienen a esa persona en alguna de esas franjas
  function clashesWith(a, keys, teacherId) {
    if (teacherId === NONE) return 0;
    return dayOf(state.date).ausencias.filter((x) => x !== a && keys.some((k) => coverage(x)[k] === teacherId)).length;
  }
  function assign(absId, slotKey, teacherId, { ask = true } = {}) {
    const a = findAbs(absId);
    if (!a) return;
    a.s = a.s || {};
    // Solo en la primera sesión del día (9:00), preguntar si la sustitución es para toda la jornada
    const sessions = a.dia ? [] : absSessions(a);
    const firstOfDay = slotsFor(state.date).find((s) => !s.patio);
    if (ask && teacherId !== NONE && sessions.length > 1 && firstOfDay && slotKey === firstOfDay.k && sessions[0].k === slotKey) {
      askWholeDay(a, teacherId, sessions);
      return;
    }
    const clash = clashesWith(a, rowKeys(a, slotKey), teacherId);
    a.s[slotKey] = teacherId;
    Store.markDirty('dias:' + state.date);
    const p = staffMap()[teacherId];
    if (teacherId === NONE) toast('✕ Marcado: no hace falta sustituir');
    else if (clash) toast(`⚠ ${shortName(p)} ya tiene otra sustitución a esa hora`, true);
    else toast(`${shortName(p)} asignado/a`);
    state.selected = null;
    renderAll();
  }
  function askWholeDay(a, teacherId, sessions) {
    const map = staffMap();
    const sub = shortName(map[teacherId]);
    const abs = shortName(map[a.t]);
    const first = sessions[0];
    const last = sessions[sessions.length - 1];
    const m = modal({
      title: '¿Sustitución para todo el día?',
      body: `<p style="margin-top:0;font-size:1.05rem"><b>${esc(sub)}</b> sustituye a <b>${esc(abs)}</b> a primera hora (${esc(first.ini)}–${esc(first.fin)}).</p>
        <p style="margin-bottom:0">¿Se queda con su clase <b>toda la jornada</b> (${esc(first.ini)} a ${esc(last.fin)})? Aparecerá en una sola fila «Todo el día». El patio queda aparte.</p>`,
      foot: (f, close) => {
        f.innerHTML = `<button class="btn btn-outline">Solo de ${esc(first.ini)} a ${esc(first.fin)}</button><button class="btn btn-sun">Sí, todo el día</button>`;
        f.children[0].onclick = () => { close(); assign(a.id, first.k, teacherId, { ask: false }); };
        f.children[1].onclick = () => { close(); assignWholeDay(a, teacherId, sessions); };
      },
    });
    $('.btn-sun', m.el).focus();
  }
  function assignWholeDay(a, teacherId, sessions) {
    const map = staffMap();
    const p = shortName(map[teacherId]);
    // Si alguna otra hora ya tenía a otra persona, se respeta y se rellena hora a hora
    const kept = sessions.filter((s) => a.s[s.k] && a.s[s.k] !== teacherId);
    if (kept.length) {
      for (const s of sessions) if (!a.s[s.k]) a.s[s.k] = teacherId;
      toast(`${p} asignado/a en las horas libres. Se han respetado: ${kept.map((s) => `${s.ini} (${shortName(map[a.s[s.k]])})`).join(', ')}`);
    } else {
      for (const s of sessions) delete a.s[s.k];
      a.dia = true;
      a.s[DAY_KEY] = teacherId;
      const clash = clashesWith(a, sessions.map((s) => s.k), teacherId);
      if (clash) toast(`⚠ ${p} asignado/a todo el día, pero tiene horas que se solapan con otra sustitución`, true);
      else toast(`${p} asignado/a para todo el día`);
    }
    Store.markDirty('dias:' + state.date);
    state.selected = null;
    renderAll();
  }
  function clearSlot(absId, slotKey) {
    const a = findAbs(absId);
    if (!a || !a.s) return;
    delete a.s[slotKey];
    Store.markDirty('dias:' + state.date);
    renderAll();
  }
  // Quitar una franja de la tarjeta (el maestro/a solo falta algunas horas)
  function hideSlot(absId, slotKey) {
    const a = findAbs(absId);
    if (!a) return;
    a.ocultas = [...new Set([...(a.ocultas || []), slotKey])];
    if (a.s) delete a.s[slotKey];
    Store.markDirty('dias:' + state.date);
    const s = slotsFor(state.date).find((x) => x.k === slotKey);
    toast(`Hora quitada${s ? ` (${s.ini}–${s.fin})` : ''}. Puedes recuperarla con «Horas».`);
    renderAll();
  }
  // Pasar de una fila «Todo el día» a sesiones sueltas y al revés, conservando quién sustituye.
  // Devuelve true si había varias personas distintas y no se ha podido conservar ninguna.
  function setWholeDay(a, on) {
    a.s = a.s || {};
    const ses = absSessions(a);
    if (on && !a.dia) {
      const ids = [...new Set(ses.map((s) => a.s[s.k]).filter(Boolean))];
      for (const s of ses) delete a.s[s.k];
      if (ids.length === 1) a.s[DAY_KEY] = ids[0];
      a.dia = true;
      return ids.length > 1;
    }
    if (!on && a.dia) {
      const id = a.s[DAY_KEY];
      delete a.s[DAY_KEY];
      if (id) for (const s of ses) a.s[s.k] = id;
      delete a.dia;
    }
    return false;
  }
  function editHours(absId) {
    const a = findAbs(absId);
    const p = staffMap()[a.t];
    const hidden = new Set(a.ocultas || []);
    const all = slotsFor(state.date);
    let whole = !!a.dia;
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="lbl" style="margin-bottom:6px">¿Cómo se muestra?</div>
      <div class="mode-pick">
        <button type="button" class="mode-btn" data-mode="0"><b>Por sesiones</b><small>Una fila por hora</small></button>
        <button type="button" class="mode-btn" data-mode="1"><b>Todo el día</b><small>Una sola fila con un sustituto</small></button>
      </div>
      <div class="lbl" style="margin:16px 0 6px">¿En qué horas falta?</div>
      <div class="hours-list">${all.map((s) => `<label class="hour-row${s.patio ? ' patio' : ''}"><input type="checkbox" value="${esc(s.k)}"${hidden.has(s.k) ? '' : ' checked'}><span>${esc(s.ini)} – ${esc(s.fin)}</span><small>${s.patio ? 'Patio' : 'Sesión'}</small></label>`).join('')}</div>
      <div style="display:flex;gap:8px;margin-top:8px"><button type="button" class="btn-link" data-all="1">Marcar todas</button><button type="button" class="btn-link" data-all="0">Desmarcar todas</button></div>
      <p class="err" id="hrsErr"></p>`;
    const paint = () => $$('.mode-btn', wrap).forEach((b) => b.classList.toggle('on', (b.dataset.mode === '1') === whole));
    paint();
    wrap.addEventListener('click', (e) => {
      const mb = e.target.closest('.mode-btn');
      if (mb) { whole = mb.dataset.mode === '1'; paint(); }
      const al = e.target.closest('[data-all]');
      if (al) $$('.hour-row input', wrap).forEach((i) => { i.checked = al.dataset.all === '1'; });
    });
    modal({
      title: `Horas de ${shortName(p)}`,
      body: wrap,
      foot: (f, close) => {
        f.innerHTML = '<button class="btn btn-outline">Cancelar</button><button class="btn btn-primary">Guardar</button>';
        f.children[0].onclick = close;
        f.children[1].onclick = () => {
          const keep = new Set($$('.hour-row input:checked', wrap).map((i) => i.value));
          if (!keep.size) { $('#hrsErr').textContent = 'Marca al menos una hora.'; return; }
          // Primero volver a sesiones sueltas para no perder a quien sustituye
          const wasWhole = !!a.dia;
          setWholeDay(a, false);
          a.ocultas = all.filter((s) => !keep.has(s.k)).map((s) => s.k);
          for (const k of a.ocultas) if (a.s) delete a.s[k];
          if (!a.ocultas.length) delete a.ocultas;
          const mixed = whole ? setWholeDay(a, true) : false;
          Store.markDirty('dias:' + state.date);
          close();
          renderAll();
          if (mixed) toast('Había varias personas en esas horas: elige quién sustituye todo el día.', true);
          else if (whole && !wasWhole) toast('Ahora se muestra en una sola fila «Todo el día»');
          else toast('Horas actualizadas');
        };
      },
    });
  }

  function pickTeacher({ title, list, onPick, guardFirst = true, withNone = false }) {
    const wrap = document.createElement('div');
    wrap.innerHTML = `<div class="search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg><input type="search" placeholder="Buscar por nombre…" autocomplete="off"></div><div class="palette-list pick-list-wrap"></div>`;
    const input = $('input', wrap);
    const listEl = $('.pick-list-wrap', wrap);
    const draw = () => { listEl.innerHTML = groupedListHTML(list, state.date, input.value, { guardFirst, withNone }); };
    draw();
    const m = modal({ title, body: wrap });
    input.addEventListener('input', draw);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { const first = $('.chip:not(.chip-none)', listEl); if (first) first.click(); }
    });
    listEl.addEventListener('click', (e) => {
      const c = e.target.closest('.chip');
      if (!c) return;
      m.close();
      onPick(c.dataset.id);
    });
    if (matchMedia('(pointer:fine)').matches) setTimeout(() => input.focus(), 50);
  }

  function addAbsence() {
    const absent = new Set(dayOf(state.date).ausencias.map((a) => a.t));
    pickTeacher({
      title: '¿Quién falta hoy?',
      list: activeStaff().filter((p) => !absent.has(p.id)),
      guardFirst: false,
      onPick: (id) => {
        const day = dayOf(state.date, true);
        day.ausencias.push({ id: uid(), t: id, s: {} });
        Store.markDirty('dias:' + state.date);
        toast(`${shortName(staffMap()[id])} añadido/a a ausencias`);
        renderAll();
      },
    });
  }
  function editNote(absId) {
    const a = findAbs(absId);
    const p = staffMap()[a.t];
    const m = modal({
      title: `Nota para ${shortName(p)}`,
      body: `<div class="field"><label for="noteInp">Nota (curso, motivo, tareas…)</label><input id="noteInp" class="inp" maxlength="120" value="${esc(a.nota || '')}" placeholder="Ej.: Clase de 4º B · deja tarea en la mesa"></div>`,
      foot: (f, close) => {
        f.innerHTML = '<button class="btn btn-outline">Cancelar</button><button class="btn btn-primary">Guardar</button>';
        f.children[0].onclick = close;
        f.children[1].onclick = () => {
          a.nota = $('#noteInp').value.trim();
          Store.markDirty('dias:' + state.date);
          close();
          renderAll();
        };
      },
    });
    const inp = $('#noteInp', m.el);
    inp.focus();
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('.btn-primary', m.el).click(); });
  }
  function removeAbsence(absId) {
    const a = findAbs(absId);
    const p = staffMap()[a.t];
    confirmBox('Quitar ausencia', `¿Quitar a <b>${esc(shortName(p))}</b> de las ausencias de este día? Se borrarán también sus sustituciones.`, 'Quitar', () => {
      const day = dayOf(state.date, true);
      day.ausencias = day.ausencias.filter((x) => x.id !== absId);
      if (!day.ausencias.length) delete D().dias[state.date];
      Store.markDirty('dias:' + state.date);
      renderAll();
    });
  }

  /* ================= arrastrar y soltar ================= */
  let drag = null;
  function slotUnder(x, y) {
    const el = document.elementFromPoint(x, y);
    return el ? el.closest('.slot[data-slot]') : null;
  }
  function startDrag() {
    const p = staffMap()[drag.id];
    drag.started = true;
    drag.ghost = document.createElement('div');
    drag.ghost.className = 'ghost';
    drag.ghost.textContent = shortName(p);
    document.body.append(drag.ghost);
    drag.chip.classList.add('dragging-src');
    document.body.classList.add('is-dragging');
    if (navigator.vibrate && drag.type !== 'mouse') navigator.vibrate(15);
    moveGhost(drag.x, drag.y);
  }
  function moveGhost(x, y) {
    drag.ghost.style.left = x + 'px';
    drag.ghost.style.top = y + 'px';
    const s = slotUnder(x, y);
    if (s !== drag.over) {
      drag.over && drag.over.classList.remove('over');
      drag.over = s;
      s && s.classList.add('over');
    }
    // desplazamiento automático cerca de los bordes
    const edge = 70;
    drag.scroll = y < edge ? -12 : y > innerHeight - edge ? 12 : 0;
    if (drag.scroll && !drag.raf) {
      const step = () => {
        if (!drag || !drag.scroll) { if (drag) drag.raf = null; return; }
        scrollBy(0, drag.scroll);
        drag.raf = requestAnimationFrame(step);
      };
      drag.raf = requestAnimationFrame(step);
    }
  }
  function endDrag(drop) {
    if (!drag) return;
    clearTimeout(drag.timer);
    if (drag.started) {
      drag.ghost.remove();
      drag.chip.classList.remove('dragging-src');
      document.body.classList.remove('is-dragging');
      drag.over && drag.over.classList.remove('over');
      if (drop && drag.over) {
        const absId = drag.over.closest('.absence').dataset.abs;
        assign(absId, drag.over.dataset.slot, drag.id);
      }
      drag.suppressClick = true;
      const id = drag.id;
      setTimeout(() => { if (lastDragId === id) lastDragId = null; }, 0);
      lastDragId = id;
    }
    drag = null;
  }
  let lastDragId = null;
  function initDrag() {
    $('#paletteList').addEventListener('pointerdown', (e) => {
      const chip = e.target.closest('.chip[data-id]');
      if (!chip || e.button > 0) return;
      drag = { id: chip.dataset.id, chip, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, type: e.pointerType, started: false };
      if (e.pointerType !== 'mouse') {
        drag.timer = setTimeout(() => { if (drag && !drag.started) startDrag(); }, 260);
      }
    });
    document.addEventListener('pointermove', (e) => {
      if (!drag) return;
      drag.x = e.clientX; drag.y = e.clientY;
      if (!drag.started) {
        const dist = Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy);
        if (drag.type === 'mouse' && dist > 6) startDrag();
        else if (drag.type !== 'mouse' && dist > 10) { clearTimeout(drag.timer); drag = null; }
        return;
      }
      e.preventDefault();
      moveGhost(e.clientX, e.clientY);
    }, { passive: false });
    document.addEventListener('pointerup', () => endDrag(true));
    document.addEventListener('pointercancel', () => endDrag(false));
    // En pantallas táctiles, evitar que la página se desplace mientras se arrastra
    document.addEventListener('touchmove', (e) => { if (drag && drag.started) e.preventDefault(); }, { passive: false });
    $('#paletteList').addEventListener('contextmenu', (e) => { if (e.target.closest('.chip')) e.preventDefault(); });
  }

  /* ================= eventos del tablero ================= */
  function initBoardEvents() {
    $('#board').addEventListener('click', (e) => {
      if (!Store.editing) return;
      const absEl = e.target.closest('.absence');
      if (!absEl) return;
      const absId = absEl.dataset.abs;
      const act = e.target.closest('[data-act]');
      const slot = e.target.closest('.slot[data-slot]');
      if (act) {
        const a = act.dataset.act;
        if (a === 'clear') clearSlot(absId, slot.dataset.slot);
        if (a === 'note') editNote(absId);
        if (a === 'del') removeAbsence(absId);
        if (a === 'hours') editHours(absId);
        if (a === 'hide') hideSlot(absId, slot.dataset.slot);
        return;
      }
      if (!slot) return;
      if (state.selected) { assign(absId, slot.dataset.slot, state.selected); return; }
      const a = findAbs(absId);
      const p = staffMap()[a.t];
      const s = visibleSlots(a).find((x) => x.k === slot.dataset.slot);
      pickTeacher({
        title: s.dia ? `Sustituye a ${shortName(p)} · todo el día` : `Sustituye a ${shortName(p)} · ${s.ini}–${s.fin}`,
        list: substituteCandidates(state.date),
        withNone: true,
        onPick: (id) => assign(absId, slot.dataset.slot, id),
      });
    });
    $('#board').addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.slot')) { e.preventDefault(); e.target.click(); }
    });
    $('#paletteList').addEventListener('click', (e) => {
      const chip = e.target.closest('.chip[data-id]');
      if (!chip || lastDragId === chip.dataset.id) return;
      state.selected = state.selected === chip.dataset.id ? null : chip.dataset.id;
      renderBoard();
      $$('#paletteList .chip').forEach((c) => c.classList.toggle('selected', c.dataset.id === state.selected));
      if (state.selected && matchMedia('(max-width: 1100px)').matches) $('#board').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    $('#search').addEventListener('input', (e) => { state.query = e.target.value; renderPalette(); });
    $('#search').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { const c = $('#paletteList .chip:not(.chip-none)'); if (c) c.click(); }
      if (e.key === 'Escape') { e.target.value = ''; state.query = ''; renderPalette(); }
    });
    $('#btnAddAbsence').onclick = addAbsence;
  }

  /* ================= navegación de fechas ================= */
  function setDate(s) {
    state.date = s;
    state.selected = null;
    try { history.replaceState(null, '', '#' + s); } catch { /* nada */ }
    renderAll();
  }
  function initDateNav() {
    $('#prevDay').onclick = () => setDate(shiftSchoolDay(state.date, -1));
    $('#nextDay').onclick = () => setDate(shiftSchoolDay(state.date, 1));
    $('#todayBtn').onclick = () => setDate(defaultDate());
    $('#dateInput').addEventListener('change', (e) => { if (e.target.value) setDate(e.target.value); });
    $('.date-display').addEventListener('click', () => { try { $('#dateInput').showPicker(); } catch { /* navegador antiguo */ } });
    document.addEventListener('keydown', (e) => {
      if (e.target.closest('input, textarea, select') || $('#modalRoot').children.length) return;
      if (e.key === 'ArrowLeft') $('#prevDay').click();
      if (e.key === 'ArrowRight') $('#nextDay').click();
    });
  }

  /* ================= compartir / imprimir ================= */
  function summaryText() {
    const map = staffMap();
    const g = guardOf(state.date);
    let t = `📋 SUSTITUCIONES · ${longDate(state.date).toUpperCase()}\n`;
    if (g) t += `🛡️ Guardia: grupo ${g.num} (${g.members.map((id) => shortName(map[id])).join(', ')})\n`;
    const day = dayOf(state.date);
    if (!day.ausencias.length) return t + '\nNo hay ausencias registradas.';
    for (const a of day.ausencias) {
      const p = map[a.t];
      t += `\n❌ ${shortName(p)}${p && p.cargo ? ' (' + p.cargo + ')' : ''}${a.nota ? ' – ' + a.nota : ''}\n`;
      for (const s of visibleSlots(a)) {
        const sid = (a.s || {})[s.k];
        t += `   ${s.dia ? 'Todo el día ' : ''}${s.ini}-${s.fin}${s.patio ? ' patio' : ''}:${sid === NONE ? 'no hace falta' : sid ? shortName(map[sid]) : '—'}\n`;
      }
    }
    return t;
  }
  async function share() {
    const text = summaryText();
    if (navigator.share && matchMedia('(pointer:coarse)').matches) {
      try { await navigator.share({ title: 'Sustituciones', text }); return; } catch { /* cancelado */ return; }
    }
    try { await navigator.clipboard.writeText(text); toast('Resumen copiado. Pégalo en WhatsApp o en un correo.'); }
    catch { modal({ title: 'Resumen del día', body: `<textarea class="inp" rows="14" readonly>${esc(text)}</textarea>` }); }
  }

  /* ================= barra superior y edición ================= */
  function renderTopbar() {
    const editing = Store.editing;
    const be = $('#btnEdit');
    be.classList.toggle('active', editing);
    be.querySelector('span').textContent = editing ? 'Salir de edición' : 'Editar';
    be.querySelector('svg').innerHTML = editing
      ? '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/>'
      : '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>';
    $('#btnSettings').hidden = !editing;
    renderSync();
  }
  function renderSync() {
    const el = $('#syncStatus');
    const bar = $('#publishBar');
    const btn = $('#btnPublish');
    const editing = Store.editing;
    const n = Store.pendingCount;
    btn.hidden = !editing;
    if (!editing) { el.hidden = true; bar.hidden = true; return; }
    el.hidden = false;
    el.className = 'sync';
    btn.disabled = Store.publishing;
    if (Store.publishing) {
      el.classList.add('saving'); el.textContent = 'Publicando…';
    } else if (n) {
      el.classList.add('local'); el.textContent = n === 1 ? '1 cambio sin publicar' : `${n} cambios sin publicar`;
    } else {
      el.textContent = 'Todo publicado';
    }
    btn.classList.toggle('pulse', !!n && !Store.publishing);
    bar.hidden = !n && !Store.publishing;
    $('#publishBarText').innerHTML = Store.publishing
      ? 'Publicando los cambios…'
      : '<b>Cambios sin publicar.</b> Solo los ves tú hasta que pulses «Publicar».';
    $('#publishBarBtn').disabled = Store.publishing;
  }

  async function doPublish() {
    if (!Store.pendingCount) { toast('No hay cambios pendientes: todo está publicado.'); return true; }
    renderSync();
    try {
      await Store.publish();
      renderAll();
      toast('✓ Publicado. Ya lo ven todos los dispositivos.');
      return true;
    } catch (e) {
      renderSync();
      if (e.code === 'NO_TOKEN' || e.code === 'AUTH') {
        modal({
          title: 'Falta conectar con GitHub',
          body: `<p style="margin-top:0">${e.code === 'AUTH' ? esc(e.message) : 'Para que los cambios lleguen a todos los dispositivos, la aplicación necesita conectarse <b>una sola vez</b> con GitHub.'}</p>
            <p>Tus cambios no se pierden: quedan guardados en este dispositivo hasta que se publiquen.</p>`,
          foot: (f, close) => {
            f.innerHTML = '<button class="btn btn-outline">Ahora no</button><button class="btn btn-primary">Conectar ahora</button>';
            f.children[0].onclick = close;
            f.children[1].onclick = () => { close(); openSettings('acceso'); };
          },
        });
      } else {
        toast(e.message || 'No se pudo publicar', true);
      }
      return false;
    }
  }
  function askPassword() {
    const m = modal({
      title: 'Modo edición',
      body: `<p style="margin-top:0">Solo la jefatura de estudios puede modificar las sustituciones. Todo el claustro puede consultarlas sin contraseña.</p>
        <div class="field"><label for="pwInp">Contraseña</label><input id="pwInp" class="inp" type="password" autocomplete="current-password"></div><div class="err" id="pwErr"></div>`,
      foot: (f, close) => {
        f.innerHTML = '<button class="btn btn-outline">Cancelar</button><button class="btn btn-primary">Entrar</button>';
        f.children[0].onclick = close;
        f.children[1].onclick = async () => {
          const btn = f.children[1];
          btn.disabled = true; btn.textContent = 'Comprobando…';
          const ok = await Store.login($('#pwInp').value);
          btn.disabled = false; btn.textContent = 'Entrar';
          if (!ok) { $('#pwErr').textContent = 'Contraseña incorrecta'; $('#pwInp').classList.add('bad'); $('#pwInp').select(); return; }
          close();
          toast('Modo edición activado');
          renderAll();
        };
      },
    });
    const inp = $('#pwInp', m.el);
    inp.focus();
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('.btn-primary', m.el).click(); });
  }
  function toggleEdit() {
    if (!Store.editing) { askPassword(); return; }
    const leave = () => {
      Store.logout();
      state.selected = null;
      renderAll();
      toast('Has salido del modo edición');
    };
    if (!Store.pendingCount) { leave(); return; }
    modal({
      title: 'Hay cambios sin publicar',
      body: '<p style="margin:0">Si no los publicas, el resto del claustro no los verá. Se quedarán guardados en este dispositivo para publicarlos más tarde.</p>',
      foot: (f, close) => {
        f.innerHTML = '<button class="btn btn-outline">Salir sin publicar</button><button class="btn btn-sun">Publicar y salir</button>';
        f.children[0].onclick = () => { close(); leave(); };
        f.children[1].onclick = async () => { close(); if (await doPublish()) leave(); };
      },
    });
  }

  /* ================= instalación en el móvil ================= */
  let installEvt = null;
  const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isMobile = () => /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  function initInstall() {
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; $('#btnInstall').hidden = isStandalone(); });
    window.addEventListener('appinstalled', () => { $('#btnInstall').hidden = true; toast('¡Aplicación añadida a tu pantalla de inicio!'); });
    $('#btnInstall').hidden = !(isMobile() && !isStandalone());
    $('#btnInstall').onclick = async () => {
      if (installEvt) {
        installEvt.prompt();
        await installEvt.userChoice;
        installEvt = null;
        return;
      }
      const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      const share = '<svg viewBox="0 0 24 24" style="vertical-align:-4px"><path d="M12 3v12M8 7l4-4 4 4M6 11H5v10h14V11h-1"/></svg>';
      const steps = ios
        ? [`Abre esta página en <b>Safari</b>.`, `Pulsa el botón <b>Compartir</b> ${share} (abajo en el centro, o arriba en iPad).`, `Elige <b>«Añadir a pantalla de inicio»</b>.`, `Pulsa <b>Añadir</b>. ¡Listo! Tendrás el icono de Sustituciones junto a tus apps.`]
        : [`Abre esta página en <b>Chrome</b>.`, `Pulsa el menú <b>⋮</b> (arriba a la derecha).`, `Elige <b>«Añadir a pantalla de inicio»</b> o <b>«Instalar aplicación»</b>.`, `Confirma con <b>Añadir</b>. ¡Listo!`];
      modal({
        title: 'Añadir al móvil',
        body: `<div style="text-align:center;margin-bottom:14px"><img src="icons/icon.svg" width="84" height="84" alt=""></div><div class="install-steps">${steps.map((s, i) => `<div class="st"><span class="n">${i + 1}</span><span>${s}</span></div>`).join('')}</div>`,
      });
    };
  }

  /* ================= ajustes ================= */
  function openSettings(tab = 'personal') {
    const body = document.createElement('div');
    const m = modal({ title: 'Ajustes', body, wide: true, onClose: () => renderAll() });
    const tabs = [['personal', 'Personal'], ['grupos', 'Grupos de guardia'], ['calendario', 'Calendario de guardias'], ['horarios', 'Horarios'], ['ueco', 'Acompañamientos UECO'], ['acceso', 'Acceso y datos']];
    const tabBar = document.createElement('div');
    tabBar.className = 'tabs';
    tabBar.innerHTML = tabs.map(([id, n]) => `<button class="tab" data-tab="${id}">${n}</button>`).join('');
    m.body.before(tabBar);
    const show = (id) => {
      $$('.tab', tabBar).forEach((t) => t.classList.toggle('on', t.dataset.tab === id));
      body.innerHTML = '';
      ({ personal: setPersonal, grupos: setGroups, calendario: setCalendar, horarios: setSchedule, ueco: setUeco, acceso: setAccess })[id](body);
      m.body.scrollTop = 0;
    };
    tabBar.onclick = (e) => { const t = e.target.closest('.tab'); if (t) show(t.dataset.tab); };
    show(tab);
  }

  const catOptions = (sel) => CATS.map((c) => `<option value="${c.id}"${c.id === sel ? ' selected' : ''}>${c.name}</option>`).join('');

  function personForm(p, onSave) {
    const isNew = !p;
    p = p || { cat: 'tutor' };
    const m = modal({
      title: isNew ? 'Dar de alta' : 'Editar datos',
      body: `<div class="row2"><div class="field"><label>Nombre</label><input class="inp" id="pfN" value="${esc(p.nombre || '')}" placeholder="Ej.: María José"></div>
        <div class="field"><label>Apellidos</label><input class="inp" id="pfA" value="${esc(p.apellidos || '')}"></div></div>
        <div class="row2"><div class="field"><label>Cómo se le llama <small>(opcional)</small></label><input class="inp" id="pfAl" value="${esc(p.alias || '')}" placeholder="Ej.: Majo"></div>
        <div class="field"><label>Puesto</label><input class="inp" id="pfC" value="${esc(p.cargo || '')}" placeholder="Ej.: Tutora 3º B · Inglés 2º ciclo"></div></div>
        <div class="field"><label>Tipo</label><select class="inp" id="pfT">${catOptions(p.cat)}</select><small>Especialistas y apoyos aparecen primero en la lista de sustitutos. El personal no docente no aparece como sustituto.</small></div>
        <div class="err" id="pfErr"></div>`,
      foot: (f, close) => {
        f.innerHTML = `<button class="btn btn-outline">Cancelar</button><button class="btn btn-primary">${isNew ? 'Dar de alta' : 'Guardar'}</button>`;
        f.children[0].onclick = close;
        f.children[1].onclick = () => {
          const nombre = $('#pfN').value.trim();
          if (!nombre) { $('#pfErr').textContent = 'Escribe al menos el nombre.'; $('#pfN').focus(); return; }
          Object.assign(p, { nombre, apellidos: $('#pfA').value.trim(), alias: $('#pfAl').value.trim() || undefined, cargo: $('#pfC').value.trim(), cat: $('#pfT').value });
          if (!p.alias) delete p.alias;
          close();
          onSave(p, isNew);
        };
      },
    });
    $('#pfN', m.el).focus();
  }

  function usedInDays(id) {
    for (const day of Object.values(D().dias)) for (const a of day.ausencias || []) {
      if (a.t === id || Object.values(a.s || {}).includes(id)) return true;
    }
    return false;
  }

  function setPersonal(el) {
    const list = sortStaff(activeStaff());
    const bajas = D().personal.filter((p) => p.baja);
    el.innerHTML = `<div class="set-section"><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;justify-content:space-between">
        <p style="margin:0">${list.length} personas en el claustro. Da de alta a quien llega y de baja a quien se va: los días ya registrados conservan su nombre.</p>
        <div style="display:flex;gap:8px"><button class="btn btn-outline btn-sm" id="pImport">Añadir varias</button><button class="btn btn-primary btn-sm" id="pAdd">+ Dar de alta</button></div></div></div>
      <div style="overflow-x:auto"><table class="staff-table"><thead><tr><th>Nombre</th><th>Puesto</th><th></th></tr></thead><tbody>
      ${CATS.map((c) => {
        const items = list.filter((p) => (p.cat || 'otros') === c.id);
        if (!items.length) return '';
        return `<tr class="cat-row"><td colspan="3"><span class="dot" style="--c:var(--cat-${c.id})"></span>${c.name} (${items.length})</td></tr>` +
          items.map((p) => `<tr><td><b>${esc(shortName(p))}</b>${p.alias ? ` <small style="color:var(--muted)">· ${esc(fullName(p))}</small>` : ` <span style="color:var(--muted)">${esc(p.apellidos || '')}</span>`}</td><td>${esc(p.cargo || '')}</td>
            <td><div class="t-actions"><button class="mini-btn" data-edit="${p.id}">${ICON.edit}Editar</button><button class="mini-btn del" data-del="${p.id}">${ICON.trash}Baja</button></div></td></tr>`).join('');
      }).join('')}</tbody></table></div>
      ${bajas.length ? `<div class="set-section" style="margin-top:20px"><h4>Dados de baja (${bajas.length})</h4><p>Se conservan porque aparecen en días ya registrados.</p>${bajas.map((p) => `<span class="mini-btn" style="margin:0 6px 6px 0">${esc(fullName(p))} <button class="btn-link" data-restore="${p.id}">Recuperar</button></span>`).join('')}</div>` : ''}`;

    $('#pAdd', el).onclick = () => personForm(null, (p) => {
      p.id = 'p' + uid();
      D().personal.push(p);
      Store.markDirty('personal');
      toast(`${shortName(p)} dado/a de alta`);
      setPersonal(el);
    });
    $('#pImport', el).onclick = () => importStaff(() => setPersonal(el));
    el.onclick = (e) => {
      const ed = e.target.closest('[data-edit]');
      const de = e.target.closest('[data-del]');
      const re = e.target.closest('[data-restore]');
      if (ed) {
        const p = D().personal.find((x) => x.id === ed.dataset.edit);
        personForm({ ...p }, (np) => { Object.keys(p).forEach((k) => delete p[k]); Object.assign(p, np); Store.markDirty('personal'); setPersonal(el); });
      }
      if (de) {
        const p = D().personal.find((x) => x.id === de.dataset.del);
        confirmBox('Dar de baja', `¿Dar de baja a <b>${esc(fullName(p))}</b>? Dejará de aparecer en las listas y en su grupo de guardia.`, 'Dar de baja', () => {
          for (const g of Object.keys(D().grupos)) D().grupos[g] = D().grupos[g].filter((id) => id !== p.id);
          if (usedInDays(p.id)) p.baja = true;
          else D().personal = D().personal.filter((x) => x !== p);
          Store.markDirty('personal');
          Store.markDirty('grupos');
          toast(`${shortName(p)} dado/a de baja`);
          setPersonal(el);
        });
      }
      if (re) {
        const p = D().personal.find((x) => x.id === re.dataset.restore);
        delete p.baja;
        Store.markDirty('personal');
        setPersonal(el);
      }
    };
  }

  function importStaff(done) {
    const m = modal({
      title: 'Añadir varias personas',
      body: `<p style="margin-top:0">Escribe una persona por línea (o pégalas desde Excel) con este formato:</p>
        <p><code>Nombre ; Apellidos ; Puesto ; tipo</code></p>
        <p style="color:var(--muted);font-size:.9rem">El tipo puede ser: <b>especialista</b>, <b>apoyo</b>, <b>tutor</b>, <b>pt</b>/<b>al</b>/<b>orientación</b>, <b>dirección</b>, <b>otros</b> o <b>no docente</b>. Si no lo pones se usará «tutor».</p>
        <textarea class="inp" id="impT" rows="9" placeholder="Laura ; Pérez Gil ; Tutora 2º A ; tutor&#10;Pablo ; Ruiz ; Inglés 3er ciclo ; especialista"></textarea><div class="err" id="impErr"></div>`,
      foot: (f, close) => {
        f.innerHTML = '<button class="btn btn-outline">Cancelar</button><button class="btn btn-primary">Añadir</button>';
        f.children[0].onclick = close;
        f.children[1].onclick = () => {
          const mapCat = (s) => {
            s = norm(s);
            if (!s) return 'tutor';
            if (s.startsWith('esp')) return 'especialista';
            if (s.startsWith('apo')) return 'apoyo';
            if (s.startsWith('tut')) return 'tutor';
            if (/^(pt|al|ori|incl)/.test(s)) return 'inclusion';
            if (s.startsWith('dir') || s.startsWith('equipo')) return 'direccion';
            if (s.startsWith('no')) return 'nodocente';
            return 'otros';
          };
          const lines = $('#impT').value.split('\n').map((l) => l.trim()).filter(Boolean);
          let n = 0;
          for (const l of lines) {
            const parts = l.split(/\t|;/).map((x) => x.trim());
            if (!parts[0]) continue;
            D().personal.push({ id: 'p' + uid(), nombre: parts[0], apellidos: parts[1] || '', cargo: parts[2] || '', cat: mapCat(parts[3]) });
            n++;
          }
          if (!n) { $('#impErr').textContent = 'No hay ninguna línea válida.'; return; }
          Store.markDirty('personal');
          close();
          toast(`${n} personas añadidas`);
          done();
        };
      },
    });
    $('#impT', m.el).focus();
  }

  function setGroups(el) {
    const map = staffMap();
    const keys = Object.keys(D().grupos).sort((a, b) => Number(a) - Number(b));
    const assigned = new Set(Object.values(D().grupos).flat());
    const candidates = sortStaff(activeStaff().filter((p) => p.cat !== 'nodocente'));
    const opts = (g) => '<option value="">+ Añadir persona…</option>' + CATS.map((c) => {
      const items = candidates.filter((p) => (p.cat || 'otros') === c.id && !D().grupos[g].includes(p.id));
      return items.length ? `<optgroup label="${c.name}">${items.map((p) => `<option value="${p.id}">${esc(shortName(p))} · ${esc(p.cargo || '')}${assigned.has(p.id) ? ' (ya en otro grupo)' : ''}</option>`).join('')}</optgroup>` : '';
    }).join('');
    const sinGrupo = candidates.filter((p) => !assigned.has(p.id));
    el.innerHTML = `<div class="set-section"><p>Cada día del calendario indica qué grupo está de guardia. Aquí decides quién forma cada grupo.</p>
      ${sinGrupo.length ? `<div class="notice">${ICON.info}<span>Sin grupo: ${sinGrupo.map((p) => esc(shortName(p))).join(', ')}.</span></div>` : ''}</div>
      <div class="groups-grid">${keys.map((g) => `<div class="gcard"><h5>Grupo ${esc(g)} ${!D().grupos[g].length && g === keys[keys.length - 1] ? `<button class="btn-link" data-rmg="${esc(g)}">Eliminar</button>` : ''}</h5>
        ${D().grupos[g].map((id) => `<div class="gmember"><span>${esc(shortName(map[id]))} <small>${esc(map[id] ? map[id].cargo || '' : '')}</small></span><button data-g="${esc(g)}" data-rm="${id}" aria-label="Quitar">${ICON.x}</button></div>`).join('')}
        <select data-add="${esc(g)}">${opts(g)}</select></div>`).join('')}</div>
      <div style="margin-top:14px"><button class="btn btn-outline btn-sm" id="gAdd">+ Añadir grupo</button></div>`;
    el.onchange = (e) => {
      const s = e.target.closest('[data-add]');
      if (!s || !s.value) return;
      D().grupos[s.dataset.add].push(s.value);
      Store.markDirty('grupos');
      setGroups(el);
    };
    el.onclick = (e) => {
      const rm = e.target.closest('[data-rm]');
      if (rm) { const g = rm.dataset.g; D().grupos[g] = D().grupos[g].filter((id) => id !== rm.dataset.rm); Store.markDirty('grupos'); setGroups(el); }
      const rg = e.target.closest('[data-rmg]');
      if (rg) { delete D().grupos[rg.dataset.rmg]; Store.markDirty('grupos'); setGroups(el); }
      if (e.target.closest('#gAdd')) {
        const next = String(Math.max(0, ...Object.keys(D().grupos).map(Number)) + 1);
        D().grupos[next] = [];
        Store.markDirty('grupos');
        setGroups(el);
      }
    };
  }

  let calMonth = null;
  function setCalendar(el) {
    if (!calMonth) { const d = fromISO(state.date); calMonth = new Date(d.getFullYear(), d.getMonth(), 1); }
    const y = calMonth.getFullYear();
    const mo = calMonth.getMonth();
    const groups = Object.keys(D().grupos).sort((a, b) => Number(a) - Number(b));
    const today = toISO(new Date());
    let rows = '';
    for (let d = new Date(y, mo, 1); d.getMonth() === mo; d.setDate(d.getDate() + 1)) {
      if ([0, 6].includes(d.getDay())) continue;
      const iso = toISO(d);
      const c = calOf(iso);
      rows += `<tr data-date="${iso}" class="${d.getDay() === 1 ? 'weekstart' : ''}${c.festivo ? ' fest' : ''}">
        <td class="cal-day${iso === today ? ' today' : ''}">${d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric' })}</td>
        <td><select class="inp" data-f="g"${c.festivo ? ' disabled' : ''}><option value="">—</option>${groups.map((g) => `<option${String(c.g) === g ? ' selected' : ''}>${g}</option>`).join('')}</select></td>
        <td style="text-align:center"><input type="checkbox" data-f="festivo"${c.festivo ? ' checked' : ''} aria-label="Festivo"></td>
        <td><input class="inp" data-f="nota" value="${esc(c.nota || '')}" placeholder="Nota del día (opcional)"></td></tr>`;
    }
    el.innerHTML = `<div class="set-section"><p>Elige el grupo de guardia de cada día lectivo. Marca los festivos y añade avisos (por ejemplo «Todos excepto el grupo 4 salen a las 14:00»). Cuando tengas el calendario del 3er trimestre, rellénalo aquí.</p></div>
      <div class="cal-head"><button class="icon-btn" id="cPrev" aria-label="Mes anterior">${ICON.left}</button><strong>${MONTHS[mo]} ${y}</strong><button class="icon-btn" id="cNext" aria-label="Mes siguiente">${ICON.right}</button></div>
      <div style="overflow-x:auto"><table class="cal-table"><thead><tr><th>Día</th><th>Grupo</th><th>Festivo</th><th>Aviso</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    $('#cPrev', el).onclick = () => { calMonth = new Date(y, mo - 1, 1); setCalendar(el); };
    $('#cNext', el).onclick = () => { calMonth = new Date(y, mo + 1, 1); setCalendar(el); };
    el.onchange = (e) => {
      const f = e.target.dataset.f;
      const tr = e.target.closest('tr[data-date]');
      if (!f || !tr) return;
      const iso = tr.dataset.date;
      const c = { ...calOf(iso) };
      if (f === 'g') { if (e.target.value) c.g = e.target.value; else delete c.g; }
      if (f === 'festivo') { if (e.target.checked) { c.festivo = true; delete c.g; } else delete c.festivo; }
      if (f === 'nota') { const v = e.target.value.trim(); if (v) c.nota = v; else delete c.nota; }
      if (Object.keys(c).length) D().calendario[iso] = c; else delete D().calendario[iso];
      Store.markDirty('calendario:' + iso);
      if (f === 'festivo') setCalendar(el);
    };
  }

  function setSchedule(el) {
    const h = D().ajustes.horarios;
    const table = (type) => `<table class="sched-table"><tbody>${h[type].map((s, i) => `<tr data-type="${type}" data-i="${i}">
        <td><select class="inp" data-f="patio"><option value="">Sesión</option><option value="1"${s.patio ? ' selected' : ''}>Patio</option></select></td>
        <td><input class="inp" type="time" data-f="ini" value="${esc(s.ini)}"></td><td>a</td><td><input class="inp" type="time" data-f="fin" value="${esc(s.fin)}"></td>
        <td><button class="mini-btn del" data-rm aria-label="Quitar">${ICON.trash}</button></td></tr>`).join('')}</tbody></table>
        <button class="btn btn-outline btn-sm" data-addrow="${type}">+ Añadir franja</button>`;
    const school = [9, 10, 11, 12, 1, 2, 3, 4, 5, 6];
    el.innerHTML = `<div class="set-section"><h4>Horario habitual</h4><p>De octubre a mayo.</p>${table('normal')}</div>
      <div class="set-section"><h4>Horario de jornada reducida</h4><p>Septiembre y junio (9:00 a 13:00).</p>${table('intensivo')}</div>
      <div class="set-section"><h4>Meses con jornada reducida</h4><div class="month-checks">${school.map((m) => `<label><input type="checkbox" data-month="${m}"${D().ajustes.mesesIntensivos.includes(m) ? ' checked' : ''}>${MONTHS[m - 1]}</label>`).join('')}</div></div>`;
    el.onchange = (e) => {
      const mth = e.target.dataset.month;
      if (mth) {
        const set = new Set(D().ajustes.mesesIntensivos);
        e.target.checked ? set.add(Number(mth)) : set.delete(Number(mth));
        D().ajustes.mesesIntensivos = [...set].sort((a, b) => a - b);
        Store.markDirty('ajustes');
        return;
      }
      const tr = e.target.closest('tr[data-type]');
      if (!tr) return;
      const s = h[tr.dataset.type][tr.dataset.i];
      const f = e.target.dataset.f;
      if (f === 'patio') { if (e.target.value) { s.patio = true; } else delete s.patio; }
      else s[f] = e.target.value;
      h[tr.dataset.type].sort((a, b) => a.ini.localeCompare(b.ini));
      Store.markDirty('ajustes');
      setSchedule(el);
    };
    el.onclick = (e) => {
      const rm = e.target.closest('[data-rm]');
      if (rm) {
        const tr = rm.closest('tr');
        h[tr.dataset.type].splice(Number(tr.dataset.i), 1);
        Store.markDirty('ajustes');
        setSchedule(el);
      }
      const add = e.target.closest('[data-addrow]');
      if (add) {
        const list = h[add.dataset.addrow];
        const last = list[list.length - 1];
        list.push({ k: 's' + uid(), ini: last ? last.fin : '09:00', fin: last ? last.fin : '09:45' });
        Store.markDirty('ajustes');
        setSchedule(el);
      }
    };
  }

  // Acompañamientos de los niños y niñas de la UECO: filas = alumnado, columnas = semanas
  function setUeco(el) {
    const u = uecoData();
    u.semanas.sort((a, b) => a.ini.localeCompare(b.ini));
    const map = staffMap();
    const staff = sortStaff(activeStaff().filter((p) => p.cat !== 'nodocente'));
    const opts = (sel) => '<option value="">—</option>' + CATS.map((c) => {
      const items = staff.filter((p) => (p.cat || 'otros') === c.id);
      return items.length ? `<optgroup label="${c.name}">${items.map((p) => `<option value="${p.id}"${p.id === sel ? ' selected' : ''}>${esc(shortName(p))} · ${esc(p.cargo || '')}</option>`).join('')}</optgroup>` : '';
    }).join('') + (sel && !map[sel] ? `<option value="${esc(sel)}" selected>(persona eliminada)</option>` : '');
    const save = () => { Store.markDirty('ueco'); };
    const cur = uecoWeek(state.date);
    el.innerHTML = `<div class="set-section"><p>Quién acompaña a cada niño o niña de la UECO cada semana. Se muestra en la pantalla principal, encima de las sustituciones, en los días de esa semana. Si quien acompaña falta ese día, sale marcado en rojo. La web es pública: pon solo las <b>iniciales</b> del alumno/a, no su nombre.</p></div>
      ${u.alumnos.length ? '' : `<div class="notice">${ICON.info}<span>Empieza añadiendo al alumnado y después las semanas.</span></div>`}
      <div class="ueco-table-wrap"><table class="ueco-table">
        <thead><tr><th class="ueco-th-kid">Alumno/a · clase</th>${u.semanas.map((w, i) => `<th class="${w === cur ? 'cur' : ''}">
          <div class="uw-dates"><input type="date" data-w="${i}" data-f="ini" value="${esc(w.ini)}" aria-label="Desde"><input type="date" data-w="${i}" data-f="fin" value="${esc(w.fin)}" aria-label="Hasta"></div>
          <button class="btn-link" data-rmw="${i}">Quitar semana</button></th>`).join('')}</tr></thead>
        <tbody>${u.alumnos.map((al) => `<tr>
          <td class="ueco-td-kid"><input type="text" data-al="${esc(al.id)}" data-f="nombre" value="${esc(al.nombre)}" placeholder="Iniciales"><input type="text" data-al="${esc(al.id)}" data-f="clase" value="${esc(al.clase || '')}" placeholder="Clase" class="cls"><button class="icon-x" data-rma="${esc(al.id)}" aria-label="Quitar a ${esc(al.nombre)}">${ICON.x}</button></td>
          ${u.semanas.map((w, i) => `<td class="${w === cur ? 'cur' : ''}"><select data-w="${i}" data-a="${esc(al.id)}">${opts((w.a || {})[al.id])}</select></td>`).join('')}
        </tr>`).join('')}</tbody>
      </table></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">
        <button class="btn btn-outline btn-sm" id="uAddKid">+ Añadir alumno/a</button>
        <button class="btn btn-outline btn-sm" id="uAddWeek">+ Añadir semana</button>
      </div>`;
    el.onchange = (e) => {
      const t = e.target;
      if (t.dataset.a !== undefined) {
        const w = u.semanas[t.dataset.w];
        w.a = w.a || {};
        if (t.value) w.a[t.dataset.a] = t.value; else delete w.a[t.dataset.a];
        save();
      } else if (t.dataset.w !== undefined) {
        if (!t.value) return;
        u.semanas[t.dataset.w][t.dataset.f] = t.value;
        save();
        setUeco(el);
      } else if (t.dataset.al !== undefined) {
        const al = u.alumnos.find((x) => x.id === t.dataset.al);
        if (al) { al[t.dataset.f] = t.value.trim(); save(); }
      }
    };
    el.onclick = (e) => {
      const rw = e.target.closest('[data-rmw]');
      if (rw) {
        const w = u.semanas[rw.dataset.rmw];
        confirmBox('Quitar semana', `¿Quitar la semana del ${shortDate(w.ini)} al ${shortDate(w.fin)}?`, 'Quitar', () => { u.semanas.splice(rw.dataset.rmw, 1); save(); setUeco(el); });
      }
      const ra = e.target.closest('[data-rma]');
      if (ra) {
        const al = u.alumnos.find((x) => x.id === ra.dataset.rma);
        confirmBox('Quitar alumno/a', `¿Quitar a ${esc(al.nombre || 'este alumno/a')} de los acompañamientos?`, 'Quitar', () => {
          u.alumnos = u.alumnos.filter((x) => x !== al);
          for (const w of u.semanas) if (w.a) delete w.a[al.id];
          save(); setUeco(el);
        });
      }
      if (e.target.closest('#uAddKid')) {
        u.alumnos.push({ id: 'u' + uid(), nombre: '', clase: '' });
        save(); setUeco(el);
        const ins = $$('.ueco-td-kid input[data-f="nombre"]', el);
        if (ins.length) ins[ins.length - 1].focus();
      }
      if (e.target.closest('#uAddWeek')) {
        // La semana siguiente a la última (de lunes a viernes)
        const last = u.semanas[u.semanas.length - 1];
        const base = last ? fromISO(last.fin) : fromISO(state.date);
        const mon = new Date(base);
        if (last) mon.setDate(mon.getDate() + ((8 - mon.getDay()) % 7 || 7));
        else mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
        const fri = new Date(mon); fri.setDate(fri.getDate() + 4);
        u.semanas.push({ ini: toISO(mon), fin: toISO(fri), a: {} });
        save(); setUeco(el);
        const wrap = $('.ueco-table-wrap', el); wrap.scrollLeft = wrap.scrollWidth;
      }
    };
  }

  function setAccess(el) {
    const r = Store.repoInfo();
    const synced = Store.canSync();
    el.innerHTML = `
      <div class="set-section"><h4>Guardar en GitHub</h4>
        ${synced
          ? `<div class="status-box ok">✓ Conectado. Al pulsar «Publicar» los cambios llegan a todos los dispositivos.</div>`
          : `<div class="status-box warn">Todavía no está conectada: el botón «Publicar» no puede enviar los cambios al resto del claustro.</div>
            ${r ? `<p>Para que todo el claustro vea las sustituciones hay que conectar la aplicación con GitHub <b>una sola vez</b>:</p>
            <ol class="steps">
              <li>Entra en GitHub con la cuenta <b>${esc(r.owner)}</b> y abre <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">crear token de acceso</a>.</li>
              <li>Nombre: <code>Sustituciones</code>. Caducidad: la más larga posible (o «No expiration»).</li>
              <li>En <b>Repository access</b> elige <b>Only select repositories</b> → <code>${esc(r.repo)}</code>.</li>
              <li>En <b>Permissions › Repository permissions › Contents</b> elige <b>Read and write</b>.</li>
              <li>Pulsa <b>Generate token</b>, cópialo y pégalo aquí debajo.</li>
            </ol>
            <div class="field"><label for="tokInp">Token de GitHub</label><input id="tokInp" class="inp" type="password" autocomplete="off" placeholder="github_pat_…"></div>
            <div class="err" id="tokErr"></div><button class="btn btn-primary" id="tokBtn">Conectar</button>
            <p style="margin-top:10px">El token se guarda cifrado con la contraseña de edición: solo quien la conoce puede usarlo.</p>`
            : '<p>Esto se configura cuando la aplicación está publicada en GitHub Pages.</p>'}`}
      </div>
      <div class="set-section"><h4>Cambiar la contraseña de edición</h4>
        <div class="row2"><div class="field"><label for="np1">Nueva contraseña</label><input id="np1" class="inp" type="password" autocomplete="new-password"></div>
        <div class="field"><label for="np2">Repítela</label><input id="np2" class="inp" type="password" autocomplete="new-password"></div></div>
        <div class="err" id="npErr"></div><button class="btn btn-outline" id="npBtn">Cambiar contraseña</button></div>
      <div class="set-section"><h4>Copia de seguridad</h4><p>Descarga todos los datos (personal, grupos, calendario y sustituciones) o recupera una copia.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-outline" id="bkDown">Descargar copia</button>
        <label class="btn btn-outline" style="cursor:pointer">Recuperar copia<input type="file" id="bkUp" accept="application/json,.json" hidden></label></div></div>
      <div class="set-section"><h4>Nuevo curso escolar</h4><p>Borra el calendario de guardias y las sustituciones del curso. Se mantienen el personal, los grupos y los horarios (después podrás dar de alta y de baja a quien corresponda). Descarga antes una copia de seguridad.</p>
        <div class="row2" style="max-width:420px"><div class="field"><label for="nc">Nuevo curso</label><input id="nc" class="inp" placeholder="2027-2028"></div></div>
        <button class="btn btn-danger" id="ncBtn">Empezar nuevo curso</button></div>`;

    const tokBtn = $('#tokBtn', el);
    if (tokBtn) tokBtn.onclick = async () => {
      const tok = $('#tokInp').value.trim();
      if (!tok) { $('#tokErr').textContent = 'Pega el token.'; return; }
      tokBtn.disabled = true; tokBtn.textContent = 'Conectando…';
      try {
        await Store.connectGitHub(tok);
        toast(Store.pendingCount ? '¡Conectado! Ya puedes pulsar «Publicar».' : '¡Conectado con GitHub!');
        setAccess(el);
        renderSync();
      } catch (err) {
        $('#tokErr').textContent = err.message;
        tokBtn.disabled = false; tokBtn.textContent = 'Conectar';
      }
    };
    $('#npBtn', el).onclick = async () => {
      const a = $('#np1').value; const b = $('#np2').value;
      if (a.length < 6) { $('#npErr').textContent = 'Mínimo 6 caracteres.'; return; }
      if (a !== b) { $('#npErr').textContent = 'Las contraseñas no coinciden.'; return; }
      try { await Store.changePassword(a); toast('Contraseña cambiada'); $('#np1').value = $('#np2').value = ''; $('#npErr').textContent = ''; }
      catch (err) { $('#npErr').textContent = 'No se pudo cambiar: ' + err.message; }
    };
    $('#bkDown', el).onclick = () => {
      const blob = new Blob([JSON.stringify(D(), null, 1)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `sustituciones-copia-${toISO(new Date())}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    $('#bkUp', el).onchange = (e) => {
      const f = e.target.files[0];
      if (!f) return;
      f.text().then((txt) => {
        let d;
        try { d = JSON.parse(txt); if (!Array.isArray(d.personal)) throw 0; } catch { toast('El archivo no es una copia válida', true); return; }
        confirmBox('Recuperar copia', 'Se sustituirán todos los datos actuales por los de la copia. ¿Continuar?', 'Recuperar', () => {
          Store.replaceData(d);
          ['personal', 'grupos', 'ajustes'].forEach((k) => Store.markDirty(k));
          Object.keys(D().calendario).forEach((k) => Store.markDirty('calendario:' + k));
          Object.keys(D().dias).forEach((k) => Store.markDirty('dias:' + k));
          toast('Copia recuperada. Pulsa «Publicar» para enviarla a todos.');
          setAccess(el);
        });
      });
    };
    $('#ncBtn', el).onclick = () => {
      const curso = $('#nc').value.trim();
      confirmBox('Empezar nuevo curso', 'Se borrarán el calendario de guardias y todas las sustituciones registradas. Esta acción no se puede deshacer (salvo con una copia de seguridad). ¿Continuar?', 'Borrar y empezar', () => {
        Object.keys(D().calendario).forEach((k) => Store.markDirty('calendario:' + k));
        Object.keys(D().dias).forEach((k) => Store.markDirty('dias:' + k));
        D().calendario = {};
        D().dias = {};
        D().personal = D().personal.filter((p) => !p.baja);
        if (curso) D().curso = curso;
        Store.markDirty('personal');
        toast('Nuevo curso preparado. Pulsa «Publicar» para aplicarlo.');
      });
    };
  }

  // Hora de la última publicación, en texto ("hoy a las 11:57", "ayer a las 9:10"…)
  function publishedText() {
    const iso = Store.publishedAt;
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const hm = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    const today = toISO(new Date());
    const yest = toISO(new Date(Date.now() - 86400000));
    const day = toISO(d) === today ? 'hoy' : toISO(d) === yest ? 'ayer' : d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
    return `${day} a las ${hm}`;
  }
  function renderPublished() {
    const el = $('#lastPub');
    const t = publishedText();
    el.hidden = !t;
    el.textContent = t ? `Última publicación: ${t}` : '';
  }

  // Vuelve a descargar lo último publicado (el borrador sin publicar se conserva)
  let lastLoad = Date.now();
  async function refreshDay() {
    const btn = $('#btnRefresh');
    if (btn.disabled) return;
    btn.disabled = true;
    btn.classList.add('spinning');
    try {
      await Store.reload({ fresh: true });
      lastLoad = Date.now();
      renderAll();
      const when = publishedText();
      let msg = Store.pendingCount ? 'Actualizado (tus cambios sin publicar se mantienen)' : '✓ Actualizado';
      if (when) msg += ` · última publicación ${when}`;
      if (Store.source !== 'api') msg += '. Si se acaba de publicar algo, puede tardar 1-2 minutos en llegar.';
      toast(msg);
    } catch {
      toast('No se pudo actualizar. Comprueba la conexión.', true);
    } finally {
      btn.disabled = false;
      btn.classList.remove('spinning');
    }
  }

  // Comprobación automática cada minuto mientras la app está abierta (solo consulta)
  async function autoCheck(fresh) {
    if (document.visibilityState !== 'visible' || Store.editing || $('#modalRoot').children.length) return;
    const before = Store.publishedAt;
    try { await Store.reload({ fresh }); } catch { return; }
    lastLoad = Date.now();
    if (Store.publishedAt !== before) {
      renderAll();
      if (before) toast('Hay cambios nuevos en las sustituciones');
    } else renderPublished();
  }

  /* ================= inicio ================= */
  function initTop() {
    $('#btnRefresh').onclick = refreshDay;
    $('#btnEdit').onclick = toggleEdit;
    $('#btnSettings').onclick = () => openSettings();
    $('#btnPrint').onclick = () => print();
    $('#btnShare').onclick = share;
    $('#btnPublish').onclick = doPublish;
    $('#publishBarBtn').onclick = doPublish;
    Store.on((type) => {
      if (type === 'merged') { if (!$('#modalRoot').children.length) renderAll(); }
      renderSync();
    });
    window.addEventListener('beforeunload', (e) => { if (Store.editing && Store.pendingCount) { e.preventDefault(); e.returnValue = ''; } });
    // Al volver a la app, y cada minuto mientras está abierta, mirar si hay cambios.
    // La comprobación periódica usa la copia publicada para no gastar el cupo de GitHub.
    document.addEventListener('visibilitychange', () => {
      if (Date.now() - lastLoad > 30000) autoCheck(true);
    });
    setInterval(() => autoCheck(false), 60000);
  }

  async function start() {
    initTop();
    initDateNav();
    initBoardEvents();
    initDrag();
    initInstall();
    initPresent();
    await Store.init();
    await Store.restoreSession();
    const hash = location.hash.slice(1);
    setDate(/^\d{4}-\d{2}-\d{2}$/.test(hash) ? hash : defaultDate());
    if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  start();
})();
