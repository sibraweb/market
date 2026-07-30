# Príncipe · Señales

Clon de `../rotaciones/` con **una sola diferencia de fondo: no hay cartera
objetivo de referencia**. En rotaciones el modelo (AGRESIVO / MODERADO /
CONSERVADOR) dice cuánto debería tener de cada especie y el sistema deduce
las ventas y compras. Acá no hay benchmark: se vende lo que se quiere y con
el producido se compra lo que se quiere.

El caso que lo motivó (Juan, 2026-07-30): *"queremos vender NU y comprar MU"*.

## Las dos pantallas

**01 · Cartera Inicial — qué vender.** Lista TODAS las tenencias con el % a
vender en **0**. Se sube el % de las que se quieran liquidar. Al revés de
rotaciones, donde el default era 100% porque el modelo ya mandaba: acá no
se vende nada salvo que se pida. El % topea en 100 (no se puede vender más
de lo que hay).

**02 · Cartera Objetivo — qué comprar.** No hay tabla de % objetivo: se
**tipea especie por especie** (ticker + cantidad). El precio lo resuelve
data912 en el momento de agregar; si el ticker no cotiza, se avisa ahí
mismo en vez de dejar una fila muerta que después bloquee el guardado sin
explicar por qué. Enter agrega y el foco vuelve al ticker, para cargar
varias seguidas.

El semáforo de saldo funciona igual que en rotaciones: verde cuando el
producido de las ventas (+ cash + aportes + margen de caución) cubre las
compras. Se agrega un bloqueo nuevo: **si alguna fila quedó sin cotización,
no se puede guardar** (`Calc.saldo` devuelve `hayInvalidas`).

**03 · Operaciones.** Igual que rotaciones, sin cambios.

## Lo que se mantiene de rotaciones

Todo el resto: auth de Google compartida (`../shared/sibra-auth.js`),
tenencias y cauciones de `SibraBrokers`, clientes de Supabase
(`SibraMaestros`), precios de data912 con renta fija ÷100, el control de
apalancamiento con su semáforo EN REGLA / SOBRE-APALANCADA, el bloqueo por
discrepancia de valuación contra el broker, y la escritura a Drive
(`04_ROTACIONES_GENERADAS/`, `05_CARTERAS_RESULTANTES/`).

## Tema visual

Design system SIBRATECH (rojo + escala neutra) en **tema claro de bajo
brillo**, por pedido explícito: la página es gris claro (`#ecedec`), NO
blanca — el blanco puro a pantalla completa encandila. Las tarjetas sí son
casi blancas (`#fafafa`) para despegarse del fondo: la jerarquía la da el
contraste entre superficies. El texto principal es `#141414`, más oscuro que
el `--ink-800` del DS, para ganar contraste sobre gris.

## Verificación

Probado con datos simulados en el navegador (sin necesidad de login):

| Escenario | Resultado |
|---|---|
| Tiene 100 NU a $50, quiere 20 MU a $200, no vende nada | disponible $0, necesario $4.020, **bloqueado** |
| Vende el 100% de NU | disponible $4.975, necesario $4.020, **OK**, sobra $955 |
| Ticker que no cotiza | `sinPrecio`, **bloqueado** |
