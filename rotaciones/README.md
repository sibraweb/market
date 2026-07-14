# Módulo 3 — Rotaciones · Sibratech

App web de rotación de carteras de inversión. Lee tenencias y cauciones de la
base sibra-brokers, calcula ventas y compras sugeridas, y guarda las órdenes
en Drive.

Todo el código vive en `index.html` (config, auth, cálculo y UI inline). La
sesión de Google es compartida con el resto de Market Suite vía
`../shared/sibra-auth.js` / `../shared/sibra-cache.js` — no hay Client ID ni
API Key para configurar acá.

## Fuentes de datos

- **Tenencias + cauciones**: `../shared/sibra-brokers-data.js` →
  `SibraBrokers.loadTenencias()` / `loadCauciones()`, que leen los Sheets
  `TENENCIAS.CURRENT` / `CAUCIONES.CURRENT` (alimentados automáticamente por
  `sibra-brokers-repo`, sin subir Excel a mano). Cubre ADCAP / IEB / BCCH
  (`CFG.ALYCS_SOPORTADAS`).
- **Clientes**: Sheet en Drive (`CFG.DRIVE.CARPETA_CLIENTES`) — perfil,
  pesos LP/MP/CP/CASH, caución fija.
- **Carteras modelo**: archivo en Drive (`CFG.DRIVE.CARPETA_PAPELES`),
  pestañas AGRESIVO / MODERADO / CONSERVADOR.
- **Precios live**: [data912.com](https://data912.com) → renta fija se
  divide /100. Tipo de cambio: AL30 / AL30D.

## Escritura

- `04_ROTACIONES_GENERADAS/` (`CFG.DRIVE.CARPETA_ROTACIONES`) → `{ALYC}_{fecha}`
  (órdenes del día).
- `05_CARTERAS_RESULTANTES/` (`CFG.DRIVE.CARPETA_RESULTANTES`) → `{fecha}`
  (posiciones finales del día).

## Notas técnicas

- Cantidades: siempre `floor()` (entero para abajo).
- % ejecución por fila: botones −5 / +1, default 100%.
- Semáforo verde = saldo ≥ 0, habilita guardar.

## Deploy

La app queda disponible en `https://sibraweb.github.io/market/rotaciones/` —
alcanza con pushear a `main` (GitHub Pages sirve el repo directo).
