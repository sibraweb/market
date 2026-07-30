// ═══════════════════════════════════════════════════════════════
//  sibra-discrepancia.js — control de valuación al traer la cartera
//  (Juan, 2026-07-30: "si la nuestra varía más de un 5% tenemos que poner
//  una ventana de alerta para ver qué pasó, si es una tenencia mal o un
//  precio mal").
//
//  Compara, ticker por ticker, la valuación que informa el BROKER
//  (market_value_ars, viene de BCCH/IEB/ADCAP) contra la NUESTRA
//  (cantidad × precio de data912). Si el total difiere más del umbral,
//  abre un modal con el detalle ordenado por impacto en pesos — que es
//  justo lo que hace falta para decidir si el problema es un precio mal
//  escalado (el ÷100 de bonos/ON/letras, que ya rompió la valuación una
//  vez) o una tenencia mal cargada.
//
//  El efectivo se excluye: no se revalúa con data912, así que compararlo
//  no aporta y solo diluiría la métrica.
// ═══════════════════════════════════════════════════════════════
const SibraDiscrepancia = (() => {
  const UMBRAL_DEFAULT = 0.05; // 5%
  const fmtArs = n => new Intl.NumberFormat('es-AR', { style:'currency', currency:'ARS', maximumFractionDigits:0 }).format(n || 0);
  const fmtPct = n => (n * 100).toFixed(2) + '%';
  const fmtNum = n => new Intl.NumberFormat('es-AR', { maximumFractionDigits:2 }).format(n || 0);

  // filas: [{ticker, cantidad, valorBroker, esEfectivo?}]
  // getPrecio(ticker) -> precio unitario NUESTRO ya escalado (÷100 en renta
  //   fija), o null/0 si data912 no lo tiene (esas filas se saltean: sin
  //   precio propio no hay con qué comparar, no es una discrepancia).
  function analizar(filas, getPrecio, umbral = UMBRAL_DEFAULT) {
    let totalBroker = 0, totalNuestro = 0;
    const detalle = [];
    (filas || []).forEach(f => {
      if (f.esEfectivo) return;
      const vB = Number(f.valorBroker) || 0;
      const cant = Number(f.cantidad) || 0;
      const pu = Number(getPrecio(f.ticker)) || 0;
      if (pu <= 0 || vB <= 0) return;
      const vN = cant * pu;
      totalBroker += vB;
      totalNuestro += vN;
      detalle.push({
        ticker: f.ticker, cantidad: cant, pu,
        valorNuestro: vN, valorBroker: vB,
        difPesos: vN - vB,
        difPct: Math.abs(vN - vB) / vB,
      });
    });
    const difTotal = totalBroker > 0 ? Math.abs(totalNuestro - totalBroker) / totalBroker : 0;
    // Ordenado por IMPACTO EN PESOS, no por % — un 300% de diferencia en una
    // posición de $500 es ruido al lado de un 8% en una de $20M.
    detalle.sort((a, b) => Math.abs(b.difPesos) - Math.abs(a.difPesos));
    return { difTotal, totalBroker, totalNuestro, detalle, umbral, superaUmbral: difTotal > umbral };
  }

  function cerrar() { document.getElementById('sibraDiscrepanciaModal')?.remove(); }

  function mostrar(res, contexto = '') {
    cerrar();
    const top = res.detalle.slice(0, 12);
    const filas = top.map(d => `
      <tr>
        <td style="padding:6px 10px"><b>${d.ticker}</b></td>
        <td style="padding:6px 10px;text-align:right">${fmtNum(d.cantidad)}</td>
        <td style="padding:6px 10px;text-align:right">${fmtArs(d.pu)}</td>
        <td style="padding:6px 10px;text-align:right">${fmtArs(d.valorNuestro)}</td>
        <td style="padding:6px 10px;text-align:right">${fmtArs(d.valorBroker)}</td>
        <td style="padding:6px 10px;text-align:right;color:${d.difPesos < 0 ? '#ff6b6b' : '#22c55e'}">
          ${d.difPesos > 0 ? '+' : ''}${fmtArs(d.difPesos)}<br>
          <span style="font-size:10px;color:#a6a6a6">${fmtPct(d.difPct)}</span>
        </td>
      </tr>`).join('');

    const wrap = document.createElement('div');
    wrap.id = 'sibraDiscrepanciaModal';
    wrap.innerHTML = `
<div style="position:fixed;inset:0;background:rgba(0,0,0,.78);z-index:10000;display:flex;align-items:center;justify-content:center;font-family:Montserrat,system-ui,sans-serif;padding:20px">
  <div style="background:#141414;border:1px solid #E10600;border-radius:10px;max-width:900px;width:100%;max-height:88vh;overflow:auto">
    <div style="padding:18px 22px;border-bottom:1px solid rgba(255,255,255,.12)">
      <div style="font-size:15px;font-weight:800;color:#ff3330;margin-bottom:6px">
        ⚠ La valuación no coincide con la del broker${contexto ? ' — ' + contexto : ''}
      </div>
      <div style="font-size:12px;color:#c2c2c2;line-height:1.6">
        Nuestro cálculo (cantidad × precio data912) difiere
        <b style="color:#fff">${fmtPct(res.difTotal)}</b> del valor que informa el broker
        (máximo tolerado ${fmtPct(res.umbral)}).<br>
        Nosotros: <b style="color:#fff">${fmtArs(res.totalNuestro)}</b> ·
        Broker: <b style="color:#fff">${fmtArs(res.totalBroker)}</b> ·
        Diferencia: <b style="color:#ff6b6b">${fmtArs(res.totalNuestro - res.totalBroker)}</b>
      </div>
    </div>
    <div style="padding:14px 22px;font-size:11px;color:#a6a6a6;line-height:1.7;border-bottom:1px solid rgba(255,255,255,.08)">
      Las causas habituales, en orden: <b style="color:#c2c2c2">precio mal escalado</b>
      (bonos/ON/letras cotizan cada 100 VN y hay que dividir por 100 — mirá si el
      "nuestro" da ~100× el del broker), o <b style="color:#c2c2c2">tenencia mal cargada</b>
      (cantidad que no coincide con lo que tiene el cliente). Revisá los de arriba,
      que son los que más pesan en plata.
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:12px;color:#f0f0f0">
      <thead>
        <tr style="background:#1a1a1a;color:#a6a6a6;font-size:10px;text-transform:uppercase;letter-spacing:.06em">
          <th style="padding:8px 10px;text-align:left">Ticker</th>
          <th style="padding:8px 10px;text-align:right">Cantidad</th>
          <th style="padding:8px 10px;text-align:right">PU nuestro</th>
          <th style="padding:8px 10px;text-align:right">Valor nuestro</th>
          <th style="padding:8px 10px;text-align:right">Valor broker</th>
          <th style="padding:8px 10px;text-align:right">Diferencia</th>
        </tr>
      </thead>
      <tbody>${filas}</tbody>
    </table>
    ${res.detalle.length > top.length
      ? `<div style="padding:10px 22px;font-size:11px;color:#666">… y ${res.detalle.length - top.length} posiciones más (se muestran las 12 de mayor impacto).</div>`
      : ''}
    <div style="padding:16px 22px;display:flex;justify-content:flex-end;gap:10px;border-top:1px solid rgba(255,255,255,.12)">
      <button id="sibraDiscCerrar" style="padding:9px 20px;background:#E10600;color:#fff;font-weight:800;border:0;border-radius:6px;cursor:pointer;font-size:12px">
        Entendido
      </button>
    </div>
  </div>
</div>`;
    document.body.appendChild(wrap);
    wrap.querySelector('#sibraDiscCerrar').onclick = cerrar;
  }

  // Analiza y, si supera el umbral, abre el modal. Devuelve el análisis
  // para que el módulo decida además si bloquea algo.
  function verificar(filas, getPrecio, contexto = '', umbral = UMBRAL_DEFAULT) {
    const res = analizar(filas, getPrecio, umbral);
    if (res.superaUmbral) mostrar(res, contexto);
    return res;
  }

  return { UMBRAL_DEFAULT, analizar, mostrar, verificar, cerrar };
})();
