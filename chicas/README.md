# Módulo Chicas — Mesa de Operaciones · Sibratech

Todo el código vive en `index.html` (config, auth, cálculo y UI inline) —
mismo patrón que el resto de Market Suite.

## Fuentes de datos (aclarado 2026-07-23, había confusión sobre qué venía de dónde)

| Tarjeta | Fuente real | ¿Hay que tocarla? |
|---|---|---|
| ADCAP / IEB / BCCH ("↓ Sheet") | `SibraBrokers.loadTenencias()` → Sheet `TENENCIAS.CURRENT`, alimentado automáticamente por `sibra-brokers-repo`. **NO es un Excel de Drive** — el botón "↓ Sheet" solo fuerza un re-fetch salteando el cache (`SibraCache`, TTL 60s), no sube nada a mano. | No — ya está en la base real. |
| Cauciones (usadas para % bruto) | `SibraBrokers.loadCauciones()` → Sheet `CAUCIONES.CURRENT`, misma base. | No — ya está en la base real. |
| Clientes ("↓ Drive" / "↑ Local") | Excel en una carpeta de Drive (`cargarClientesDrive`/`parseClientes`). Dueño de `cc`/`cliente`/`alyc` para `findCliente()`. | **Sí, pendiente** — se mantiene a propósito hasta migrar a Supabase (decisión 2026-07-23, no tocar antes de esa migración). |
| Precios | data912 en vivo (API), no hay carga manual. | No aplica. |

## Bugs de cartera neta/bruta encontrados y arreglados (2026-07-23)

`getClienteCarteras(alyc, comitente)` calcula el % que ves en las tablas de
ventas/compras. Tenía DOS bugs que subestimaban la cartera total (por lo
tanto sobrestimaban el % de cada ticker):

1. **Cauciones no sumaban a la bruta.** El campo `caucionPesos` que traía el
   Excel de clientes nunca se usaba en ningún cálculo. Ahora se carga
   `caucionesPorCuenta` desde `SibraBrokers.loadCauciones()` (TOMADORA
   vigente) y se suma a `brutaArsTotal` — mismo criterio que
   `market/actual` (`brutaCliente = netaCliente + caucionTotalARS`).

2. **El efectivo no se sumaba en absoluto (el bug más grande).**
   `SibraBrokers.loadTenencias()` normaliza el ticker del efectivo de cada
   broker a 4 nombres canónicos — `PESOS` / `USD_MEP` / `USD_DIVISA` /
   `USD_CABLE` (ver `CASH_MAP` en `shared/sibra-brokers-data.js`). El código
   de `chicas` seguía comparando contra los nombres viejos
   (`CASH_ARS`/`CASH_USD`/`CASH_USD_MEP`/`CASH_USD_EXT`/`CASH_USD_7000`, de
   antes de que esa normalización compartida existiera), así que **ningún
   ticker calzaba** — el efectivo cae al `else` (tratado como "papel") y se
   valúa a precio de data912, que no tiene un ticker llamado `USD_MEP` → da
   `$0`. Confirmado con datos reales: cuenta IEB 349274 (Silva Omar), saldo
   USD MEP de ~US$1.725 (~$2,6M ARS, la posición más grande de la cuenta)
   desaparecía del total. Afectaba también `saldoLiquido()` (cash
   disponible para sugerir compras, siempre daba 0), el buscador de tickers
   (`CASH_TICKERS`/`getTickerList`), y los paneles de "Saldos negativos" /
   "Dólares exterior". Se agregó `isCashTicker()` (chequea contra los 4
   nombres canónicos) y se reemplazaron todas las comparaciones viejas.

3. **El MEP era 1.** Aún con el bug 2 arreglado, el efectivo USD seguía
   valiendo casi nada: la conversión usaba `getPrice('AL30/AL30D')` — un
   ticker literal que NO existe en data912 → `null` → `mep = 1`. Nuevo
   `getMEP()` = `AL30/AL30D` calculado desde los precios reales, mismo
   método que `actual/fetchMEP()`. (Auditado 2026-07-23: `actual` y
   `rotaciones` ya lo hacían bien — `rotaciones` además identifica el
   efectivo por las banderas `esEfectivo`/`bucket` del loader compartido,
   el patrón más robusto; ideal migrar `chicas` a eso en algún momento.)

## Features agregadas 2026-07-23

- **Exportar Excel**: dos botones en los headers de VENTA/COMPRA —
  "Exportar Excel" (un archivo, una hoja por ALyC) y "Excel por ALyC" (un
  archivo por mesa, para adjuntar en cada grupo). Toman todas las órdenes
  armadas (ventas+compras, cantidades tal cual editadas, ignorando los
  filtros por ALyC). Columna "Enviado WA" distingue lo ya mandado.
- **Mensaje WA con Monto estimado**: plantilla única `formatOrden()`
  (formato GrowCap: CC arriba, monto estimado = cantidad × spot, firma
  "GrowCap by SIBRATECH").
- **Tarjeta de tenencias unificada**: las 3 cards ADCAP/IEB/BCCH eran la
  misma fuente (`TENENCIAS.CURRENT`) con el mismo botón — ahora es una.

**Por qué `market/actual` nunca tuvo este bug**: no reconstruye el valor por
ticker — suma directo `p.valor` (`market_value_ars`, ya calculado por el
backend en `TENENCIAS.CURRENT`). `chicas` sí reconstruye con precio spot en
vivo (necesario para sugerir cantidades a vender contra el precio de
pantalla), así que necesita distinguir el ticker de efectivo a mano — de ahí
que el desalineo de nombres solo rompiera acá.
