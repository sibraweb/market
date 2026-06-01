// ═══════════════════════════════════════════════════════════════
//  drive.js — Módulo 3 Rotaciones · Sibratech
//  Funciones de lectura y escritura con Google Drive / Sheets API
//  Requiere: config.js cargado antes, y gapi/google OAuth activo
// ═══════════════════════════════════════════════════════════════

const Drive = (() => {

  // ── Helpers internos ────────────────────────────────────────

  /** Llama a la Sheets API y devuelve los valores de un rango */
  async function _sheetValues(spreadsheetId, range) {
    const res = await gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    });
    return res.result.values || [];
  }

  /** Lista archivos dentro de una carpeta de Drive, ordenados por fecha desc */
  async function _listarArchivosEnCarpeta(folderId) {
    const res = await gapi.client.drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      orderBy: "modifiedTime desc",
      fields: "files(id, name, modifiedTime)",
      pageSize: 50,
    });
    return res.result.files || [];
  }

  /** Descarga un archivo xlsx de Drive como ArrayBuffer */
  async function _descargarXlsx(fileId) {
    const res = await gapi.client.drive.files.get({
      fileId,
      alt: "media",
    });
    // gapi devuelve el body como string binario, lo convertimos
    const binary = res.body;
    const buf = new ArrayBuffer(binary.length);
    const view = new Uint8Array(buf);
    for (let i = 0; i < binary.length; i++) {
      view[i] = binary.charCodeAt(i) & 0xff;
    }
    return buf;
  }

  // ── LECTURA: Clientes ────────────────────────────────────────

  /**
   * Carga la tabla de clientes desde el Google Sheet.
   * Retorna array de objetos con todos los campos del cliente.
   */
  async function cargarClientes() {
    const rows = await _sheetValues(CONFIG.DRIVE.SHEET_CLIENTES_ID, "Clientes!A2:L500");
    const C = CONFIG.COL_CLIENTES;

    return rows
      .filter(r => r[C.CC] && r[C.CARTERA] == 1)
      .map(r => ({
        cc:      String(r[C.CC] || "").trim(),
        cliente: String(r[C.CLIENTE] || "").trim(),
        cuit:    String(r[C.CUIT] || "").trim(),
        alyc:    String(r[C.ALYC] || "").trim().toUpperCase(),
        monto:   parseFloat(r[C.MONTO]) || 0,
        perfil:  String(r[C.PERFIL] || "MODERADO").trim().toUpperCase(),
        LP:      parseFloat(r[C.LP]) || 0,
        MP:      parseFloat(r[C.MP]) || 0,
        CP:      parseFloat(r[C.CP]) || 0,
        CASH:    parseFloat(r[C.CASH]) || 0,
        palanca: parseFloat(r[C.PALANCA]) || 0,
      }));
  }

  // ── LECTURA: Carteras Modelo ─────────────────────────────────

  /**
   * Carga las carteras modelo de los tres perfiles.
   * Retorna objeto: { AGRESIVO: [...], MODERADO: [...], CONSERVADOR: [...] }
   * Cada item: { plazo, ticker, pond_plazo }
   */
  async function cargarCarterasModelo() {
    const perfiles = ["AGRESIVO", "MODERADO", "CONSERVADOR"];
    const resultado = {};
    const C = CONFIG.COL_CARTERA_MODELO;

    for (const perfil of perfiles) {
      // Fila de headers en índice 4 → fila 5 → desde fila 6 tomamos datos (A6:D200)
      const rows = await _sheetValues(CONFIG.DRIVE.SHEET_CARTERAS_ID, `${perfil}!A6:D200`);
      resultado[perfil] = rows
        .filter(r => {
          const ticker = String(r[C.TICKER] || "").trim();
          const pond   = parseFloat(r[C.POND_PLAZO]);
          return ticker && ticker !== "" && !isNaN(pond) && pond > 0;
        })
        .map(r => ({
          plazo:      String(r[C.PLAZO] || "").trim().toUpperCase(),
          ticker:     String(r[C.TICKER] || "").trim().toUpperCase(),
          pond_plazo: parseFloat(r[C.POND_PLAZO]),
        }));
    }

    return resultado;
  }

  // ── LECTURA: Tenencias ───────────────────────────────────────

  /**
   * Carga la tenencia más reciente de una ALYC para un comitente.
   * Retorna objeto: { cashPesos, cashUSD, caucionPesos, posiciones[] }
   */
  async function cargarTenencia(alyc, cc) {
    const folderId = CONFIG.DRIVE.ALYCS[alyc];
    if (!folderId) throw new Error(`ALYC desconocida: ${alyc}`);

    // Tomar el archivo más reciente
    const archivos = await _listarArchivosEnCarpeta(folderId);
    if (!archivos.length) throw new Error(`No hay archivos en la carpeta de ${alyc}`);

    const archivoId = archivos[0].id;
    const buf = await _descargarXlsx(archivoId);

    // Parsear xlsx con SheetJS (XLSX debe estar cargado en index.html)
    const wb = XLSX.read(buf, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

    const C = CONFIG.COL_TENENCIA;
    const ccStr = String(cc).trim();

    // Filtrar filas del comitente
    const filas = rows.slice(1).filter(r => String(r[C.COMITENTE]).trim() === ccStr);

    let cashPesos    = 0;
    let cashUSD      = 0;
    let caucionPesos = 0;
    const posiciones = [];

    for (const r of filas) {
      const ticker    = String(r[C.TICKER] || "").trim();
      const codigo    = String(r[C.CODIGO_ESPECIE] || "").trim();
      const cantidad  = parseFloat(r[C.CANTIDAD]) || 0;
      const precio    = parseFloat(r[C.PRECIO]) || 0;
      const importe   = parseFloat(r[C.IMPORTE]) || 0;
      const tipoEsp   = parseInt(r[C.TIPO_ESPECIE]) || 0;

      if (ticker === "Pesos" || ticker === "$") {
        cashPesos = importe;
        continue;
      }
      if (ticker === "USD") {
        cashUSD = cantidad; // cantidad de USD
        continue;
      }
      // Filas resumen (ticker == "-" y codigo == "-") → caución tomadora
      if (ticker === "-" && codigo === "-" && tipoEsp === 0) {
        // El importe total del comitente (puede ser negativo si hay caución)
        // Solo nos interesa si hay caución tomadora (importe < 0 indica deuda)
        if (importe < 0) caucionPesos = Math.abs(importe);
        continue;
      }
      // Fila real con ticker
      if (ticker && ticker !== "-" && cantidad !== 0) {
        posiciones.push({
          ticker:  ticker.toUpperCase(),
          especie: String(r[C.ESPECIE] || "").trim(),
          cantidad,
          pu:      precio,
          importe,
        });
      }
    }

    return { cashPesos, cashUSD, caucionPesos, posiciones };
  }

  // ── ESCRITURA: Rotaciones generadas (04) ────────────────────

  /**
   * Guarda las órdenes de una rotación en la carpeta 04_ROTACIONES_GENERADAS.
   * Si el archivo del día/ALYC ya existe, agrega filas. Si no, lo crea.
   * @param {string} alyc
   * @param {Array} ordenes — array de objetos con campos de CONFIG.COL_ORDENES
   */
  async function guardarRotacion(alyc, ordenes) {
    const hoy = _fechaHoy();
    const nombreArchivo = `${alyc}_${hoy}`;
    const folderId = CONFIG.DRIVE.CARPETA_ROTACIONES_ID;

    // Buscar si ya existe
    const existentes = await _buscarArchivoEnCarpeta(folderId, nombreArchivo);
    let sheetId;

    if (existentes.length > 0) {
      sheetId = existentes[0].id;
    } else {
      // Crear nuevo Google Sheet
      sheetId = await _crearSheet(folderId, nombreArchivo, CONFIG.COL_ORDENES);
    }

    // Convertir órdenes a filas
    const filas = ordenes.map(o => [
      o.id        || _generarId(),
      o.fecha     || hoy,
      o.solicita  || "",
      o.operador  || "",
      o.alyc      || alyc,
      o.comitente || "",
      o.cuentaRofex || "",
      o.operacion || "",
      o.especie   || "",
      o.plazo     || CONFIG.PLAZO_ORDEN,
      o.cantidad  || 0,
      o.precio    || 0,
      o.moneda    || CONFIG.MONEDA_ORDEN,
      o.montoBruto || 0,
      o.observaciones || "",
    ]);

    await _appendFilas(sheetId, filas);
    return sheetId;
  }

  // ── ESCRITURA: Carteras resultantes (05) ────────────────────

  /**
   * Guarda o actualiza la cartera resultante de un comitente.
   * Archivo del día, todas las ALYCs juntas.
   * @param {string} alyc
   * @param {object} cliente
   * @param {Array} posicionesFinales — [{ ticker, cantidad }]
   */
  async function guardarCartResultante(alyc, cliente, posicionesFinales) {
    const hoy = _fechaHoy();
    const nombreArchivo = hoy;
    const folderId = CONFIG.DRIVE.CARPETA_RESULTANTES_ID;

    const existentes = await _buscarArchivoEnCarpeta(folderId, nombreArchivo);
    let sheetId;

    if (existentes.length > 0) {
      sheetId = existentes[0].id;
      // Eliminar filas previas del comitente en este archivo
      await _borrarFilasPorComitente(sheetId, cliente.cc);
    } else {
      sheetId = await _crearSheet(folderId, nombreArchivo, CONFIG.COL_RESULTANTES);
    }

    const filas = posicionesFinales
      .filter(p => p.cantidad > 0)
      .map(p => [
        hoy,
        alyc,
        cliente.cc,
        cliente.cliente,
        p.ticker,
        p.cantidad,
      ]);

    await _appendFilas(sheetId, filas);
    return sheetId;
  }

  // ── Helpers de escritura ─────────────────────────────────────

  async function _buscarArchivoEnCarpeta(folderId, nombre) {
    const res = await gapi.client.drive.files.list({
      q: `'${folderId}' in parents and name = '${nombre}' and trashed = false`,
      fields: "files(id, name)",
    });
    return res.result.files || [];
  }

  async function _crearSheet(folderId, nombre, headers) {
    // Crear Google Sheet vacío
    const resCreate = await gapi.client.sheets.spreadsheets.create({
      properties: { title: nombre },
    });
    const sheetId = resCreate.result.spreadsheetId;

    // Mover a la carpeta correcta
    const fileMeta = await gapi.client.drive.files.get({
      fileId: sheetId,
      fields: "parents",
    });
    const prevParents = (fileMeta.result.parents || []).join(",");
    await gapi.client.drive.files.update({
      fileId: sheetId,
      addParents: folderId,
      removeParents: prevParents,
      fields: "id, parents",
    });

    // Escribir headers
    await gapi.client.sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: "A1",
      valueInputOption: "RAW",
      resource: { values: [headers] },
    });

    return sheetId;
  }

  async function _appendFilas(sheetId, filas) {
    if (!filas.length) return;
    await gapi.client.sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: "A1",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      resource: { values: filas },
    });
  }

  async function _borrarFilasPorComitente(sheetId, cc) {
    // Leer todas las filas y filtrar las del comitente
    const rows = await _sheetValues(sheetId, "A:F");
    if (rows.length <= 1) return;

    // Encontrar índices a borrar (columna CC es índice 2)
    const indicesToDelete = [];
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][2]).trim() === String(cc).trim()) {
        indicesToDelete.push(i);
      }
    }
    if (!indicesToDelete.length) return;

    // Borrar en orden inverso para no desplazar índices
    const requests = indicesToDelete.reverse().map(idx => ({
      deleteDimension: {
        range: {
          sheetId: 0,
          dimension: "ROWS",
          startIndex: idx,
          endIndex: idx + 1,
        },
      },
    }));

    await gapi.client.sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      resource: { requests },
    });
  }

  // ── Utilidades ───────────────────────────────────────────────

  function _fechaHoy() {
    const d = new Date();
    return d.toISOString().slice(0, 10); // YYYY-MM-DD
  }

  function _generarId() {
    return Date.now() + Math.floor(Math.random() * 1000);
  }

  // ── API pública ──────────────────────────────────────────────
  return {
    cargarClientes,
    cargarCarterasModelo,
    cargarTenencia,
    guardarRotacion,
    guardarCartResultante,
  };

})();
