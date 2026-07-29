// ═══════════════════════════════════════════════════════════════
//  sibra-maestros.js — maestros de Market Suite en Supabase.
//  Reemplaza los Excel de Drive: PAPELES (clasificación de activos),
//  MODELOS (carteras objetivo por perfil/plazo) y CLIENTES (perfil).
//  Los maestros se EDITAN (módulo ../maestros/), no se acumulan: el
//  guardado es reemplazo total de la tabla.
//
//  Seguridad: las tablas tienen RLS "solo authenticated" — la anon key
//  sola no lee nada. El login es email/contraseña de Supabase Auth
//  (usuarios creados a mano en el dashboard), sesión compartida entre
//  módulos vía localStorage. Las series largas (históricos de precios,
//  movimientos) NO van a Supabase — quedan en Drive/Sheets (ver
//  comisiones/README.md).
// ═══════════════════════════════════════════════════════════════
const SibraMaestros = (() => {
  const SUPABASE_URL = 'https://mkbeddulfbqgyutrzyvr.supabase.co';
  // Clave pública del proyecto (dashboard → Settings → API Keys → Publishable).
  // Es segura de exponer: RLS deniega todo sin sesión de usuario.
  const ANON_KEY = 'sb_publishable_ewknnbpVirEVndioUqqDrw_5_N5oyZf';
  const SESSION_KEY = 'sibra_sb_session';
  const TTL = 300; // caché de lecturas, segundos

  // ── Sesión ──────────────────────────────────────────────
  function loadSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY)) || null; }
    catch { return null; }
  }
  function saveSession(s) {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  }
  function sessionEmail() { return loadSession()?.email || null; }

  async function authFetch(path, body) {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error_description || data.msg || data.message || `Auth ${r.status}`);
    return data;
  }

  async function login(email, password) {
    const d = await authFetch('token?grant_type=password', { email, password });
    saveSession({
      access_token: d.access_token, refresh_token: d.refresh_token,
      expires_at: Date.now() + (d.expires_in - 60) * 1000, email: d.user?.email || email,
    });
    return d;
  }

  async function refresh() {
    const s = loadSession();
    if (!s?.refresh_token) return null;
    try {
      const d = await authFetch('token?grant_type=refresh_token', { refresh_token: s.refresh_token });
      saveSession({
        access_token: d.access_token, refresh_token: d.refresh_token,
        expires_at: Date.now() + (d.expires_in - 60) * 1000, email: d.user?.email || s.email,
      });
      return loadSession();
    } catch { saveSession(null); return null; }
  }

  function logout() { saveSession(null); }

  async function getToken() {
    let s = loadSession();
    if (!s) return null;
    if (Date.now() >= s.expires_at) s = await refresh();
    return s?.access_token || null;
  }

  // ── Login modal (se inyecta on-demand en cualquier módulo) ──
  let modalPromise = null;
  function ensureLogin() {
    return getToken().then(tok => {
      if (tok) return tok;
      if (modalPromise) return modalPromise;
      modalPromise = new Promise((resolve, reject) => {
        const wrap = document.createElement('div');
        wrap.id = 'sbLoginModal';
        wrap.innerHTML = `
<div style="position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:9999;display:flex;align-items:center;justify-content:center;font-family:Montserrat,system-ui,sans-serif">
  <div style="background:#141414;border:1px solid #2c2c2c;border-radius:12px;padding:28px;width:340px">
    <div style="font-size:14px;font-weight:800;letter-spacing:.5px;color:#eee;margin-bottom:4px">SIBRA · Base de datos</div>
    <div style="font-size:11px;color:#888;margin-bottom:16px">Ingresá con tu usuario de la base (Supabase) para leer/editar los maestros.</div>
    <input id="sbEmail" type="email" placeholder="email" autocomplete="username" style="width:100%;margin-bottom:8px;padding:9px 10px;background:#0d0d0d;border:1px solid #2c2c2c;border-radius:7px;color:#eee;font-size:13px">
    <input id="sbPass" type="password" placeholder="contraseña" autocomplete="current-password" style="width:100%;margin-bottom:12px;padding:9px 10px;background:#0d0d0d;border:1px solid #2c2c2c;border-radius:7px;color:#eee;font-size:13px">
    <div id="sbErr" style="display:none;font-size:11px;color:#ff6b6b;margin-bottom:10px"></div>
    <div style="display:flex;gap:8px">
      <button id="sbGo" style="flex:1;padding:9px;background:#c8f751;color:#111;font-weight:800;border:0;border-radius:7px;cursor:pointer;font-size:12px">Entrar</button>
      <button id="sbNo" style="padding:9px 14px;background:#222;color:#aaa;border:1px solid #2c2c2c;border-radius:7px;cursor:pointer;font-size:12px">Cancelar</button>
    </div>
  </div>
</div>`;
        document.body.appendChild(wrap);
        const done = (fn, v) => { wrap.remove(); modalPromise = null; fn(v); };
        wrap.querySelector('#sbNo').onclick = () => done(reject, new Error('Login cancelado.'));
        const go = async () => {
          const err = wrap.querySelector('#sbErr');
          try {
            err.style.display = 'none';
            await login(wrap.querySelector('#sbEmail').value.trim(), wrap.querySelector('#sbPass').value);
            done(resolve, loadSession().access_token);
            document.dispatchEvent(new CustomEvent('sibra-maestros-login'));
          } catch (e) { err.textContent = e.message; err.style.display = ''; }
        };
        wrap.querySelector('#sbGo').onclick = go;
        wrap.querySelector('#sbPass').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
        wrap.querySelector('#sbEmail').focus();
      });
      return modalPromise;
    });
  }

  // ── REST (PostgREST) ────────────────────────────────────
  async function rest(pathQuery, { method = 'GET', body = null, headers = {} } = {}) {
    const token = await ensureLogin();
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${pathQuery}`, {
      method,
      headers: {
        apikey: ANON_KEY, Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json', ...headers,
      },
      body: body === null ? undefined : JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
    if (r.status === 204) return null;
    const txt = await r.text();
    return txt ? JSON.parse(txt) : null;
  }

  async function selectAll(table, orderBy) {
    // PostgREST pagina de a 1000 — traemos todo con Range
    const out = [];
    for (let from = 0; ; from += 1000) {
      const page = await rest(`${table}?select=*${orderBy ? '&order=' + orderBy : ''}`, {
        headers: { Range: `${from}-${from + 999}` },
      });
      out.push(...page);
      if (page.length < 1000) break;
    }
    return out;
  }

  // ── REST público (SIN login) — solo para tablas con policy de lectura
  // pública (ej. series_valores de indices: datos de mercado, no de un
  // cliente). NO usar con market_papeles/modelos/clientes ni brokers_* —
  // esas exigen sesión (ensureLogin) por diseño.
  async function restPublic(pathQuery, { headers = {} } = {}) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${pathQuery}`, {
      headers: { apikey: ANON_KEY, ...headers },
    });
    if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
    return r.json();
  }

  async function selectAllPublic(table, query = '') {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const page = await restPublic(`${table}?select=*${query}`, {
        headers: { Range: `${from}-${from + 999}` },
      });
      out.push(...page);
      if (page.length < 1000) break;
    }
    return out;
  }

  // ── Lecturas con caché (mismo SibraCache que el resto) ──
  const cache = (typeof SibraCache !== 'undefined') ? SibraCache
    : { get: () => null, set: () => {}, invalidate: () => {} };

  async function fetchCached(key, fn, fresh) {
    if (!fresh) { const c = cache.get(key, TTL); if (c) return c; }
    else cache.invalidate(key);
    const data = await fn();
    cache.set(key, data);
    return data;
  }

  const papeles  = ({ fresh = false } = {}) => fetchCached('maestros_papeles',  () => selectAll('market_papeles', 'simbolo'), fresh);
  const modelos  = ({ fresh = false } = {}) => fetchCached('maestros_modelos',  () => selectAll('market_modelos', 'perfil,plazo,ticker'), fresh);
  const clientes = ({ fresh = false } = {}) => fetchCached('maestros_clientes', () => selectAll('market_clientes', 'alyc,cc'), fresh);

  function invalidate() {
    ['maestros_papeles', 'maestros_modelos', 'maestros_clientes'].forEach(k => cache.invalidate(k));
  }

  // ── Adaptadores a las formas legacy de los módulos ──────
  // dict SIMBOLO → {subgrupo, grupo, pais, ...} (forma S.allocation de `actual`)
  function papelesDict(rows) {
    const d = {};
    rows.forEach(r => {
      d[r.simbolo] = {
        subgrupo: r.subgrupo, grupo: r.grupo, pais: r.pais, moneda: r.moneda,
        subtipo: r.subtipo, sector: r.sector, industria: r.industria,
        vto: r.vto, monedaCartera: r.moneda_cartera,
      };
    });
    return d;
  }

  // {perfil: {plazo: [{ticker, ponderacion, precioRef}]}} (forma S.modelos de `actual`)
  function modelosPorPerfil(rows) {
    const m = {};
    rows.forEach(r => {
      if (!m[r.perfil]) m[r.perfil] = {};
      if (!m[r.perfil][r.plazo]) m[r.perfil][r.plazo] = [];
      m[r.perfil][r.plazo].push({
        ticker: r.ticker, ponderacion: Number(r.ponderacion) || 0,
        precioRef: r.precio_ref === null ? null : Number(r.precio_ref),
      });
    });
    return m;
  }

  // ── Escritura: reemplazo total de una tabla ─────────────
  // Los maestros se modifican todo el tiempo (no se acumulan): guardar =
  // borrar todo + insertar lo editado. Chunks de 500 para PostgREST.
  const PK_COL = { market_papeles: 'simbolo', market_modelos: 'ticker', market_clientes: 'cc' };
  async function replaceTable(table, rows) {
    const pk = PK_COL[table];
    if (!pk) throw new Error('Tabla desconocida: ' + table);
    await rest(`${table}?${pk}=neq.__nunca__`, { method: 'DELETE' });
    for (let i = 0; i < rows.length; i += 500) {
      await rest(table, { method: 'POST', body: rows.slice(i, i + 500), headers: { Prefer: 'return=minimal' } });
    }
    invalidate();
    return rows.length;
  }

  return {
    SUPABASE_URL, sessionEmail, login, logout, ensureLogin, rest, selectAll,
    restPublic, selectAllPublic,
    papeles, modelos, clientes, papelesDict, modelosPorPerfil, replaceTable, invalidate,
  };
})();
