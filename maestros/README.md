# Maestros — edición de tablas base en Supabase

Módulo de carga/edición de los tres maestros de Market Suite, que desde
2026-07-29 viven en el **Supabase compartido** (proyecto `mkbeddulfbqgyutrzyvr`,
el mismo de obra/índices) y **ya no se leen de los Excel de Drive**:

| Tabla | Contenido | Reemplaza a |
|---|---|---|
| `market_papeles` | Clasificación de activos (SIMBOLO → grupo/subgrupo/país/moneda/sector/industria/vto) | hoja PAPELES de "Cartera Juan Agresivo.xlsx" (carpeta `1N1iMC…`) |
| `market_modelos` | Carteras objetivo: perfil × plazo × ticker × ponderación (fracción **dentro del plazo**) | hojas AGRESIVO/MODERADO/CONSERVADOR de "Cartera SIBRA.xlsx" (carpeta `1kp9Ju…`) |
| `market_clientes` | Alta de clientes, perfil y composición LP/MP/CP/CASH/PALANCA (clave **alyc+cc**) | "Tabla de Clientes.xlsx" (carpeta `1HBVS0…`) |

Los Excel de Drive quedaron como respaldo histórico congelado — nadie los lee.

## Semántica de guardado

**Reemplazo total**: los maestros se modifican todo el tiempo, no se acumulan.
"💾 Guardar en base" borra la tabla y escribe lo que está en pantalla
(`SibraMaestros.replaceTable`). No hay histórico en Supabase (decisión general:
las series largas/históricos NO van a Supabase, quedan en Drive — ver
`comisiones/README.md`).

- Las cauciones NO están en el maestro de clientes: vienen solas de la base
  sibra-brokers (`SibraBrokers.loadCauciones`). Se borraron las columnas fijas.
- `activo` de un cliente (filtro de rotaciones) = columna `cartera ≠ 0`.
- Importar Excel acepta tanto los formatos viejos de Drive como el export plano
  de este módulo; importar NO guarda — hay que tocar Guardar.

## Seguridad / login

Las tablas tienen **RLS "solo authenticated"**: la anon key sola no lee nada.
El login es email/contraseña de **Supabase Auth** (modal compartido inyectado
por `shared/sibra-maestros.js`, sesión en localStorage `sibra_sb_session`).
Usuarios: se crean a mano en el dashboard (Authentication → Users → Add user).
Este login es el candidato a login único de obra+market+ERP a futuro.

Config en `shared/sibra-maestros.js`: `SUPABASE_URL` y `ANON_KEY` (la anon key
es pública por diseño; el secreto real es la contraseña del usuario + RLS).

## Quién consume los maestros

- `actual/` — `cargarMaestros()` (papeles → S.allocation, modelos, clientes).
- `rotaciones/` — `Datos.cargarClientes()` y `Datos.cargarCarteras()`.
- `propuestas/` — `cargarTodoDesdeDrive()` (nombre legacy, ya lee de la base).
- `chicas/` — `cargarClientesDrive()` (nombre legacy, ya lee de la base).

Tenencias/cauciones también viven en Supabase (2026-07-29):
`brokers_tenencias`/`brokers_cauciones`, espejo del CURRENT que el backend de
sibra-brokers **pisa entero** en cada ciclo (`supabase_db.mirror_snapshot`,
dual-write) — `sibra-brokers-data.js` las lee de Supabase con fallback a
Sheets. Google/Drive queda SOLO para subir archivos (rotaciones/resultantes)
y la hoja Operaciones de chicas (escritura de órdenes).

## Migración original (2026-07-29)

Datos migrados con scripts one-shot (scratchpad de la sesión): 5.786 papeles,
61 posiciones modelo (solo plazo LARGO existía; cada perfil suma 100%),
30 clientes. Conexión Python por el **pooler IPv4**
`aws-1-us-east-2.pooler.supabase.com` (el host directo `db.…supabase.co` es
IPv6-only y no resuelve en esta red).
