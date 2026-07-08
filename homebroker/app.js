const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const numFmt=n=>new Intl.NumberFormat('es-AR',{maximumFractionDigits:2}).format(n||0);
function toast(t){$('#toast').textContent=t;$('#toast').classList.add('show');setTimeout(()=>$('#toast').classList.remove('show'),3000)}

// ══════════════════════════════════════════
//  GOOGLE OAUTH (mismo patrón que market/actual — implicit flow, client-side)
// ══════════════════════════════════════════
const CLIENT_ID = '891275909999-25to444ggoo9k1inji4lqbaq1h99ij41.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets.readonly';
// Sheet TENENCIAS generado por sibra-brokers-repo/scripts/setup_sheets.py
const TENENCIAS_SHEET_ID = '1tZVHEgp6nYax-nIdY1WSOYesucrMY_H2rtkXdSwhPAs';
// Mismo endpoint que market/rotaciones/data912.js — MEP = AL30 (ARS) / AL30D (USD)
const DATA912_URL = 'https://data912.com/api/live_arg_corp';

const S = { token: null, tokenExpiry: null, ccy: 'ARS', mep: null };

function connect() {
  const redirectUri = location.href.split('?')[0].split('#')[0];
  const state = Math.random().toString(36).slice(2);
  sessionStorage.setItem('oauth_state', state);
  const params = new URLSearchParams({
    client_id: CLIENT_ID, redirect_uri: redirectUri, response_type: 'token',
    scope: SCOPES, state, prompt: 'select_account', login_hint: 'web.sibra@gmail.com',
  });
  const popup = window.open('https://accounts.google.com/o/oauth2/v2/auth?' + params, 'googleOAuth', 'width=520,height=640,left=200,top=100');
  const timer = setInterval(() => {
    try {
      const url = popup.location.href;
      if (url.includes('access_token') || url.includes('error')) {
        clearInterval(timer); popup.close();
        const hash = new URLSearchParams(new URL(url).hash.slice(1));
        const err = hash.get('error');
        if (err) { $('#loginError').textContent = 'Error de autenticación: ' + err; return; }
        setToken(hash.get('access_token'), parseInt(hash.get('expires_in') || '3600'));
        showApp();
      }
    } catch (e) {}
    if (popup.closed) clearInterval(timer);
  }, 500);
}

function setToken(token, expiresIn) {
  S.token = token;
  S.tokenExpiry = new Date(Date.now() + expiresIn * 1000);
  localStorage.setItem('sibra_hb_token', token);
  localStorage.setItem('sibra_hb_token_exp', S.tokenExpiry.toISOString());
}

function restoreToken() {
  const tok = localStorage.getItem('sibra_hb_token');
  const exp = localStorage.getItem('sibra_hb_token_exp');
  if (tok && exp && new Date(exp) > new Date()) { S.token = tok; S.tokenExpiry = new Date(exp); return true; }
  localStorage.removeItem('sibra_hb_token'); localStorage.removeItem('sibra_hb_token_exp');
  return false;
}

function logout() {
  S.token = null;
  localStorage.removeItem('sibra_hb_token'); localStorage.removeItem('sibra_hb_token_exp');
  location.reload();
}

async function sheetValues(range) {
  if (!S.token) throw new Error('No hay token. Conectate con Google primero.');
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${TENENCIAS_SHEET_ID}/values/${range}`;
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + S.token } });
  if (!r.ok) throw new Error(`Sheets API error ${r.status}: ${await r.text()}`);
  return r.json();
}

function rowsFromValues(values) {
  if (!values || !values.length) return [];
  const headers = values[0];
  return values.slice(1).map(row => Object.fromEntries(headers.map((h, i) => [h, row[i] ?? ''])));
}

// ══════════════════════════════════════════
//  MEP (dólar bolsa) — mismo cálculo que market/rotaciones/data912.js
// ══════════════════════════════════════════
async function fetchMep() {
  try {
    const r = await fetch(DATA912_URL, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`data912 HTTP ${r.status}`);
    const data = await r.json();
    const items = Array.isArray(data) ? data : (data.data || data.prices || []);
    const priceOf = t => {
      const item = items.find(i => String(i.ticker || i.symbol || '').toUpperCase() === t);
      return item ? parseFloat(item.price || item.last || item.close || 0) / 100 : null;
    };
    const al30 = priceOf('AL30'), al30d = priceOf('AL30D');
    if (al30 && al30d) { S.mep = al30 / al30d; }
  } catch (e) { console.warn('[MEP] no se pudo calcular:', e.message); S.mep = null; }
  $('#mepBadge').textContent = S.mep ? `MEP $${numFmt(S.mep)}` : 'MEP no disponible';
  $('#mepBadge').classList.remove('hidden');
}

function fmtCcy(arsValue, unitPrice = false) {
  const v = parseFloat(arsValue) || 0;
  const decimals = unitPrice ? 2 : 0;
  if (S.ccy === 'USD') {
    if (!S.mep) return '—';
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'USD', minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(v / S.mep);
  }
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(v);
}

function setCcy(ccy) {
  S.ccy = ccy;
  $('#ccyArs').classList.toggle('active', ccy === 'ARS');
  $('#ccyUsd').classList.toggle('active', ccy === 'USD');
  render();
}

// ══════════════════════════════════════════
//  UI
// ══════════════════════════════════════════
$$('[data-tab]').forEach(b => b.onclick = () => {
  $$('[data-tab]').forEach(x => x.classList.remove('active')); b.classList.add('active');
  $$('.tab').forEach(x => x.classList.remove('active')); $('#tab-' + b.dataset.tab).classList.add('active');
});

let allRows = [];

function options(el, arr) { el.innerHTML = arr.map(x => `<option value="${x}">${x}</option>`).join('') }

function loadFilters() {
  options($('#fClient'), [...new Set(allRows.map(r => r.client_name).filter(Boolean))].sort());
  options($('#fBroker'), [...new Set(allRows.map(r => r.broker_code).filter(Boolean))].sort());
  options($('#fAccount'), [...new Set(allRows.map(r => r.account).filter(Boolean))].sort());
  options($('#fTicker'), [...new Set(allRows.map(r => r.ticker).filter(Boolean))].sort());
}

function selected(id) { return [...$(id).selectedOptions].map(o => o.value) }

function filteredRows() {
  const c = selected('#fClient'), b = selected('#fBroker'), a = selected('#fAccount'), t = selected('#fTicker');
  return allRows.filter(r =>
    (!c.length || c.includes(r.client_name)) &&
    (!b.length || b.includes(r.broker_code)) &&
    (!a.length || a.includes(r.account)) &&
    (!t.length || t.includes(r.ticker))
  );
}

function pctPill(pct) {
  const v = parseFloat(pct);
  if (Number.isNaN(v)) return '<span class="na">—</span>';
  return `<span class="pct-pill ${v >= 0 ? 'pos' : 'neg'}">${v >= 0 ? '+' : ''}${numFmt(v)}%</span>`;
}

function render() {
  const rows = filteredRows().slice().sort((x, y) => (parseFloat(y.market_value_ars) || 0) - (parseFloat(x.market_value_ars) || 0));
  const total = rows.reduce((a, r) => a + (parseFloat(r.market_value_ars) || 0), 0);
  const accounts = new Set(rows.map(r => r.broker_code + '|' + r.account)).size;
  const refreshed = rows.map(r => r.refreshed_at).sort().slice(-1)[0] || '—';
  $('#mTotal').textContent = fmtCcy(total);
  $('#mHoldings').textContent = rows.length;
  $('#mAccounts').textContent = accounts;
  $('#mRefreshed').textContent = refreshed;

  $('#holdingsBody').innerHTML = rows.map(r => `<tr>
    <td>${r.client_name}</td>
    <td>${r.broker_code}</td>
    <td>${r.account}</td>
    <td><b>${r.ticker}</b></td>
    <td>${r.asset_group}</td>
    <td class="num">${numFmt(r.quantity)}</td>
    <td class="num">${fmtCcy(r.average_cost, true)}</td>
    <td class="num">${fmtCcy(r.last_price, true)}</td>
    <td class="num">${fmtCcy(r.market_value_ars)}</td>
    <td class="num">${pctPill(r.unrealized_pnl_pct)}</td>
    <td class="num na" title="Requiere el histórico de movimientos (FIFO), todavía no implementado">—</td>
  </tr>`).join('');

  $('#top').innerHTML = rows.slice(0, 8).map(r => `<div class="row"><b>${r.ticker}</b><span>${r.client_name} · ${r.broker_code} ${r.account}</span><strong>${fmtCcy(r.market_value_ars)}</strong></div>`).join('');
}

async function load() {
  const data = await sheetValues('CURRENT');
  allRows = rowsFromValues(data.values);
  loadFilters(); render();
}

['#fClient', '#fBroker', '#fAccount', '#fTicker'].forEach(id => $(id).onchange = render);
$('#clear').onclick = () => { $$('.filters select').forEach(x => [...x.options].forEach(o => o.selected = false)); render() };
$('#refresh').onclick = async () => { toast('Actualizando…'); try { await Promise.all([load(), fetchMep()]); toast('Actualizado'); } catch (e) { toast('Error: ' + e.message) } };
$('#btnConnect').onclick = connect;
$('#logout').onclick = logout;
$('#ccyArs').onclick = () => setCcy('ARS');
$('#ccyUsd').onclick = () => setCcy('USD');

async function showApp() {
  $('#login').classList.add('hidden'); $('#app').classList.remove('hidden');
  try { await Promise.all([load(), fetchMep()]); } catch (e) { toast('Error: ' + e.message) }
}

if (restoreToken()) showApp();
