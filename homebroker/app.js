const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const numFmt=n=>new Intl.NumberFormat('es-AR',{maximumFractionDigits:2}).format(n||0);
function toast(t){$('#toast').textContent=t;$('#toast').classList.add('show');setTimeout(()=>$('#toast').classList.remove('show'),3000)}

// ══════════════════════════════════════════
//  GOOGLE OAUTH — sesión compartida con el resto de Market Suite
//  (ver shared/sibra-auth.js, shared/sibra-cache.js)
// ══════════════════════════════════════════
// Sheets generados por sibra-brokers-repo/scripts/setup_sheets.py
const TENENCIAS_SHEET_ID = '1tZVHEgp6nYax-nIdY1WSOYesucrMY_H2rtkXdSwhPAs';
const CAUCIONES_SHEET_ID = '1mSEmdabwij0ySAUtXTN_eXvbf17dmK-Gs6ze_5N3bcs';
// MEP = AL30 (ARS) / AL30D (USD). OJO: el endpoint real (según data912.com/openapi.json)
// es /live/arg_bonds, campos symbol/c — NO /api/live_arg_corp (eso da 404).
const DATA912_URL = 'https://data912.com/live/arg_bonds';
const SHEET_CACHE_TTL = 60; // segundos

const S = { ccy: 'ARS', mep: null };

async function connect() {
  try { await SibraAuth.connect(); showApp(); }
  catch (e) { $('#loginError').textContent = 'Error de autenticación: ' + e.message; }
}

function logout() { SibraAuth.logout(); location.reload(); }

async function sheetValues(sheetId, range, { fresh = false } = {}) {
  const token = SibraAuth.getToken();
  if (!token) throw new Error('No hay token. Conectate con Google primero.');
  const cacheKey = `sheet_${sheetId}_${range}`;
  if (!fresh) {
    const cached = SibraCache.get(cacheKey, SHEET_CACHE_TTL);
    if (cached) return cached;
  }
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}`;
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  if (!r.ok) throw new Error(`Sheets API error ${r.status}: ${await r.text()}`);
  const data = await r.json();
  SibraCache.set(cacheKey, data);
  return data;
}

function rowsFromValues(values) {
  if (!values || !values.length) return [];
  const headers = values[0];
  return values.slice(1).map(row => Object.fromEntries(headers.map((h, i) => [h, row[i] ?? ''])));
}

// ══════════════════════════════════════════
//  MEP (dólar bolsa) — AL30 (ARS) / AL30D (USD), ambos como vienen de data912
//  (sin dividir por 100: ese ajuste es para mostrar precio "por cada 100
//  nominales" en otras pantallas, no aplica al cociente del MEP)
// ══════════════════════════════════════════
async function fetchMep() {
  try {
    const r = await fetch(DATA912_URL, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`data912 HTTP ${r.status}`);
    const items = await r.json();
    const priceOf = sym => {
      const item = items.find(i => String(i.symbol || '').toUpperCase() === sym);
      return item ? parseFloat(item.c || 0) : null;
    };
    const al30 = priceOf('AL30'), al30d = priceOf('AL30D');
    if (al30 && al30d) { S.mep = al30 / al30d; }
  } catch (e) { console.warn('[MEP] no se pudo calcular:', e.message); S.mep = null; }
  $('#mepBadge').textContent = S.mep ? `MEP $${numFmt(S.mep)}` : 'MEP no disponible';
  $('#mepBadge').classList.remove('hidden');
  // load() y fetchMep() corren en paralelo (Promise.all) — el que termine
  // último debe volver a pintar, si no la pesificación de cauciones USD
  // (bruta, % bruto) queda calculada con mep=null cuando load() gana la carrera.
  if (allRows.length) render();
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
let allCauciones = [];

// ══════════════════════════════════════════
//  Filtros: multiselect con buscador (reemplaza <select multiple>)
// ══════════════════════════════════════════
const FILTER_DEFS = [
  { key: 'clients', field: 'client_name', label: 'Cliente' },
  { key: 'brokers', field: 'broker_code', label: 'ALyC' },
  { key: 'accounts', field: 'account', label: 'Comitente' },
  { key: 'tickers', field: 'ticker', label: 'Título' },
];
const filterState = Object.fromEntries(FILTER_DEFS.map(d => [d.key, new Set()]));

function closeAllMsel() { $$('.msel-panel').forEach(p => p.classList.add('hidden')) }

function buildMultiSelects() {
  FILTER_DEFS.forEach(def => {
    const root = $(`.msel[data-key="${def.key}"]`);
    const btn = root.querySelector('.msel-btn');
    const panel = root.querySelector('.msel-panel');
    const search = root.querySelector('.msel-search');
    const optsEl = root.querySelector('.msel-options');

    // Opciones acotadas por los filtros ANTERIORES en la jerarquía (Cliente →
    // ALyC → Comitente → Título) — si elegís un cliente, ALyC/Comitente/Título
    // solo muestran lo que ese cliente realmente tiene.
    const idx = FILTER_DEFS.indexOf(def);
    function optionValues() {
      const rows = allRows.filter(r => FILTER_DEFS.every((d, j) => j >= idx || !filterState[d.key].size || filterState[d.key].has(r[d.field])));
      return [...new Set(rows.map(r => r[def.field]).filter(Boolean))].sort();
    }

    function renderOptions(filterText = '') {
      const q = filterText.toLowerCase();
      const vals = optionValues().filter(v => v.toLowerCase().includes(q));
      optsEl.innerHTML = vals.length
        ? vals.map(v => `<label class="msel-opt"><input type="checkbox" value="${v}" ${filterState[def.key].has(v) ? 'checked' : ''}> ${v}</label>`).join('')
        : '<div class="msel-empty">Sin resultados</div>';
    }

    function updateBtnLabel() {
      const n = filterState[def.key].size;
      btn.textContent = n ? `${def.label} (${n})` : def.label + ': Todos';
      btn.classList.toggle('active', n > 0);
    }

    btn.onclick = e => {
      e.stopPropagation();
      const wasOpen = !panel.classList.contains('hidden');
      closeAllMsel();
      if (!wasOpen) { search.value = ''; renderOptions(); panel.classList.remove('hidden'); search.focus(); }
    };
    search.oninput = () => renderOptions(search.value);
    optsEl.onchange = e => {
      if (e.target.type !== 'checkbox') return;
      if (e.target.checked) filterState[def.key].add(e.target.value); else filterState[def.key].delete(e.target.value);
      pruneInvalidSelections(idx);
      refreshFilterLabels(); render();
    };
    panel.onclick = e => e.stopPropagation();

    def._update = updateBtnLabel;
  });
  document.addEventListener('click', closeAllMsel);
}

function refreshFilterLabels() { FILTER_DEFS.forEach(d => d._update()) }

// Jerarquía Cliente → ALyC → Comitente → Título (orden de FILTER_DEFS): cada
// filtro solo acota a los que vienen DESPUÉS, nunca a los anteriores. Si fuera
// simétrico (cualquiera acota a cualquiera) se puede armar un candado circular
// — ej. tildás un comitente de OTRO cliente y después el cliente que buscás
// desaparece de su propia lista porque ya no matchea el comitente tildado.
function pruneInvalidSelections(changedIdx) {
  for (let i = changedIdx + 1; i < FILTER_DEFS.length; i++) {
    const d = FILTER_DEFS[i];
    if (!filterState[d.key].size) continue;
    const validRows = allRows.filter(r => FILTER_DEFS.every((o, j) => j >= i || !filterState[o.key].size || filterState[o.key].has(r[o.field])));
    const validValues = new Set(validRows.map(r => r[d.field]));
    [...filterState[d.key]].forEach(v => { if (!validValues.has(v)) filterState[d.key].delete(v); });
  }
}

function filteredRows() {
  return allRows.filter(r =>
    (!filterState.clients.size || filterState.clients.has(r.client_name)) &&
    (!filterState.brokers.size || filterState.brokers.has(r.broker_code)) &&
    (!filterState.accounts.size || filterState.accounts.has(r.account)) &&
    (!filterState.tickers.size || filterState.tickers.has(r.ticker))
  );
}

function filteredCauciones() {
  return allCauciones.filter(c =>
    (!filterState.clients.size || filterState.clients.has(c.client_name)) &&
    (!filterState.brokers.size || filterState.brokers.has(c.broker_code)) &&
    (!filterState.accounts.size || filterState.accounts.has(c.account))
  );
}

function pctPill(pct) {
  const v = parseFloat(pct);
  if (Number.isNaN(v)) return '<span class="na">—</span>';
  return `<span class="pct-pill ${v >= 0 ? 'pos' : 'neg'}">${v >= 0 ? '+' : ''}${numFmt(v)}%</span>`;
}

// Etiquetas del grupo de activo tal como vienen de BCCH -> nombre usual
const ASSET_GROUP_LABELS = {
  'Titulos Publicos': 'Bonos $',
  'Titulos Publicos U$S': 'Bonos U$D',
};
function assetGroupLabel(g) { return ASSET_GROUP_LABELS[g] || g }

// Cauciones TOMADORA vigentes de las cuentas filtradas — mismo criterio que
// market/actual: bruta = neta + caución tomadora pesificada al MEP (la
// colocadora es plata prestada por el cliente, no apalancamiento, no infla la bruta).
function caucionTomadoraTotals(rows) {
  const cuentas = new Set(rows.map(r => r.broker_code + '|' + r.account));
  const vigentes = allCauciones.filter(c => c.status === 'VIGENTE' && c.side === 'TOMADORA' && cuentas.has(c.broker_code + '|' + c.account));
  const ars = vigentes.filter(c => c.currency === 'ARS').reduce((s, c) => s + (parseFloat(c.capital) || 0), 0);
  const usd = vigentes.filter(c => c.currency === 'USD').reduce((s, c) => s + (parseFloat(c.capital) || 0), 0);
  return { ars, usd, totalArs: ars + (S.mep ? usd * S.mep : 0) };
}
function caucionTomadoraArs(rows) { return caucionTomadoraTotals(rows).totalArs; }

// Neta/bruta por cuenta (broker_code|account), sobre TODA la cartela de esa
// cuenta (allRows, no filteredRows) — igual que market/actual: el % de cada
// posición es sobre el total real de su cuenta, no sobre el subconjunto filtrado.
function accountTotals() {
  const groups = new Map();
  allRows.forEach(r => {
    const key = r.broker_code + '|' + r.account;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  });
  const totals = new Map();
  groups.forEach((rows, key) => {
    const neta = rows.reduce((s, r) => s + (parseFloat(r.market_value_ars) || 0), 0);
    totals.set(key, { neta, bruta: neta + caucionTomadoraArs(rows) });
  });
  return totals;
}

function render() {
  const rows = filteredRows().slice().sort((x, y) => (parseFloat(y.market_value_ars) || 0) - (parseFloat(x.market_value_ars) || 0));
  const total = rows.reduce((a, r) => a + (parseFloat(r.market_value_ars) || 0), 0);
  const totals = accountTotals();
  const accounts = new Set(rows.map(r => r.broker_code + '|' + r.account)).size;
  const refreshed = rows.map(r => r.refreshed_at).sort().slice(-1)[0] || '—';
  const neta = total;
  const caucion = caucionTomadoraTotals(rows);
  const bruta = neta + caucion.totalArs;
  $('#mTotal').textContent = fmtCcy(total);
  $('#mNeta').textContent = fmtCcy(neta);
  $('#mBruta').textContent = fmtCcy(bruta);
  $('#mNetaTen').textContent = fmtCcy(neta);
  $('#mBrutaTen').textContent = fmtCcy(bruta);
  $('#mCaucionArs').textContent = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(caucion.ars);
  $('#mCaucionUsd').textContent = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(caucion.usd);
  $('#mHoldings').textContent = rows.length;
  $('#mAccounts').textContent = accounts;
  $('#mRefreshed').textContent = refreshed;

  $('#holdingsBody').innerHTML = rows.map(r => {
    const acc = totals.get(r.broker_code + '|' + r.account) || { neta: 0, bruta: 0 };
    const valor = parseFloat(r.market_value_ars) || 0;
    const pctNeto = acc.neta ? valor / acc.neta * 100 : 0;
    const pctBruto = acc.bruta ? valor / acc.bruta * 100 : 0;
    return `<tr>
    <td>${r.client_name}</td>
    <td>${r.broker_code}</td>
    <td>${r.account}</td>
    <td><b>${r.ticker}</b></td>
    <td>${assetGroupLabel(r.asset_group)}</td>
    <td class="num">${numFmt(r.quantity)}</td>
    <td class="num">${fmtCcy(r.average_cost, true)}</td>
    <td class="num">${fmtCcy(r.last_price, true)}</td>
    <td class="num">${fmtCcy(r.market_value_ars)}</td>
    <td class="num">${pctPill(r.unrealized_pnl_pct)}</td>
    <td class="num">${numFmt(pctNeto)}%</td>
    <td class="num">${numFmt(pctBruto)}%</td>
    <td class="num na" title="Requiere el histórico de movimientos (FIFO), todavía no implementado">—</td>
  </tr>`;
  }).join('');

  $('#top').innerHTML = rows.slice(0, 8).map(r => `<div class="row"><b>${r.ticker}</b><span>${r.client_name} · ${r.broker_code} ${r.account}</span><strong>${fmtCcy(r.market_value_ars)}</strong></div>`).join('');

  renderCauciones();
}

function caucionRow(c) {
  const estado = c.status === 'VIGENTE' ? '<span class="pct-pill pos">Vigente</span>' : '<span class="pct-pill neg">Vencida</span>';
  const capital = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(parseFloat(c.capital) || 0);
  return `<tr>
    <td>${c.client_name}</td>
    <td>${c.broker_code}</td>
    <td>${c.account}</td>
    <td>${c.side === 'TOMADORA' ? 'Tomadora' : 'Colocadora'}</td>
    <td>${c.start_date || '—'}</td>
    <td>${c.maturity_date || '—'}</td>
    <td class="num">${capital}</td>
    <td>${estado}</td>
  </tr>`;
}

function renderCauciones() {
  const rows = filteredCauciones().slice().sort((a, b) => (a.maturity_date || '9999').localeCompare(b.maturity_date || '9999'));
  const ars = rows.filter(c => c.currency === 'ARS');
  const usd = rows.filter(c => c.currency === 'USD');
  $('#caucionesArsBody').innerHTML = ars.length ? ars.map(caucionRow).join('') : '<tr><td colspan="8" class="na">Sin cauciones en pesos</td></tr>';
  $('#caucionesUsdBody').innerHTML = usd.length ? usd.map(caucionRow).join('') : '<tr><td colspan="8" class="na">Sin cauciones en dólares</td></tr>';
}

async function load(fresh = false) {
  const holdings = await sheetValues(TENENCIAS_SHEET_ID, 'CURRENT', { fresh });
  allRows = rowsFromValues(holdings.values);
  try {
    const cauciones = await sheetValues(CAUCIONES_SHEET_ID, 'CURRENT', { fresh });
    allCauciones = rowsFromValues(cauciones.values);
  } catch (e) {
    // No dejamos que un problema en Cauciones (sheet nueva, puede no existir
    // todavía o fallar por separado) tumbe también las Tenencias.
    console.warn('[Cauciones] no se pudo cargar:', e.message);
    allCauciones = [];
    toast('No se pudieron cargar las cauciones: ' + e.message);
  }
  refreshFilterLabels(); render();
}

$('#clear').onclick = () => {
  FILTER_DEFS.forEach(d => filterState[d.key].clear());
  closeAllMsel(); refreshFilterLabels(); render();
};
$('#refresh').onclick = async () => { toast('Actualizando…'); try { await Promise.all([load(true), fetchMep()]); toast('Actualizado'); } catch (e) { toast('Error: ' + e.message) } };
$('#btnConnect').onclick = connect;
$('#logout').onclick = logout;
$('#ccyArs').onclick = () => setCcy('ARS');
$('#ccyUsd').onclick = () => setCcy('USD');

async function showApp() {
  $('#login').classList.add('hidden'); $('#app').classList.remove('hidden');
  buildMultiSelects();
  try { await Promise.all([load(), fetchMep()]); } catch (e) { toast('Error: ' + e.message) }
}

if (SibraAuth.getToken()) showApp();
