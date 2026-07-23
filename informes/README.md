# Módulo Informes · Sibratech

Todo el código vive en `index.html` (config, auth, cálculo y UI inline) —
mismo patrón que el resto de Market Suite.

## Pendientes / bugs detectados

- **MEP ↔ Pesos no cambia la rentabilidad mostrada** (detectado 2026-07-23):
  al alternar la vista entre valuación en pesos y en MEP, la rentabilidad de
  la cartera no varía. No debería ser así — el valor en pesos y el valor en
  MEP no se mueven a la misma velocidad (el tipo de cambio MEP fluctúa
  independiente de los precios en pesos de cada activo), así que la
  rentabilidad calculada en cada moneda tiene que diverger. Revisar de dónde
  sale la rentabilidad en cada vista — sospecha de que ambas están leyendo la
  misma serie/base en vez de recalcular sobre el valor en la moneda
  correspondiente.

## Roadmap (orden acordado)

1. Heat map (próximo paso).
2. Modelización de una cuenta puntual para validar que las operaciones ya
   cargadas (FIFO/histórico) están bien — cruzar contra lo real de esa
   cuenta.
