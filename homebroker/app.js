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

// Unifica el "Tipo" a una taxonomía común (misma para BCCH e IEB que para
// ADCAP): tipo base + moneda ($ / U$D). ADCAP manda grupos tipo
// "Cedears / Pesos" o "Títulos Públicos / Dolar MEP (Local)"; los normalizamos
// para que la columna quede consistente con data912 (CEDEARs, Acciones, Bonos,
// ON, ETFs, FCI) en vez de mezclar formatos por broker.
const ASSET_GROUP_LABELS = {
  'Titulos Publicos': 'Bonos $',
  'Titulos Publicos U$S': 'Bonos U$D',
};
const ADCAP_TYPE_MAP = {
  'Cedears': 'CEDEARs', 'Acciones': 'Acciones', 'ETFs': 'ETFs', 'Fondos': 'FCI',
  'Títulos Públicos': 'Bonos', 'Titulos Publicos': 'Bonos',
  'Obligaciones Negociables': 'ON', 'Cuenta Corriente': 'Cuenta Corriente',
  'Posición Informativa': 'Info', 'Posicion Informativa': 'Info',
};
function assetGroupLabel(group, currency) {
  if (ASSET_GROUP_LABELS[group]) return ASSET_GROUP_LABELS[group];
  if (!group) return '—';
  const parts = group.split('/').map(s => s.trim());
  const rawType = parts[0], moneda = parts.slice(1).join(' ');
  const type = ADCAP_TYPE_MAP[rawType] || rawType;
  const usd = String(currency || '').toUpperCase() === 'USD' || /d[oó]lar|u\$s|usd|cable|mep/i.test(moneda);
  if (type === 'Info') return 'Info';
  if (type === 'Cuenta Corriente') return 'Cuenta Corriente ' + (usd ? 'U$D' : '$');
  return type + (usd ? ' U$D' : ' $');
}

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
    <td>${assetGroupLabel(r.asset_group, r.currency)}</td>
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
  renderCuentaCorriente();
}

function daysBetween(a, b) {
  if (!a || !b) return null;
  const days = Math.round((new Date(b) - new Date(a)) / 86400000);
  return days > 0 ? days : null;
}

const fmtArs0 = n => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n || 0);
const fmtUsd0 = n => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n || 0);

// Totales vigentes por moneda (ambos lados) + su vencimiento más próximo —
// no el histórico completo, solo lo que hay hoy y cuándo se libera.
function caucionVigenteTotals(rows, currency) {
  const vigentes = rows.filter(c => c.status === 'VIGENTE' && c.currency === currency);
  const total = vigentes.reduce((s, c) => s + (parseFloat(c.capital) || 0), 0);
  const nextMaturity = vigentes.map(c => c.maturity_date).filter(Boolean).sort()[0] || null;
  return { total, nextMaturity };
}

// Promedio de capital tomado, tasa directa y TNA sobre cauciones ARS ya
// VENCIDAS (son las únicas con capital, interés y plazo real conocidos —
// las TCCD/TOCT/CCCD/CCTE de la cuenta corriente) para un lado dado.
function caucionRateStats(rows, side) {
  const vencidas = rows.filter(c => c.status === 'VENCIDA' && c.currency === 'ARS' && c.side === side);
  if (!vencidas.length) return null;
  const rates = vencidas.map(c => {
    const capital = parseFloat(c.capital) || 0;
    const interest = parseFloat(c.interest) || 0;
    const days = daysBetween(c.start_date, c.maturity_date) || 1;
    const directa = capital ? interest / capital * 100 : 0;
    return { capital, directa, tna: directa * 365 / days };
  });
  const avg = key => rates.reduce((s, r) => s + r[key], 0) / rates.length;
  return { count: rates.length, avgCapital: avg('capital'), avgDirecta: avg('directa'), avgTna: avg('tna') };
}

function caucionStatRow(label, s) {
  return `<tr>
    <td>${label}</td>
    <td class="num">${s.count}</td>
    <td class="num">${fmtArs0(s.avgCapital)}</td>
    <td class="num">${numFmt(s.avgDirecta)}%</td>
    <td class="num">${numFmt(s.avgTna)}%</td>
  </tr>`;
}

function renderCauciones() {
  const rows = filteredCauciones();
  const ars = caucionVigenteTotals(rows, 'ARS');
  const usd = caucionVigenteTotals(rows, 'USD');
  $('#caucionVigenteArs').textContent = fmtArs0(ars.total);
  $('#caucionVencArs').textContent = ars.nextMaturity || '—';
  $('#caucionVigenteUsd').textContent = fmtUsd0(usd.total);
  $('#caucionVencUsd').textContent = usd.nextMaturity || '—';

  const stats = [
    caucionRateStats(rows, 'TOMADORA') && caucionStatRow('Tomadora', caucionRateStats(rows, 'TOMADORA')),
    caucionRateStats(rows, 'COLOCADORA') && caucionStatRow('Colocadora', caucionRateStats(rows, 'COLOCADORA')),
  ].filter(Boolean);
  $('#caucionStatsBody').innerHTML = stats.length ? stats.join('') : '<tr><td colspan="5" class="na">Sin cauciones en pesos vencidas todavía</td></tr>';
  renderCuentasDecidir();
}

// ── Cuentas a decidir: cauciones VIGENTES por cuenta ($ y U$S), para que la
//    mesa decida cerrar o renovar. Respeta los filtros ALyC/comitente. ──
function accountCaucionesVigentes(rows) {
  const m = {};
  rows.filter(c => c.status === 'VIGENTE').forEach(c => {
    const key = c.broker_code + '|' + c.account;
    if (!m[key]) m[key] = { cliente: c.client_name, alyc: c.broker_code, comitente: c.account, ars: 0, usd: 0, venc: null };
    const cap = parseFloat(c.capital) || 0;
    if (String(c.currency).toUpperCase() === 'USD') m[key].usd += cap; else m[key].ars += cap;
    if (c.maturity_date && (!m[key].venc || c.maturity_date < m[key].venc)) m[key].venc = c.maturity_date;
  });
  return Object.values(m).sort((a, b) => (b.ars + b.usd) - (a.ars + a.usd));
}
function renderCuentasDecidir() {
  const accts = accountCaucionesVigentes(filteredCauciones());
  $('#caucionDecidirBody').innerHTML = accts.length ? accts.map(a => `<tr>
    <td>${a.cliente}</td><td>${a.alyc}</td><td>${a.comitente}</td>
    <td class="num">${a.ars ? fmtArs0(a.ars) : '—'}</td>
    <td class="num">${a.usd ? fmtUsd0(a.usd) : '—'}</td>
    <td>${a.venc || '—'}</td>
  </tr>`).join('') : '<tr><td colspan="6" class="na">Sin cauciones vigentes</td></tr>';
}

// ── Cuenta Corriente: saldos de efectivo por cuenta. Los dólares se unifican
//    entre ALyCs en los 3 buckets (MEP / 7000 / Cable) via SibraBrokers.cashBucket,
//    así el mismo tipo de dólar suma junto. Incluye positivos y negativos. ──
function accountCash(rows) {
  const m = {};
  rows.forEach(r => {
    const b = SibraBrokers.cashBucket(r.ticker);
    // Es efectivo si el ticker está en el mapa de monedas o el grupo es cuenta corriente.
    if (!b && !String(r.asset_group).toLowerCase().includes('cuenta corriente')) return;
    const key = r.broker_code + '|' + r.account;
    if (!m[key]) m[key] = { cliente: r.client_name, alyc: r.broker_code, comitente: r.account, ars: 0, mep: 0, div: 0, cable: 0 };
    if (b && b.bucket === 'USD_MEP') m[key].mep += parseFloat(r.quantity) || 0;
    else if (b && b.bucket === 'USD_DIVISA') m[key].div += parseFloat(r.quantity) || 0;
    else if (b && b.bucket === 'USD_CABLE') m[key].cable += parseFloat(r.quantity) || 0;
    else if (String(r.currency).toUpperCase() === 'USD') m[key].mep += parseFloat(r.quantity) || 0; // USD sin mapa -> MEP por defecto
    else m[key].ars += parseFloat(r.market_value_ars) || 0;
  });
  return Object.values(m).filter(a => a.ars || a.mep || a.div || a.cable).sort((a, b) => Math.abs(b.ars) - Math.abs(a.ars));
}
// Filtro por signo del saldo en pesos (descubierto vs a favor): all/pos/neg.
let ctacteFilter = 'all';
function setCtacteFilter(f) {
  ctacteFilter = f;
  document.querySelectorAll('[data-ccfilter]').forEach(b => b.classList.toggle('active', b.dataset.ccfilter === f));
  renderCuentaCorriente();
}
function filteredCtacte() {
  let accts = accountCash(filteredRows());
  if (ctacteFilter === 'pos') accts = accts.filter(a => a.ars > 0);
  else if (ctacteFilter === 'neg') accts = accts.filter(a => a.ars < 0);
  return accts;
}
function renderCuentaCorriente() {
  const accts = filteredCtacte();
  // Cada celda de saldo se marca en rojo si es negativa (no solo el ARS que
  // define el filtro pos/neg) — sirve para ver de un vistazo cuál columna
  // exacta hay que pedirle a mesa que corrija.
  const cell = (v, fmt) => `<td class="num${v < 0 ? ' neg-cell' : ''}">${v ? fmt(v) : '—'}</td>`;
  $('#ctacteBody').innerHTML = accts.length ? accts.map(a => `<tr class="${a.ars < 0 ? 'neg-row' : ''}">
    <td>${a.cliente}</td><td>${a.alyc}</td><td>${a.comitente}</td>
    ${cell(a.ars, fmtArs0)}
    ${cell(a.mep, fmtUsd0)}${cell(a.div, fmtUsd0)}${cell(a.cable, fmtUsd0)}
  </tr>`).join('') : '<tr><td colspan="7" class="na">Sin saldos de cuenta corriente</td></tr>';
}

// ── Export a Google Sheet (nuevo spreadsheet) del listado filtrado, para
//    mandarle a la mesa de cada ALyC. Usa el token de SibraAuth (scope
//    spreadsheets + drive.file). ──
async function exportSheet(kind) {
  const token = SibraAuth.getToken();
  if (!token) { toast('Conectate con Google primero.'); return; }
  let title, headers, rows;
  if (kind === 'cauciones') {
    const accts = accountCaucionesVigentes(filteredCauciones());
    title = 'SIBRA Cauciones a decidir ' + new Date().toISOString().slice(0, 10);
    headers = ['Cliente', 'ALyC', 'Comitente', 'Caución $', 'Caución U$S', 'Próx. vencimiento'];
    rows = accts.map(a => [a.cliente, a.alyc, a.comitente, a.ars, a.usd, a.venc || '']);
  } else {
    const accts = filteredCtacte();
    title = 'SIBRA Cuenta Corriente ' + new Date().toISOString().slice(0, 10);
    headers = ['Cliente', 'ALyC', 'Comitente', 'Saldo $', 'USD MEP', 'USD 7000', 'USD Cable'];
    rows = accts.map(a => [a.cliente, a.alyc, a.comitente, a.ars, a.mep, a.div, a.cable]);
  }
  if (!rows.length) { toast('No hay filas para exportar.'); return; }
  try {
    toast('Creando Sheet…');
    const create = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ properties: { title } }),
    });
    if (!create.ok) throw new Error('crear ' + create.status);
    const created = await create.json();
    const sheetTitle = created.sheets[0].properties.title;
    const w = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${created.spreadsheetId}/values/${encodeURIComponent(sheetTitle)}!A1:append?valueInputOption=RAW`, {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [headers, ...rows] }),
    });
    if (!w.ok) throw new Error('escribir ' + w.status);
    window.open('https://docs.google.com/spreadsheets/d/' + created.spreadsheetId, '_blank');
    toast('Sheet creado — se abrió en otra pestaña.');
  } catch (e) { toast('Error al exportar: ' + e.message); }
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
