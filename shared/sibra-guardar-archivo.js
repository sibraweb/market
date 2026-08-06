// ═══════════════════════════════════════════════════════════════
//  sibra-guardar-archivo.js — guardar un archivo generado en el navegador
//  dejando ELEGIR la carpeta, arrancando en el Escritorio.
//
//  Por qué existe (Juan, 2026-08-06): los .xlsx para la mesa caían siempre en
//  Descargas y se perdían entre todo lo demás. Una página web NO puede escribir
//  en una ruta fija del disco — eso lo impide el navegador a propósito, y no
//  hay forma de saltearlo. Lo máximo permitido es abrir el diálogo nativo de
//  "Guardar como" ya posicionado en el Escritorio, y que la persona confirme.
//
//  `showSaveFilePicker` es la única API que hace eso. Dos detalles del
//  estándar que conviene saber:
//    · `startIn:'desktop'` es una SUGERENCIA y sólo pesa la PRIMERA vez: a
//      partir de ahí Chrome recuerda la última carpeta que usaste en este
//      sitio (que en general es lo que uno quiere).
//    · Sólo existe en navegadores basados en Chromium y en contexto seguro
//      (https o localhost). En cualquier otro caso se cae a la descarga
//      común, que es exactamente lo que se hacía antes.
// ═══════════════════════════════════════════════════════════════
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * @returns {Promise<{guardado:boolean, cancelado:boolean, elegioCarpeta:boolean}>}
 *   `cancelado` = la persona cerró el diálogo: NO se descarga nada por su
 *   cuenta. Bajar el archivo igual sería hacer justo lo que acaba de rechazar.
 */
async function guardarArchivoLocal(buf, nombreArchivo, mime = XLSX_MIME) {
  const blob = new Blob([buf], { type: mime });

  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: nombreArchivo,
        startIn: 'desktop',
        types: [{ description: 'Excel', accept: { [mime]: ['.xlsx'] } }],
      });
      const escritor = await handle.createWritable();
      await escritor.write(blob);
      await escritor.close();
      return { guardado: true, cancelado: false, elegioCarpeta: true };
    } catch (e) {
      if (e && e.name === 'AbortError') {
        return { guardado: false, cancelado: true, elegioCarpeta: true };
      }
      // Cualquier otra falla (permiso denegado, API a medias): mejor bajarlo
      // por Descargas que dejar a la persona sin archivo.
      console.warn('[guardarArchivoLocal] el diálogo falló, bajo por Descargas:', e);
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombreArchivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return { guardado: true, cancelado: false, elegioCarpeta: false };
}
