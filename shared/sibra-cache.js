// ═══════════════════════════════════════════════════════════════
//  sibra-cache.js — caché genérica en localStorage con TTL, para
//  no releer Drive/Sheets en cada navegación entre módulos.
//  Cada módulo elige su propia key (ej. folder id, sheet id + tab).
//  El botón "Actualizar" de cada módulo debe llamar invalidate(key)
//  antes de refetchear, para saltear la caché a pedido.
// ═══════════════════════════════════════════════════════════════
const SibraCache = (() => {
  const PREFIX = 'sibra_cache_';
  const DEFAULT_TTL = 60; // segundos

  function get(key, ttlSeconds = DEFAULT_TTL) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      if (!raw) return null;
      const { value, ts } = JSON.parse(raw);
      if (Date.now() - ts > ttlSeconds * 1000) return null;
      return value;
    } catch (e) { return null; }
  }

  function set(key, value) {
    try { localStorage.setItem(PREFIX + key, JSON.stringify({ value, ts: Date.now() })); }
    catch (e) { /* localStorage lleno o valor no serializable: se ignora, no es crítico */ }
  }

  function invalidate(key) { localStorage.removeItem(PREFIX + key) }

  return { get, set, invalidate };
})();
