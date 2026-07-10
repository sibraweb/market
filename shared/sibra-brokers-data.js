// ═══════════════════════════════════════════════════════════════
//  sibra-brokers-data.js — fuente única de datos de cartera para los
//  módulos de Market Suite. Lee la base de sibra-brokers
//  (SIBRA_BROKERS_TENENCIAS / SIBRA_BROKERS_CAUCIONES) vía Sheets API,
//  reusando la sesión de Google de SibraAuth y la caché de SibraCache.
//  Reemplaza la carga por Excel/Drive que cada módulo hacía por su cuenta.
// ═══════════════════════════════════════════════════════════════
const SibraBrokers = (() => {
  // Mismos IDs que ya usa homebroker/app.js (generados por scripts/setup_sheets.py).
  const TENENCIAS_SHEET_ID = '1tZVHEgp6nYax-nIdY1WSOYesucrMY_H2rtkXdSwhPAs';
  const CAUCIONES_SHEET_ID = '1mSEmdabwij0ySAUtXTN_eXvbf17dmK-Gs6ze_5N3bcs';
  const TTL = 60; // segundos

  function num(v) { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; }

  async function sheetValues(sheetId, range, { fresh = false } = {}) {
    const token = SibraAuth.getToken();
    if (!token) throw new Error('No hay sesión de Google. Conectate primero.');
    const cacheKey = `brokers_${sheetId}_${range}`;
    if (!fresh) {
      const cached = SibraCache.get(cacheKey, TTL);
      if (cached) return cached;
    } else {
      SibraCache.invalidate(cacheKey);
    }
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}`;
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) throw new Error(`Sheets API ${r.status}: ${await r.text()}`);
    const data = await r.json();
    SibraCache.set(cacheKey, data);
    return data;
  }

  function rowsFromValues(values) {
    if (!values || !values.length) return [];
    const headers = values[0];
    return values.slice(1).map(row => Object.fromEntries(headers.map((h, i) => [h, row[i] ?? ''])));
  }

  // Posiciones normalizadas desde TENENCIAS.CURRENT (BCCH/IEB/ADCAP, efectivo incluido).
  async function loadTenencias(opts = {}) {
    const data = await sheetValues(TENENCIAS_SHEET_ID, 'CURRENT', opts);
    return rowsFromValues(data.values).map(r => ({
      alyc: r.broker_code,
      comitente: r.account,
      cliente: r.client_name,
      ticker: r.ticker,
      tipo: r.asset_group,
      moneda: r.currency,
      cantidad: num(r.quantity),
      ppc: num(r.average_cost),
      precio: num(r.last_price),
      valor: num(r.market_value_ars),
      rentabilidadPct: r.unrealized_pnl_pct === '' ? null : num(r.unrealized_pnl_pct),
    }));
  }

  // Cauciones crudas + helper de caución tomadora vigente por cuenta.
  async function loadCauciones(opts = {}) {
    const data = await sheetValues(CAUCIONES_SHEET_ID, 'CURRENT', opts);
    const rows = rowsFromValues(data.values);
    // { 'ALYC|comitente': { ars, usd } } — sólo VIGENTE + TOMADORA (lo que suma a la bruta).
    function caucionByAccount() {
      const m = {};
      for (const c of rows) {
        if (c.status !== 'VIGENTE' || c.side !== 'TOMADORA') continue;
        const key = c.broker_code + '|' + c.account;
        const cap = num(c.capital);
        if (!m[key]) m[key] = { ars: 0, usd: 0 };
        if (String(c.currency).toUpperCase() === 'USD') m[key].usd += cap;
        else m[key].ars += cap;
      }
      return m;
    }
    return { rows, caucionByAccount };
  }

  return { TENENCIAS_SHEET_ID, CAUCIONES_SHEET_ID, sheetValues, rowsFromValues, loadTenencias, loadCauciones };
})();
