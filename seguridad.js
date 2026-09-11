// ============================================================
// seguridad.js
// ------------------------------------------------------------
// Red de seguridad para mensajes graves (amenazas de violencia,
// autolesion, etc). NO dependemos unicamente de que la IA detecte
// esto bien -- aqui hacemos una revision aparte, por palabras clave,
// ANTES de mandarle el mensaje a Claude. Si detectamos algo grave:
//   1. Le contestamos al cliente SIEMPRE el mismo mensaje neutral
//      (nunca dejamos que la IA "improvise" una respuesta aqui).
//   2. Avisamos al dueno de forma URGENTE, marcada distinto a un
//      aviso normal de "necesita humano".
//
// Esto es una primera capa basica (por palabras clave). No sustituye
// el juicio de una persona: el objetivo es que el dueno se entere
// YA, no que el bot "resuelva" la situacion.
// ============================================================

const PALABRAS_CLAVE_GRAVES = [
  'matar', 'asesinar', 'bomba', 'atentado', 'disparar', 'balacera',
  'amenaza', 'amenazar', 'secuestr', 'explosivo', 'terrorist',
  'suicid', 'me quiero morir', 'quitarme la vida', 'arma de fuego',
  'violar', 'violacion', 'violación', 'abusar sexualmente', 'abuso sexual',
  'golpear', 'agredir', 'agresion', 'agresión', 'apunalar', 'apuñalar',
];

function contieneContenidoGrave(texto) {
  const textoNormalizado = texto.toLowerCase();
  return PALABRAS_CLAVE_GRAVES.some((palabra) => textoNormalizado.includes(palabra));
}

const RESPUESTA_NEUTRAL_PARA_EL_CLIENTE =
  'Gracias por tu mensaje. Alguien del negocio te va a contactar directamente en un momento.';

module.exports = { contieneContenidoGrave, RESPUESTA_NEUTRAL_PARA_EL_CLIENTE };
