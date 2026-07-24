# Módulo Comisiones · Sibratech

Frontend en `index.html` (inline, mismo patrón que el resto de Market Suite).
Lee la hoja `SIBRA_BROKERS_COMISIONES.CURRENT`, que arma el backend
(`sibra-brokers-repo/app/comisiones.py`) — y que desde 2026-07-23 también se
espeja en Supabase (tabla `brokers_comisiones`, ver abajo).

## De dónde sale cada número (estado 2026-07-23)

**Todas las comisiones son REALES** — no queda ninguna estimación:

| Broker | Comisión | IVA | Derechos |
|---|---|---|---|
| **ADCAP** | campo `arancel` de cada movimiento del ledger (`GetCtaCteConsolidado`) | **implícito**: el ledger no lo itemiza, pero `abs(neto−bruto) − arancel − derechos` lo reconstruye EXACTO (validado al centavo: 21% del arancel en jurídicas; físicas dan 0) | campo `derechos` (un solo número → columna "s/desglose") |
| **BCCH** | boleto a boleto, pantalla "Boletos del día" (`proceso=07`, un pedido por día) | no aplica: ambas cuentas son físicas y el boleto no trae línea de IVA | líneas `D.Mercado` / `D.Registro` del boleto |
| **IEB** | boleto a boleto (ídem BCCH), con fallback al agregado mensual del broker (`ARANCEL_REAL`, proceso=27) en meses aún sin backfillear | línea `IVA s/...` del boleto (solo jurídicas, ej. SIBRATECH SRL 261766) | ídem BCCH |

Anti-duplicación: donde hay boletos día-a-día, el backend descarta el
`DECV` de BCCH (mismo día) y el `ARANCel_REAL` de IEB (mismo mes) —
siempre gana la fuente más granular.

## Categorías

`COMISION` · `IVA` · `D_MERCADO` · `D_REGISTRO` · `DERECHOS` (sin
desglose, solo ADCAP) · `CUSTODIA` · `RETENCION` (impuesto del cliente,
no fee — puede existir sin comisión, ej. retención sobre dividendos).

Se eliminaron (2026-07-23): el "% que me corresponde" y la estimación de
ADCAP por volumen (`VOLUMEN_ADCAP`).

## Historial: cómo se cargó y qué falta

- Backfill día-por-día 2024-01→hoy vía
  `sibra-brokers-repo/scripts/backfill_boletos_gastos.py` (resumable,
  `--broker BCCH|IEB`, `--cuenta N` para priorizar una).
- **BCCH: completo** (2 cuentas, 1.338 días-cuenta).
- **ADCAP: completo** vía ledger (94.7%; solo falta 197980 SIBRATECH SRL II,
  que nunca operó).
- **IEB: parcial** — 348411 completa, 364275 hasta ene-2026, 261766
  (jurídica) desde hoy hacia atrás (jul-2026 ya cubierto). Quedan ~6
  cuentas: correr más tandas del backfill (login manual por corrida).
- Pre-2024 no existe en los brokers (BCCH verificado: pide desde 2020 y
  el primer movimiento real es 19/01/2024).

## Mantenimiento automático

El ciclo horario del backend (server FastAPI) sincroniza los boletos de
HOY para BCCH/IEB y reconstruye esta hoja + el espejo Supabase. **OJO:**
al 2026-07-23 el server está apagado a propósito (sus navegadores
Playwright pisarían el perfil que usa el backfill de IEB) — prenderlo
cuando los backfills terminen. Nunca dejar DOS servers corriendo: un
server viejo con código desactualizado pisó esta hoja en vivo.

## Supabase (migración dato→Supabase)

`brokers_comisiones` en el Supabase compartido (conexión vía
`SUPABASE_DB_URL`, mismo `.env` que sibra-obra-repo). Dual-write en cada
rebuild (`app/supabase_db.py`); este frontend TODAVÍA lee de Sheets —
migrarlo a PostgREST es el paso siguiente de la migración.
