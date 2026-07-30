// ═══════════════════════════════════════════════════════════════
//  sibra-autorefresh.js — refresco automático de precios para los
//  módulos de Market Suite (Juan, 2026-07-30: "me gustaría que en todo
//  market me refresques cada 20 segundos por lo menos").
//
//  Dos cuidados que hacen que esto no moleste al operador:
//   · NO corre si la pestaña está en segundo plano (document.hidden) —
//     no tiene sentido gastar requests a data912 contra una pantalla que
//     nadie está mirando.
//   · NO corre mientras hay un input/select con foco. Los módulos de
//     rotación re-renderizan toda la pantalla al actualizar, así que un
//     refresco a mitad de una edición le roba el foco al operador y le
//     borra lo que estaba tipeando (una cantidad, un %). El fetch se
//     saltea entero ese ciclo y vuelve a intentar en el siguiente.
// ═══════════════════════════════════════════════════════════════
const SibraAutoRefresh = (() => {
  const SEGUNDOS_DEFAULT = 20;
  const GRACIA_TIPEO_MS = 10000; // cuánto se respeta una edición desde la última tecla
  let timer = null;
  let ultimoTipeo = 0;

  document.addEventListener('input', () => { ultimoTipeo = Date.now(); }, true);

  // "Está editando" = hay un campo con foco Y tocó una tecla hace poco.
  // Pedir solo el foco no alcanza: si el operador deja el cursor en un
  // campo y se va a mirar otra cosa, el refresco no volvería a correr
  // nunca. Con la ventana de gracia, se respeta la edición mientras
  // realmente está tipeando y se retoma sola 10s después de la última
  // tecla.
  function hayEdicionEnCurso() {
    const el = document.activeElement;
    if (!el) return false;
    const esCampo = el.tagName === 'INPUT' || el.tagName === 'SELECT'
                 || el.tagName === 'TEXTAREA' || el.isContentEditable;
    return esCampo && (Date.now() - ultimoTipeo) < GRACIA_TIPEO_MS;
  }

  // fn: async, hace el fetch + el re-render que corresponda al módulo.
  // Debe ser SILENCIOSA (sin spinner de pantalla completa ni líneas de
  // log) — corre sola cada 20s, no es una acción del usuario.
  function iniciar(fn, segundos = SEGUNDOS_DEFAULT) {
    detener();
    timer = setInterval(async () => {
      if (document.hidden || hayEdicionEnCurso()) return;
      try { await fn(); }
      catch (e) { console.warn('[auto-refresh] falló un ciclo (se reintenta):', e.message); }
    }, segundos * 1000);
    return timer;
  }

  function detener() { if (timer) { clearInterval(timer); timer = null; } }

  return { iniciar, detener, hayEdicionEnCurso, SEGUNDOS_DEFAULT };
})();
