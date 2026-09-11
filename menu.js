// ============================================================
// menu.js
// ------------------------------------------------------------
// Lee el menu, horario y preguntas frecuentes desde el Google Sheet
// del negocio (publicado como CSV). Asi el dueno edita su informacion
// en una hoja de calculo normal, sin tocar nada de codigo.
// ============================================================

const { crearDescargadorConCache } = require('./csv');

const descargar = crearDescargadorConCache('menu del negocio');

async function obtenerContextoDelNegocio() {
  const url = process.env.GOOGLE_SHEET_CSV_URL;

  if (!url) {
    throw new Error(
      'Falta configurar GOOGLE_SHEET_CSV_URL en el archivo .env (el link a tu Google Sheet publicado como CSV).'
    );
  }

  const csv = await descargar(url);

  if (!csv) {
    throw new Error('No se pudo descargar el menu/FAQ desde Google Sheets.');
  }

  return csv;
}

module.exports = { obtenerContextoDelNegocio };
