# Príncipe · Señales

Clon de `../rotaciones/` con **una diferencia de fondo: no hay cartera
objetivo de referencia**. En rotaciones el modelo (AGRESIVO / MODERADO /
CONSERVADOR) dice cuánto debería tener de cada especie y el sistema deduce
las ventas y compras. Acá no hay benchmark: se vende lo que se quiere y con
el producido se compra lo que se quiere.

El caso que lo motivó (Juan, 2026-07-30): *"queremos vender NU y comprar MU"*.

## Las pantallas

**00 · Señales.** Lista de venta/compra que se define UNA vez y se aplica a
todos los clientes (tabla `market_senales` en Supabase, reemplazo total al
guardar — se editan, no se acumulan).

- **Venta**: % de la TENENCIA ACTUAL de ese ticker. Si el cliente no lo
  tiene, no aparece en su "Qué vender" — es 0% de nada, sin caso especial.
- **Compra**: % TOPE de la cartera (títulos + cash). Se sugiere la cantidad
  que falta para LLEGAR a ese tope, neta de lo que la propia señal de venta
  ya esté liquidando de ese ticker. Si el ticker no cotiza en data912, se
  omite (no se puede sugerir cantidad sin precio).

Las señales se aplican al seleccionar cliente **y** al guardarlas (si ya hay
uno abierto). Después el operador puede ajustar cualquier valor a mano: son
el punto de partida, no un bloqueo.

**01 · Cartera Inicial — qué vender.** Todas las tenencias con su %Neto
(sobre cartera sin caución) y %Bruto (con caución), y el % a vender que
haya puesto la señal (0 si no hay). Abajo, una tabla con las señales de
venta cuyo ticker el cliente NO tiene, para que se vea que existen.

**02 · Cartera Objetivo — qué comprar.** Lo que sugirió la señal de compra,
más lo que se agregue a mano (ticker + cantidad). El precio lo resuelve
data912 al agregar; si no cotiza, se avisa ahí mismo en vez de dejar una
fila muerta que después bloquee el guardado sin explicar por qué.

**03 · Operaciones.** Lo guardado HOY (órdenes + cartera resultante). No hay
selector de fecha: la planilla se vacía sola en el primer guardado de cada
día nuevo.

## Guardar

Sin Google. Cada guardado:
1. Persiste en Supabase (`market_ordenes_dia` / `market_resultante_dia`) —
   planilla de trabajo del día, se vacía sola al cambiar el día. Órdenes es
   append; Resultante reemplaza solo las filas de ese cliente.
2. Descarga un `.xlsx` local (hojas Rotación + Resultante) para reenviar a
   la mesa por WhatsApp/mail.

**No es un histórico.** Lo realmente ejecutado se compara al otro día contra
la base de brokers (desvíos: "pedimos 10, operaron 11"). Esto es solo "qué
pedimos hoy" antes de tener las operaciones reales.

## Motor de cálculo (base, caución, disponible)

Es **el mismo de `../rotaciones/`** y está documentado allá para no tenerlo
en dos lados: [`../rotaciones/README.md`](../rotaciones/README.md) →
"Cómo se calcula el disponible (y qué hace la caución)".

Lo imprescindible: **`palanca` es un PORCENTAJE** (`0` = sin
apalancamiento, `1` = 100%), la base **no** se apalanca, y `deltaCaucion`
suma/resta del disponible pero solo cuando el operador mueve el % a mano.
**Nunca defaultear palanca a 1** — pasó el 2026-07-30 y marcó a los 30
clientes como 100% apalancados.

## Precios

data912 `/live` (5 paneles; renta fija ÷100). Se refrescan **solos cada 20
segundos** (`../shared/sibra-autorefresh.js`) y con el botón "↻ ACTUALIZAR
PRECIOS". El ciclo automático se saltea si la pestaña está en segundo plano
o si el operador tipeó algo en los últimos 10s (para no robarle el foco a
mitad de una cantidad). Tipo de cambio: AL30 / AL30D.

## Lo que se mantiene de rotaciones

Tenencias y cauciones de `SibraBrokers` (Supabase, fallback a Sheets),
clientes de Supabase (`SibraMaestros`), el semáforo EN REGLA /
SOBRE-APALANCADA, y el bloqueo por discrepancia de valuación contra el
broker.

## Tema visual

Design system SIBRATECH (rojo + escala neutra) en **tema oscuro**, mismo
palette que el resto de Market Suite (`maestros/`, `tasas/`, `homebroker/`).
Texto blanco puro para máximo contraste (Juan, 2026-07-30).

## Verificación

| Escenario | Resultado |
|---|---|
| Tiene 100 NU a $50, quiere 20 MU a $200, no vende nada | disponible $0, necesario $4.020, **bloqueado** |
| Vende el 100% de NU | disponible $4.975, necesario $4.020, **OK**, sobra $955 |
| Ticker que no cotiza | `sinPrecio`, **bloqueado** |
| Señal venta 50% MSFT + 10% META, cliente solo tiene MSFT | pctV con ambos; META no genera fila (no hay tenencia) |
| Señal compra tope 15% MU / 5% NU, cartera $10.000 | sugiere 150 MU ($10/u) y 25 NU ($20/u) |
| Vende NU $3.614.786, compra 88 MA $2.448.959 | sobrante **$1.165.827** (no "$1" — ver bug del semáforo, `1dec55a`) |
