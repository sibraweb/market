// ═══════════════════════════════════════════════════════════════
//  config.js — Módulo 3 Rotaciones · Sibratech
//  Constantes globales, IDs de Drive, parámetros de comisiones
// ═══════════════════════════════════════════════════════════════

const CONFIG = {

  // ── Google Drive: IDs de carpetas y sheets ──────────────────
  DRIVE: {
    // Sheet de clientes (tbl_Clientes)
    SHEET_CLIENTES_ID: "1GAPrAThSrCnjqzvJL7f_nqsVSa0jmItV",

    // Sheet de carteras modelo (AGRESIVO / MODERADO / CONSERVADOR)
    SHEET_CARTERAS_ID: "1-wHYPpF2QmeWklu6y5cSJc4t_EvbonVl",

    // Carpeta raíz de tenencias por ALYC
    // Subcarpetas: ADCAP, IEB, BCCCH, BALANZ, IBRK, BINANCE
    CARPETA_ALYCS_ID: "1cstP-Vhpnml3XKAksEODG_-v_OTkvASB",

    // Carpeta destino de rotaciones generadas (04)
    CARPETA_ROTACIONES_ID: "1ShrZydkIEtROBZ--lObPLdVhidtBebXT",

    // Carpeta destino de carteras resultantes (05)
    CARPETA_RESULTANTES_ID: "1px9T_7kJXX2qnTiLJHIMlThlYaISAN9h",

    // IDs de subcarpetas por ALYC (para buscar tenencias)
    ALYCS: {
      ADCAP:    "1B8-FaVvgZ-uXYXb073FCNq8SrTmw4oD2",
      IEB:      "16ed3PZqYeMOgM8jhU_Efgx47RyizTlJQ",
      BCCCH:    "1hKcPBrkb5B889roVRHh3Yx3jXcKPYr9R",
      BALANZ:   "1qQV6L6xFMyIyNkXPHOXbial_E1hf0gvW",
      IBRK:     "1vmFbQXIMZQOADzSkhfSvjFqTzjjs_9KM",
      BINANCE:  "1fed0uYqFfrUxtcYG1LjDfQ0ZNAE8xCbW",
    },
  },

  // ── API de precios live ──────────────────────────────────────
  DATA912: {
    BASE_URL: "https://data912.com",
    // Endpoint de precios en ARS (renta variable + CEDEARs)
    ENDPOINT_LIVE: "/api/live_arg_corp",
    // Tickers de dólar para calcular tipo de cambio ARS/USD
    TICKER_AL30_ARS: "AL30",
    TICKER_AL30_USD: "AL30D",
  },

  // ── Comisiones default (editables en UI) ────────────────────
  COMISIONES: {
    COM_VENTA:  0.0075,   // 0.75%
    GAS_VENTA:  0.0008,   // 0.08%
    COM_COMPRA: 0.0075,   // 0.75%
    GAS_COMPRA: 0.0008,   // 0.08%
  },

  // ── Tickers de renta fija (precio viene /100 desde data912) ─
  // Lista de prefijos/sufijos que identifican bonos
  RENTA_FIJA_PREFIJOS: [
    "AL", "GD", "AE", "TX", "TZ", "BPO", "DICP", "PARP", "CUAP",
    "S29", "S31", "X29", "X30", "X31", "TZX", "TZXD", "TZXM",
    "BPOC", "GD38", "GD41", "AE38", "AL30", "AL35", "AL41",
    "GD30", "GD35", "GD46", "YMCIO", "BA37D", "MRCA0",
  ],

  // ── Columnas del archivo de tenencias (xlsx ALYCs) ──────────
  COL_TENENCIA: {
    ID:                    0,
    COMITENTE:             1,
    NOMBRE:                2,
    PRODUCTOR:             3,
    CODIGO_ESPECIE:        4,
    TICKER:                5,
    ESPECIE:               6,
    PARTICIPACION:         7,
    CANTIDAD:              8,
    PRECIO:                9,
    IMPORTE:              10,
    COSTO:                11,
    VARIACION:            12,
    RESULTADO:            13,
    TIPO_CAMBIO:          14,
    TIPO_ESPECIE:         15,
    NUMERO_PRODUCTOR:     16,
  },

  // ── Columnas del Sheet de clientes ──────────────────────────
  COL_CLIENTES: {
    CC:       0,
    CLIENTE:  1,
    CUIT:     2,
    ALYC:     3,
    MONTO:    4,
    PERFIL:   5,
    LP:       6,
    MP:       7,
    CP:       8,
    CASH:     9,
    PALANCA:  10,
    CARTERA:  11,
  },

  // ── Columnas del Sheet de carteras modelo ───────────────────
  // (pestañas AGRESIVO / MODERADO / CONSERVADOR)
  // Fila de headers = índice 4 (fila 5 en el xlsx)
  COL_CARTERA_MODELO: {
    PLAZO:               0,   // LARGO / MEDIO / CORTO / CASH
    POND_CARTERA:        1,   // % del plazo dentro de la cartera total (no se usa directo)
    TICKER:              2,
    POND_PLAZO:          3,   // % del ticker dentro de su subcartera
  },
  CARTERA_MODELO_HEADER_ROW: 4,   // índice base 0

  // ── Columnas del Sheet de órdenes (04_ROTACIONES) ───────────
  COL_ORDENES: [
    "ID", "Fecha", "Solicita", "Operador", "Alyc", "Comitente",
    "Cuenta Rofex", "Operación", "Especie", "Plazo",
    "Cantidad", "Precio", "Moneda", "Monto Bruto", "Observaciones",
  ],

  // ── Columnas del Sheet de resultantes (05_RESULTANTES) ──────
  COL_RESULTANTES: [
    "FECHA", "ALYC", "CC", "TITULAR", "TICKER", "CANTIDAD",
  ],

  // ── Parámetros generales ─────────────────────────────────────
  PLAZO_ORDEN: 24,          // Plazo fijo para todas las órdenes
  MONEDA_ORDEN: "ARS",
  APP_VERSION: "1.0.0",
  APP_NOMBRE: "Módulo 3 — Rotaciones",
};

// Exportar para uso en otros módulos (compatibilidad ESM y script tag)
if (typeof module !== "undefined") module.exports = CONFIG;
