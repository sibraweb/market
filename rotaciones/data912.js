// ═══════════════════════════════════════════════════════════════
//  data912.js — Módulo 3 Rotaciones · Sibratech
//  Precios live desde data912.com
//  Requiere: config.js cargado antes
// ═══════════════════════════════════════════════════════════════

const Precios = (() => {

  // Cache en memoria para evitar llamadas repetidas en la misma sesión
  let _cache = {};
  let _tipoCambio = null;
  let _ultimaActualizacion = null;

  // ── Detección de tipo de instrumento ────────────────────────

  /**
   * Determina si un ticker es de renta fija (precio viene /100 en data912)
   */
  function esRentaFija(ticker) {
    const t = ticker.toUpperCase();
    return CONFIG.RENTA_FIJA_PREFIJOS.some(prefijo => t.startsWith(prefijo));
  }

  // ── Carga de precios ─────────────────────────────────────────

  /**
   * Carga todos los precios disponibles desde data912.
   * Guarda en cache. Retorna el mapa { TICKER: precioARS }
   */
  async function cargarTodos() {
    try {
      const url = `${CONFIG.DATA912.BASE_URL}${CONFIG.DATA912.ENDPOINT_LIVE}`;
      const res = await fetch(url, {
        headers: { "Accept": "application/json" },
      });

      if (!res.ok) throw new Error(`data912 HTTP ${res.status}`);
      const data = await res.json();

      // data912 devuelve array de objetos con al menos { ticker, price } o similar
      // Normalizar al formato { TICKER: precioARS }
      _cache = {};

      // Manejar distintos formatos posibles de la API
      const items = Array.isArray(data) ? data : (data.data || data.prices || []);

      for (const item of items) {
        const ticker = String(item.ticker || item.symbol || item.c || "").trim().toUpperCase();
        const precio = parseFloat(item.price || item.last || item.c || item.close || 0);
        if (ticker && precio > 0) {
          // Aplicar regla: renta fija → precio / 100
          _cache[ticker] = esRentaFija(ticker) ? precio / 100 : precio;
        }
      }

      // Calcular tipo de cambio ARS/USD
      const al30  = _cache[CONFIG.DATA912.TICKER_AL30_ARS];
      const al30d = _cache[CONFIG.DATA912.TICKER_AL30_USD];

      if (al30 && al30d && al30d > 0) {
        // AL30D ya está dividido /100, AL30 también → ratio directo
        // Pero AL30D cotiza en USD, entonces:
        // tipoCambio = precio_ARS(AL30) / precio_USD(AL30D)
        // Como ambos ya pasaron por la regla /100, la ratio es correcta
        _tipoCambio = al30 / al30d;
      } else {
        // Fallback: intentar con otros pares conocidos
        console.warn("No se pudo calcular tipo de cambio desde AL30/AL30D");
        _tipoCambio = null;
      }

      _ultimaActualizacion = new Date();
      console.log(`[data912] ${Object.keys(_cache).length} precios cargados. TC: ${_tipoCambio?.toFixed(2)}`);

      return _cache;

    } catch (err) {
      console.error("[data912] Error cargando precios:", err);
      throw err;
    }
  }

  /**
   * Obtiene el precio ARS de un ticker específico.
   * Si el cache está vacío, carga primero.
   */
  async function getPrecio(ticker) {
    if (!Object.keys(_cache).length) await cargarTodos();
    const t = ticker.toUpperCase();
    return _cache[t] || null;
  }

  /**
   * Devuelve el tipo de cambio ARS/USD calculado.
   * Si el cache está vacío, carga primero.
   */
  async function getTipoCambio() {
    if (_tipoCambio === null) await cargarTodos();
    return _tipoCambio;
  }

  /**
   * Enriquece un array de posiciones con precios live.
   * Modifica posicion.pu con el precio live si está disponible.
   * Si no hay precio live, deja el precio original del archivo.
   */
  async function enriquecerPosiciones(posiciones) {
    if (!Object.keys(_cache).length) await cargarTodos();
    return posiciones.map(pos => {
      const precioLive = _cache[pos.ticker.toUpperCase()];
      return {
        ...pos,
        pu:         precioLive ?? pos.pu,
        puOriginal: pos.pu,
        precioLive: precioLive ?? null,
        sinPrecio:  !precioLive,
      };
    });
  }

  /**
   * Devuelve el mapa completo del cache actual.
   */
  function getCache() {
    return { ..._cache };
  }

  /**
   * Limpia el cache (para forzar recarga).
   */
  function limpiarCache() {
    _cache = {};
    _tipoCambio = null;
    _ultimaActualizacion = null;
  }

  /**
   * Info de última actualización.
   */
  function ultimaActualizacion() {
    return _ultimaActualizacion;
  }

  // ── API pública ──────────────────────────────────────────────
  return {
    cargarTodos,
    getPrecio,
    getTipoCambio,
    enriquecerPosiciones,
    esRentaFija,
    getCache,
    limpiarCache,
    ultimaActualizacion,
  };

})();
