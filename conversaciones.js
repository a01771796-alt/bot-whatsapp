// ============================================================
// conversaciones.js
// ------------------------------------------------------------
// Historial COMPLETO de mensajes por cliente (numero de WhatsApp) --
// no solo los mensajes que dispararon un ticket, sino toda la
// conversacion: lo que escribe el cliente, lo que contesta el bot (IA),
// y lo que escribe el dueno/empleado a mano desde el dashboard.
//
// Se guarda en el mismo volumen persistente que tickets.json (ver
// almacenamiento.js), indexado por numero de cliente para poder leer
// una conversacion completa de un solo golpe.
//
// Esto reemplaza el Map en RAM que antes vivia en index.js (se perdia
// al reiniciar el servidor, y solo guardaba los ultimos 6 mensajes).
// Ahora el historial es permanente, y "los ultimos N mensajes" se
// calculan al leer, no al guardar.
// ============================================================

const fs = require('fs');
const { rutaArchivoDatos } = require('./almacenamiento');

const ARCHIVO_CONVERSACIONES = rutaArchivoDatos('conversaciones.json');

function leerTodas() {
  if (!fs.existsSync(ARCHIVO_CONVERSACIONES)) return {};
  try {
    return JSON.parse(fs.readFileSync(ARCHIVO_CONVERSACIONES, 'utf8'));
  } catch {
    return {}; // Si el archivo se corrompio, no tronamos el bot por esto.
  }
}

function guardarTodas(conversaciones) {
  fs.writeFileSync(ARCHIVO_CONVERSACIONES, JSON.stringify(conversaciones, null, 2));
}

// Agrega un mensaje al historial de un cliente. "rol" es uno de:
// "cliente", "bot" (respuesta automatica de la IA), o "dueno" (mensaje
// escrito a mano desde el dashboard).
function agregarMensaje(numeroCliente, rol, texto) {
  const conversaciones = leerTodas();

  if (!conversaciones[numeroCliente]) {
    conversaciones[numeroCliente] = { mensajes: [] };
  }

  conversaciones[numeroCliente].mensajes.push({
    rol,
    texto,
    fecha: new Date().toISOString(),
  });

  guardarTodas(conversaciones);
}

// Historial completo de un cliente, en orden cronologico. Arreglo vacio
// si todavia no se le ha guardado ningun mensaje.
function obtenerConversacion(numeroCliente) {
  const conversaciones = leerTodas();
  return conversaciones[numeroCliente]?.mensajes || [];
}

// Los ultimos N mensajes de un cliente -- se usa para armar el contexto
// que se le manda a Claude (ver claude.js), igual que antes hacia el Map
// en RAM, pero ahora releyendo del historial persistido.
function obtenerUltimosMensajes(numeroCliente, cantidad) {
  return obtenerConversacion(numeroCliente).slice(-cantidad);
}

module.exports = { agregarMensaje, obtenerConversacion, obtenerUltimosMensajes };
