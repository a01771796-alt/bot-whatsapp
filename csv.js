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

// Parser simple de CSV: soporta campos entre comillas dobles (incluyendo
// comas y comillas escapadas "" dentro del campo), que es lo que produce
// Google Sheets al "Publicar en la Web" como CSV. No es un parser RFC4180
// completo, pero cubre los casos reales de este proyecto -- lo usa el motor
// de recordatorios/reseñas (ver eventoProgramado.js, seguimientoPostEvento.js)
// para leer filas estructuradas (horario, link de reseña) de la informacion
// del negocio como datos, no como texto plano para la IA.
function parseCsv(texto) {
  const filas = [];
  let fila = [];
  let campo = '';
  let entreComillas = false;

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];

    if (entreComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          campo += '"';
          i++;
        } else {
          entreComillas = false;
        }
      } else {
        campo += c;
      }
      continue;
    }

    if (c === '"') {
      entreComillas = true;
    } else if (c === ',') {
      fila.push(campo);
      campo = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = '';
    } else {
      campo += c;
    }
  }

  if (campo !== '' || fila.length) {
    fila.push(campo);
    filas.push(fila);
  }

  return filas.filter((f) => f.some((valor) => valor.trim() !== ''));
}

module.exports = { crearDescargadorConCache, parseCsv };
