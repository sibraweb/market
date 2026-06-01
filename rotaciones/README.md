# Módulo 3 — Rotaciones · Sibratech

App web de rotación de carteras de inversión. Lee tenencias desde Google Drive, calcula ventas y compras sugeridas, y guarda las órdenes en Drive.

## Setup en 3 pasos

### 1. Google Cloud Console

1. Ir a [console.cloud.google.com](https://console.cloud.google.com)
2. Crear proyecto o seleccionar el existente de Sibratech
3. Habilitar las APIs:
   - **Google Drive API**
   - **Google Sheets API**
   - **Google Identity Services**

4. Crear **OAuth 2.0 Client ID**:
   - Tipo: Web application
   - Authorized JavaScript origins: `https://sibraweb.github.io`
   - Authorized redirect URIs: `https://sibraweb.github.io/market/rotaciones/`
   - Copiar el **Client ID**

5. Crear **API Key**:
   - APIs & Services → Credentials → Create Credentials → API Key
   - Restringir a: Drive API + Sheets API
   - Copiar la **API Key**

### 2. Configurar index.html

Abrir `index.html` y reemplazar en el bloque CONFIG (línea ~270):

```js
CLIENT_ID: "TU_CLIENT_ID_AQUI.apps.googleusercontent.com",
API_KEY:   "TU_API_KEY_AQUI",
```

### 3. Subir a GitHub

```bash
git add index.html
git commit -m "feat: módulo 3 rotaciones completo"
git push
```

La app queda disponible en:  
`https://sibraweb.github.io/market/rotaciones/`

---

## Estructura de archivos en Drive

```
📁 01_ALYCS/
   📁 ADCAP/    → VALUACION_YYYY-MM-DD.xlsx (más reciente = tenencia)
   📁 IEB/
   📁 BCCCH/
   📁 BALANZ/
   📁 IBRK/
   📁 BINANCE/

📄 Clientes Sheet    → tabla de clientes con perfil y pesos LP/MP/CP/CASH
📄 Carteras modelo   → pestañas AGRESIVO / MODERADO / CONSERVADOR

📁 04_ROTACIONES_GENERADAS/  → {ALYC}_{fecha} (órdenes del día)
📁 05_CARTERAS_RESULTANTES/  → {fecha} (posiciones finales del día)
```

## Notas técnicas

- Precios live: [data912.com](https://data912.com) → renta fija se divide /100
- Tipo de cambio: AL30 / AL30D
- Cantidades: siempre `floor()` (entero para abajo)
- % ejecución por fila: botones −5 / +1, default 100%
- Semáforo verde = saldo ≥ 0, habilita guardar
