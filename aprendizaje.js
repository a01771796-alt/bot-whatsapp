// ============================================================
// aprendizaje.js
// ------------------------------------------------------------
// OJO - esto NO es "inteligencia artificial que aprende sola".
// Cada llamada a Claude es independiente y no recuerda conversaciones
// pasadas por su cuenta. Lo que hacemos aqui es un ciclo real con
// una persona en medio:
//
//   1) El bot no sabe contestar algo  -> se queda registrado en
//      casos-dificiles.json (registrarCasoDificil).
//   2) Tu o el dueno del negocio revisan ese archivo de vez en cuando
//      (una vez a la semana es suficiente para un negocio chico).
//   3) Agregan la pregunta y la respuesta correcta a la pestana
//      "Aprendizaje" del Google Sheet (la misma hoja del menu, en
//      otra pestana publicada como CSV aparte).
//   4) Desde ese momento, el bot YA sabe contestar eso, para siempre,
//      sin que nadie toque codigo.
//
// Esto es honesto: el bot "mejora" porque una persona revisa y ensena,
// no porque la IA se reentrene sola.
// ============================================================

const fs = require('fs');
const path = require('path');
const { crearDescargadorConCache } = require('./csv');

const descargar = crearDescargadorConCache('casos aprendidos');
const ARCHIVO_CASOS_DIFICILES = path.join(__dirname, 'casos-dificiles.json');

// Devuelve el texto de la pestana "Aprendizaje" del Google Sheet, o ''
// si el negocio todavia no configuro esa pestana (es opcional).
async function obtenerCasosAprendidos() {
  const url = process.env.GOOGLE_SHEET_APRENDIZAJE_CSV_URL;
  return descargar(url);
}

// Guarda, en un archivo local, cada vez que el bot no supo que contestar
// (necesita humano, alerta urgente, o hubo un error tecnico). Esto es lo
// que despues se revisa para "ensenarle" al bot la respuesta correcta.
function registrarCasoDificil({ numeroCliente, mensaje, motivo }) {
  let casos = [];

  if (fs.existsSync(ARCHIVO_CASOS_DIFICILES)) {
    try {
      casos = JSON.parse(fs.readFileSync(ARCHIVO_CASOS_DIFICILES, 'utf8'));
    } catch {
      casos = []; // Si el archivo se corrompio por alguna razon, empezamos de cero
      // en vez de tronar el bot por esto.
    }
  }

  casos.push({
    fecha: new Date().toLocaleString('es-MX'),
    cliente: numeroCliente,
    mensaje,
    motivo, // ej: "necesita_humano", "urgente", "error_tecnico"
  });

  fs.writeFileSync(ARCHIVO_CASOS_DIFICILES, JSON.stringify(casos, null, 2));
}

module.exports = { obtenerCasosAprendidos, registrarCasoDificil };
