// ============================================================
// csv.js
// ------------------------------------------------------------
// Descarga un CSV publicado de Google Sheets, guardando una copia
// en memoria (cache) por 10 minutos para no golpear Google en cada
// mensaje. La usan menu.js (el menu/FAQ) y aprendizaje.js (los
// "casos aprendidos").
//
// Si Google falla momentaneamente, devolvemos la ultima copia buena
// que tengamos guardada en vez de dejar al bot sin informacion.
// ============================================================

const DIEZ_MINUTOS_EN_MS = 10 * 60 * 1000;

function crearDescargadorConCache(nombreParaLogs) {
  let cache = { texto: '', ultimaActualizacion: 0 };

  return async function descargar(url) {
    if (!url) return ''; // Ese Google Sheet no se configuro: no hay nada que descargar.

    const ahora = Date.now();
    const cacheEsReciente = cache.texto && (ahora - cache.ultimaActualizacion) < DIEZ_MINUTOS_EN_MS;
    if (cacheEsReciente) return cache.texto;

    try {
      const respuesta = await fetch(url);
      if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
      const csv = await respuesta.text();
      cache = { texto: csv, ultimaActualizacion: ahora };
      return csv;
    } catch (error) {
      console.error(`No se pudo descargar "${nombreParaLogs}":`, error.message);
      return cache.texto; // Puede ser '' si nunca se descargo con exito.
    }
  };
}

module.exports = { crearDescargadorConCache };
