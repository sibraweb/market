# Módulo 3 — Rotaciones · Sibratech

App web de rotación de carteras de inversión. Lee tenencias y cauciones de la
base sibra-brokers, calcula ventas y compras sugeridas, y guarda las órdenes
en Drive.

Todo el código vive en `index.html` (config, auth, cálculo y UI inline). La
sesión de Google es compartida con el resto de Market Suite vía
`../shared/sibra-auth.js` / `../shared/sibra-cache.js` — no hay Client ID ni
API Key para configurar acá.

> Este README es el **doc canónico del motor de cálculo** (base, caución,
> disponible). `../principe-senales/` usa el mismo motor y lo referencia en
> vez de repetirlo.

## Fuentes de datos

- **Tenencias + cauciones**: `../shared/sibra-brokers-data.js` →
  `SibraBrokers.loadTenencias()` / `loadCauciones()`. Desde 2026-07-29 leen
  **Supabase** (`brokers_tenencias` / `brokers_cauciones`, espejo que el
  backend pisa en cada ciclo) con **fallback** a los Sheets
  `TENENCIAS.CURRENT` / `CAUCIONES.CURRENT`. Cubre ADCAP / IEB / BCCH
  (`CFG.ALYCS_SOPORTADAS`).
- **Clientes**: Supabase `market_clientes` (`SibraMaestros.clientes()`) —
  perfil, pesos LP/MP/CP/CASH, palanca. Se edita en `../maestros/`.
- **Carteras modelo**: Supabase `market_modelos`, por perfil y plazo.
- **Precios live**: [data912.com](https://data912.com) → renta fija se
  divide /100. Tipo de cambio: AL30 / AL30D. Se refrescan solos cada 20s
  (`../shared/sibra-autorefresh.js`) y con el botón "↻ ACTUALIZAR PRECIOS".

## Cómo se calcula el disponible (y qué hace la caución)

Esta parte se estabilizó en cuatro correcciones sucesivas
(`82ac883` → `a7f8361` → `24ce66b` → `a131bd5`). Vivía solo en los mensajes
de commit; se documenta acá para no re-derivarla cada vez.

### La base NO se apalanca

```
base = títulos + cash disponible + aportes        (Calc.base)
```

**No se suma la caución real ni se multiplica por (1+palanca).** Si la
caución está invertida, ya quedó reflejada en la base (hay más títulos o más
cash); si el cliente la retiró, no está y no hay que "traerla de vuelta". En
la práctica nunca se distingue si la cartera es neta o bruta: se toma lo que
efectivamente hay.

> El bug original (`82ac883`) era hacer las dos cosas a la vez: sumar la
> caución real **y** multiplicar por (1+palanca). Con títulos $100, caución
> real $50 y palanca 30%, daba base $195 en vez de $130.

### La caución entra por la diferencia contra lo acordado

```
caucionTeorica = base × palanca          ← palanca es el % acordado (tabla o override manual)
deltaCaucion   = caucionTeorica − caucionReal
disponible     = ventas netas + cash + aportes + deltaCaucion
```

- **deltaCaucion positivo** (se tomó menos caución de la permitida): suma
  como margen extra para comprar.
- **deltaCaucion negativo** (se tomó más de lo acordado): resta del
  disponible. El semáforo muestra **SOBRE-APALANCADA**.

**Nada de esto se mueve solo.** El operador sube o baja el % de
apalancamiento a mano. Si acepta a conciencia el nivel real de caución,
sube el % hasta que el semáforo quede **EN REGLA** — así queda marcado que
se revisó, en vez de quedar en rojo por descuido (`24ce66b`). Y subirlo
libera el disponible correspondiente, que es justamente para lo que sirve
ese campo (`a131bd5`).

**La caución nunca bloquea Guardar.** Lo único que bloquea es: saldo
insuficiente, un ticker sin precio, o discrepancia de valuación contra el
broker (ver abajo).

### ⚠️ `palanca` es un PORCENTAJE, no un multiplicador

`0` = sin apalancamiento acordado. `1` = **100% apalancado**. En
`../actual/` el mismo campo se cargaba con `|| 1` porque allá era un
multiplicador neutro — copiar ese default acá, o a la migración de
`market_clientes`, marca a **todos** los clientes como 100% apalancados e
infla el disponible con una caución teórica que no existe. Pasó el
2026-07-30 (los 30 clientes), corregido. **Nunca defaultear palanca a 1.**

### Control de discrepancia de valuación

Antes de dejar operar se compara **nuestra** valuación (cantidad × precio
data912) contra la que informa el broker (`market_value_ars`). Si difieren
más de `CFG.DISCREPANCIA_MAX_PCT` (5%), se **bloquea el guardado**: casi
siempre significa un precio mal escalado (el ÷100 de bonos/ON/letras) o una
tenencia mal cargada, y mandar órdenes con eso arruina las cantidades. Ver
`../shared/sibra-discrepancia.js` para el aviso equivalente en el resto de
los módulos.

## Escritura

- `04_ROTACIONES_GENERADAS/` (`CFG.DRIVE.CARPETA_ROTACIONES`) → `{ALYC}_{fecha}`
  (órdenes del día).
- `05_CARTERAS_RESULTANTES/` (`CFG.DRIVE.CARPETA_RESULTANTES`) → `{fecha}`
  (posiciones finales del día).

> `../principe-senales/` ya no escribe a Drive: guarda en Supabase
> (planilla del día, se vacía sola) y descarga un Excel local.

## Notas técnicas

- Cantidades: siempre `floor()` (entero para abajo).
- % ejecución por fila: botones −5 / +1, default 100%.
- Semáforo verde = saldo ≥ 0, habilita guardar.
- El login de Google ya **no** es obligatorio para entrar (2026-07-30): todo
  lo que se lee es Supabase. Solo se pide al guardar, que escribe en Drive.

## Deploy

La app queda disponible en `https://sibraweb.github.io/market/rotaciones/` —
alcanza con pushear a `main` (GitHub Pages sirve el repo directo).
