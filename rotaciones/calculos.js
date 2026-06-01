// ═══════════════════════════════════════════════════════════════
//  calculos.js — Módulo 3 Rotaciones · Sibratech
//  Lógica central: cartera objetivo, ventas, compras, saldo
//  Requiere: config.js cargado antes
// ═══════════════════════════════════════════════════════════════

const Calculos = (() => {

  const floor = Math.floor;

  // ── 1. Cartera objetivo ──────────────────────────────────────

  /**
   * Construye el mapa de porcentajes objetivo para un cliente.
   * Combina los pesos de subcartera (LP/MP/CP/CASH) del cliente
   * con las ponderaciones del perfil (AGRESIVO/MODERADO/CONSERVADOR).
   *
   * @param {object} cliente   — { LP, MP, CP, CASH, palanca, perfil }
   * @param {object} carteras  — { AGRESIVO: [...], MODERADO: [...], CONSERVADOR: [...] }
   * @returns {object}         — { TICKER: pct_final, ... } donde sum ≈ 1
   */
  function construirObjetivo(cliente, carteras) {
    const perfil = cliente.perfil?.toUpperCase() || "MODERADO";
    const filas  = carteras[perfil] || [];

    // Pesos de plazo del cliente
    const pesosPlazo = {
      LARGO: parseFloat(cliente.LP)   || 0,
      MEDIO: parseFloat(cliente.MP)   || 0,
      CORTO: parseFloat(cliente.CP)   || 0,
      CASH:  parseFloat(cliente.CASH) || 0,
    };

    const mapa = {};

    for (const fila of filas) {
      const plazo     = fila.plazo.toUpperCase();
      const ticker    = fila.ticker.toUpperCase();
      const pond      = fila.pond_plazo;
      const pesoPlazo = pesosPlazo[plazo] || 0;

      if (pesoPlazo === 0 || pond === 0) continue;

      const pctFinal = pesoPlazo * pond;

      if (!mapa[ticker]) mapa[ticker] = 0;
      mapa[ticker] += pctFinal;
    }

    return mapa; // { TICKER: 0.08, TICKER2: 0.05, ... }
  }

  // ── 2. Totales de cartera ────────────────────────────────────

  /**
   * Calcula el valor total de la cartera actual.
   * totalCartera = sum(cantidad × PU) + cashPesos + caucionPesos
   */
  function calcularTotalCartera(tenencia) {
    const valPos = tenencia.posiciones.reduce((s, p) => s + p.cantidad * p.pu, 0);
    return valPos + tenencia.cashPesos + tenencia.caucionPesos;
  }

  /**
   * Calcula la base ajustada con aportes y palanca.
   * base = (totalCartera + aporteARS + aporteUSD×TC) × (1 + palanca)
   */
  function calcularBase(totalCartera, aporteARS, aporteUSD, tipoCambio, palanca) {
    const totalAjustado = totalCartera + aporteARS + (aporteUSD * (tipoCambio || 0));
    return {
      totalCarteraAjustada: totalAjustado,
      base: totalAjustado * (1 + (palanca || 0)),
    };
  }

  // ── 3. Ventas sugeridas ──────────────────────────────────────

  /**
   * Calcula las ventas sugeridas comparando posición actual vs objetivo.
   *
   * @param {Array}  posiciones   — [{ ticker, cantidad, pu }]
   * @param {object} objetivo     — { TICKER: pct_final }
   * @param {object} precios      — { TICKER: precioARS }  (cache data912)
   * @param {number} base         — monto total con apalancamiento
   * @param {object} pctEjecucion — { TICKER: 1.0 } default 1.0
   * @param {number} comVenta     — default CONFIG.COMISIONES.COM_VENTA
   * @param {number} gasVenta     — default CONFIG.COMISIONES.GAS_VENTA
   * @returns {Array} — filas de ventas con todos los campos calculados
   */
  function calcularVentas(posiciones, objetivo, precios, base, pctEjecucion = {}, comVenta, gasVenta) {
    const cv = comVenta ?? CONFIG.COMISIONES.COM_VENTA;
    const gv = gasVenta ?? CONFIG.COMISIONES.GAS_VENTA;

    return posiciones.map(pos => {
      const ticker   = pos.ticker.toUpperCase();
      const pu       = precios[ticker] ?? pos.pu;
      const pctObj   = objetivo[ticker] ?? 0;

      // Cantidad que debería tener en la cartera objetivo
      const cantObj  = pctObj > 0 && pu > 0 ? floor((base * pctObj) / pu) : 0;
      const delta    = cantObj - pos.cantidad;

      // Solo interesa si hay que vender (delta negativo)
      const esVenta  = delta < 0;
      const cantBase = esVenta ? Math.abs(delta) : 0;
      const pctEj    = pctEjecucion[ticker] !== undefined ? pctEjecucion[ticker] : 1.0;
      const cantOp   = esVenta ? floor(cantBase * pctEj) : 0;
      const monto    = cantOp * pu;
      const comision = monto * (cv + gv);
      const neto     = monto - comision;

      return {
        ticker,
        cantActual:   pos.cantidad,
        cantObjetivo: cantObj,
        delta,
        esVenta,
        cantBase,     // delta sin aplicar pct ejecución
        pctEj,
        cantOperar:   cantOp,
        pu,
        monto,
        comision,
        neto,         // lo que ingresa neto al disponible
      };
    });
  }

  // ── 4. Disponible neto ───────────────────────────────────────

  /**
   * Calcula el efectivo disponible para las compras.
   */
  function calcularDisponible(ventas, cashPesos, aporteARS, aporteUSD, tipoCambio) {
    const netoPorVentas = ventas
      .filter(v => v.esVenta)
      .reduce((s, v) => s + v.neto, 0);

    return netoPorVentas
      + cashPesos
      + aporteARS
      + (aporteUSD * (tipoCambio || 0));
  }

  // ── 5. Compras sugeridas ─────────────────────────────────────

  /**
   * Calcula las compras sugeridas.
   * Considera la cartera post-venta (cantActual - cantVendida).
   *
   * @param {Array}  posicionesActuales — posición actual [{ ticker, cantidad }]
   * @param {Array}  ventas             — resultado de calcularVentas()
   * @param {object} objetivo           — { TICKER: pct_final }
   * @param {object} precios            — { TICKER: precioARS }
   * @param {number} base               — monto total con apalancamiento
   * @param {object} pctEjecucion       — { TICKER: 1.0 }
   * @param {number} comCompra
   * @param {number} gasCompra
   * @returns {Array} — filas de compras
   */
  function calcularCompras(posicionesActuales, ventas, objetivo, precios, base, pctEjecucion = {}, comCompra, gasCompra) {
    const cc = comCompra ?? CONFIG.COMISIONES.COM_COMPRA;
    const gc = gasCompra ?? CONFIG.COMISIONES.GAS_COMPRA;

    // Mapa de posición actual
    const cantActualMap = {};
    posicionesActuales.forEach(p => {
      cantActualMap[p.ticker.toUpperCase()] = p.cantidad;
    });

    // Mapa de cantidades vendidas
    const cantVendidaMap = {};
    ventas.filter(v => v.esVenta).forEach(v => {
      cantVendidaMap[v.ticker] = v.cantOperar;
    });

    // Por cada ticker en el objetivo
    return Object.entries(objetivo).map(([ticker, pctObj]) => {
      const pu       = precios[ticker] ?? 0;
      if (pu === 0) return null; // sin precio, omitir

      // Cartera post-ventas
      const cantActual  = cantActualMap[ticker] ?? 0;
      const cantVendida = cantVendidaMap[ticker] ?? 0;
      const cartPost    = cantActual - cantVendida;

      // Cantidad objetivo
      const cantObj  = floor((base * pctObj) / pu);
      const delta    = cantObj - cartPost;

      // Solo compra si delta positivo
      const esCompra = delta > 0;
      const cantBase = esCompra ? delta : 0;
      const pctEj    = pctEjecucion[ticker] !== undefined ? pctEjecucion[ticker] : 1.0;
      const cantOp   = esCompra ? floor(cantBase * pctEj) : 0;
      const monto    = cantOp * pu;
      const comision = monto * (cc + gc);
      const total    = monto + comision; // lo que se necesita del disponible

      return {
        ticker,
        cantActual,
        cantVendida,
        cartPost,
        cantObjetivo: cantObj,
        delta,
        esCompra,
        cantBase,
        pctEj,
        cantOperar: cantOp,
        pu,
        monto,
        comision,
        total,        // monto + comision = lo que consume del disponible
        pctObj,
      };
    }).filter(Boolean);
  }

  // ── 6. Saldo final ───────────────────────────────────────────

  /**
   * Calcula el saldo = disponibleNeto - sum(compras.total)
   */
  function calcularSaldo(disponibleNeto, compras) {
    const necesario = compras
      .filter(c => c.esCompra)
      .reduce((s, c) => s + c.total, 0);
    return {
      necesario,
      saldo: disponibleNeto - necesario,
      ok:    disponibleNeto >= necesario,
    };
  }

  // ── 7. Cartera resultante ────────────────────────────────────

  /**
   * Calcula las posiciones finales para guardar en 05_RESULTANTES.
   * posicionFinal[ticker] = cantActual - cantVendida + cantComprada
   */
  function calcularResultante(posicionesActuales, ventas, compras) {
    const mapa = {};

    // Arrancar con posición actual
    posicionesActuales.forEach(p => {
      mapa[p.ticker.toUpperCase()] = p.cantidad;
    });

    // Restar vendido
    ventas.filter(v => v.esVenta).forEach(v => {
      mapa[v.ticker] = (mapa[v.ticker] || 0) - v.cantOperar;
    });

    // Sumar comprado
    compras.filter(c => c.esCompra).forEach(c => {
      mapa[c.ticker] = (mapa[c.ticker] || 0) + c.cantOperar;
    });

    return Object.entries(mapa)
      .map(([ticker, cantidad]) => ({ ticker, cantidad }))
      .filter(p => p.cantidad > 0);
  }

  // ── 8. Órdenes para guardar ──────────────────────────────────

  /**
   * Construye el array de órdenes para el archivo 04_ROTACIONES.
   */
  function construirOrdenes(cliente, alyc, ventas, compras, usuarioLogueado) {
    const hoy = new Date().toISOString().slice(0, 10);
    const ordenes = [];

    // Ventas (cantidad negativa)
    ventas.filter(v => v.esVenta && v.cantOperar > 0).forEach(v => {
      ordenes.push({
        fecha:       hoy,
        solicita:    usuarioLogueado || "",
        operador:    usuarioLogueado || "",
        alyc,
        comitente:   cliente.cc,
        cuentaRofex: "",
        operacion:   "VENTA",
        especie:     v.ticker,
        plazo:       CONFIG.PLAZO_ORDEN,
        cantidad:    -v.cantOperar,   // negativo en ventas
        precio:      v.pu,
        moneda:      CONFIG.MONEDA_ORDEN,
        montoBruto:  v.monto,
        observaciones: "",
      });
    });

    // Compras (cantidad positiva)
    compras.filter(c => c.esCompra && c.cantOperar > 0).forEach(c => {
      ordenes.push({
        fecha:       hoy,
        solicita:    usuarioLogueado || "",
        operador:    usuarioLogueado || "",
        alyc,
        comitente:   cliente.cc,
        cuentaRofex: "",
        operacion:   "COMPRA",
        especie:     c.ticker,
        plazo:       CONFIG.PLAZO_ORDEN,
        cantidad:    c.cantOperar,
        precio:      c.pu,
        moneda:      CONFIG.MONEDA_ORDEN,
        montoBruto:  c.monto,
        observaciones: "",
      });
    });

    return ordenes;
  }

  // ── API pública ──────────────────────────────────────────────
  return {
    construirObjetivo,
    calcularTotalCartera,
    calcularBase,
    calcularVentas,
    calcularDisponible,
    calcularCompras,
    calcularSaldo,
    calcularResultante,
    construirOrdenes,
  };

})();
