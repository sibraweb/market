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

  // Unificación de efectivo/monedas entre ALyCs: cada broker nombra distinto el
  // efectivo (BCCH: CASH_ARS/CASH_USD; ADCAP: $/USD D/USD C/USD 7000; IEB:
  // DOLARUSA/DOLAR EXT.). Los llevamos a 4 buckets canónicos para que sumen:
  //   ARS        = pesos
  //   USD_MEP    = dólar MEP (local)
  //   USD_DIVISA = dólar divisa "7000" (convertible a MEP)
  //   USD_CABLE  = dólar cable / exterior (hay que comprar afuera)
  // [ticker canónico, etiqueta de tipo, bucket]
  const CASH_MAP = {
    '$':          ['PESOS', 'Pesos', 'ARS'],
    'CASH_ARS':   ['PESOS', 'Pesos', 'ARS'],
    'PESOS':      ['PESOS', 'Pesos', 'ARS'],
    'USD D':      ['USD_MEP', 'Dólar MEP', 'USD_MEP'],
    'CASH_USD':   ['USD_MEP', 'Dólar MEP', 'USD_MEP'],
    'DOLARUSA':   ['USD_MEP', 'Dólar MEP', 'USD_MEP'],
    'USD 7000':   ['USD_DIVISA', 'Dólar 7000', 'USD_DIVISA'],
    'USD C':      ['USD_CABLE', 'Dólar cable', 'USD_CABLE'],
    'DOLAR EXT.': ['USD_CABLE', 'Dólar cable', 'USD_CABLE'],
  };
  function normalizeCash(ticker) {
    return CASH_MAP[String(ticker || '').trim()] || null;
  }

  // ───────────────────────────────────────────────────────────────
  //  Clasificación de instrumentos (TIPO) → precios data912
  //  Fuente: la base PAPELES (columnas GRUPO/SUBGRUPO/SUBTIPO por SIMBOLO).
  //  El diccionario traduce esas etiquetas de negocio al TIPO canónico y a
  //  DÓNDE está el precio en data912:
  //    panelSpot    = /live/<panelSpot>            (precio actual; null = no listado)
  //    histEndpoint = /historical/<histEndpoint>/<ticker> (cierre diario; null = sin serie)
  //    escala       = divisor del precio crudo: bonos/ON/letras cotizan cada 100 VN → 100
  //  data912 sólo publica histórico de stocks/cedears/bonds; ON y LETRAS
  //  apuntan a 'bonds' pero puede no existir la serie (se resuelve ticker a ticker).
  const TIPO_INFO = {
    ACCION_ARG:  { panelSpot: 'arg_stocks',  histEndpoint: 'stocks',  escala: 1   },
    CEDEAR:      { panelSpot: 'arg_cedears', histEndpoint: 'cedears', escala: 1   },
    ETF:         { panelSpot: 'arg_cedears', histEndpoint: 'cedears', escala: 1   },
    BONO:        { panelSpot: 'arg_bonds',   histEndpoint: 'bonds',   escala: 100 },
    ON:          { panelSpot: 'arg_corp',    histEndpoint: 'bonds',   escala: 100 },
    LETRA:       { panelSpot: 'arg_notes',   histEndpoint: 'bonds',   escala: 100 },
    FCI:         { panelSpot: null,          histEndpoint: null,      escala: 1   },
    CASH_ARS:    { panelSpot: null,          histEndpoint: null,      escala: 1   },
    CASH_USD:    { panelSpot: null,          histEndpoint: null,      escala: 1   },
    DESCONOCIDO: { panelSpot: null,          histEndpoint: null,      escala: 1   },
  };
  // SUBGRUPO de PAPELES → TIPO (fuente primaria).
  const SUBGRUPO_TIPO = {
    GENERAL: 'ACCION_ARG', LIDER: 'ACCION_ARG', CEDEAR: 'CEDEAR',
    BONOS: 'BONO', ON: 'ON', LETRAS: 'LETRA', FCI: 'FCI', CASH: 'CASH_ARS',
  };
  // GRUPO de PAPELES → TIPO (fallback grueso cuando el SUBGRUPO no está mapeado).
  const GRUPO_TIPO = { RF: 'BONO', RV: 'ACCION_ARG', CASH: 'CASH_ARS', FCI: 'FCI' };
  // Fallback por patrón de ticker cuando el papel no está en PAPELES: renta fija
  // soberana/subsoberana y letras (mismo criterio que actual/clasificarTicker).
  const RE_RENTA_FIJA = /^(AL|GD|AE|TX|TZX|T2X|DICP|PARP|CUAP|TTD|TZV|BPOC|BPOD|S\d{1,2}[A-Z]|T\d)/;

  // Clasifica un ticker. `papelesEntry` = fila de PAPELES {grupo, subgrupo, subtipo}
  // (o null si el papel no está en la base). Devuelve TIPO + info de precios data912.
  function clasificar(ticker, papelesEntry) {
    const tk = String(ticker || '').trim().toUpperCase();
    // 1) Efectivo (usa el CASH_MAP unificado entre ALyCs).
    const cash = normalizeCash(ticker);
    if (cash) {
      const tipo = cash[2] === 'ARS' ? 'CASH_ARS' : 'CASH_USD';
      return { tipo, ...TIPO_INFO[tipo], fuente: 'CASH' };
    }
    // 2) PAPELES: SUBGRUPO manda, luego GRUPO; SUBTIPO sólo marca ETF (se cotiza como cedear).
    if (papelesEntry) {
      const grupo    = String(papelesEntry.grupo    || '').toUpperCase().trim();
      const subgrupo = String(papelesEntry.subgrupo || '').toUpperCase().trim();
      const subtipo  = String(papelesEntry.subtipo  || '').toUpperCase().trim();
      let tipo = SUBGRUPO_TIPO[subgrupo] || GRUPO_TIPO[grupo] || null;
      if (tipo === 'CEDEAR' && (subtipo === 'ETF' || subtipo === 'ET')) tipo = 'ETF';
      if (tipo) return { tipo, ...TIPO_INFO[tipo], fuente: 'PAPELES' };
    }
    // 3) Fallback por patrón de ticker (papel no encontrado en PAPELES).
    if (RE_RENTA_FIJA.test(tk)) return { tipo: 'BONO', ...TIPO_INFO.BONO, fuente: 'REGEX' };
    return { tipo: 'DESCONOCIDO', ...TIPO_INFO.DESCONOCIDO, fuente: 'NINGUNA' };
  }

  // Precio unitario ajustado por escala. rawPrice = campo `c` (cierre) de data912;
  // los bonos/ON/letras vienen cada 100 VN, así que se divide por la escala.
  function precioUnitario(rawPrice, escala) {
    const p = num(rawPrice);
    return escala && escala !== 1 ? p / escala : p;
  }

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
    return rowsFromValues(data.values).map(r => {
      const cash = normalizeCash(r.ticker);
      return {
        alyc: r.broker_code,
        comitente: r.account,
        cliente: r.client_name,
        // Efectivo: ticker/tipo canónicos para que sume entre ALyCs. Título normal: como viene.
        ticker: cash ? cash[0] : r.ticker,
        tipo: cash ? cash[1] : r.asset_group,
        moneda: r.currency,
        // Bucket de moneda unificado (ARS / USD_MEP / USD_DIVISA / USD_CABLE).
        bucket: cash ? cash[2] : (String(r.currency).toUpperCase() === 'USD' ? 'USD' : 'ARS'),
        esEfectivo: !!cash,
        cantidad: num(r.quantity),
        ppc: num(r.average_cost),
        precio: num(r.last_price),
        valor: num(r.market_value_ars),
        rentabilidadPct: r.unrealized_pnl_pct === '' ? null : num(r.unrealized_pnl_pct),
      };
    });
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

  // Bucket de moneda de un ticker de efectivo (o null si no es efectivo).
  // { ticker, label, bucket } — bucket ∈ ARS/USD_MEP/USD_DIVISA/USD_CABLE.
  function cashBucket(ticker) {
    const m = normalizeCash(ticker);
    return m ? { ticker: m[0], label: m[1], bucket: m[2] } : null;
  }

  return { TENENCIAS_SHEET_ID, CAUCIONES_SHEET_ID, sheetValues, rowsFromValues, loadTenencias, loadCauciones, cashBucket,
           clasificar, precioUnitario, TIPO_INFO };
})();
