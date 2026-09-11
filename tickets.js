// ============================================================
// tickets.js
// ------------------------------------------------------------
// Sistema de tickets para los casos que el bot escala a un humano.
// Adaptado de un patron que ya se probo antes en Make.com (Google Sheets
// + Gmail) para otro negocio, pero aqui todo vive en Node.js: un archivo
// local (tickets.json) en vez de Google Sheets, y esta misma app web en
// vez de Gmail. Se evitan asi los dolores de cabeza de fechas seriales de
// Sheets que hubo en el proyecto anterior -- en Node, restar dos fechas es
// aritmetica normal.
//
// Estados por los que pasa un ticket: PENDIENTE -> EN_REVISION -> RESUELTO
// ============================================================

const fs = require('fs');
const { rutaArchivoDatos } = require('./almacenamiento');

const ARCHIVO_TICKETS = rutaArchivoDatos('tickets.json');

function leerTickets() {
  if (!fs.existsSync(ARCHIVO_TICKETS)) return [];
  try {
    return JSON.parse(fs.readFileSync(ARCHIVO_TICKETS, 'utf8'));
  } catch {
    return []; // Si el archivo se corrompio, no tronamos el bot por esto.
  }
}

function guardarTickets(tickets) {
  fs.writeFileSync(ARCHIVO_TICKETS, JSON.stringify(tickets, null, 2));
}

// ID legible tipo TK-20260910-151042-3 (fecha + hora + numero de ticket).
// En el proyecto de Make esto se armaba con el "Row Number" que devolvia
// Google Sheets; aqui usamos la posicion del ticket en el arreglo.
function generarIdTicket(numeroDeTicket) {
  const ahora = new Date();
  const fecha = ahora.toISOString().slice(0, 10).replace(/-/g, '');
  const hora = ahora.toTimeString().slice(0, 8).replace(/:/g, '');
  return `TK-${fecha}-${hora}-${numeroDeTicket}`;
}

// Regla de negocio para la prioridad. A proposito NO se le deja esto a la
// IA (ver claude.js): asi la prioridad siempre sigue el mismo criterio,
// sin importar como redacte la IA su respuesta ese dia.
//   - Cualquier cosa marcada como urgente (amenazas, seguridad) => ALTA
//   - Quejas y pedidos grandes/catering => ALTA
//   - Cualquier otro caso escalado (dudas que no se supieron resolver) => MEDIA
function calcularPrioridad({ esUrgente, categoria }) {
  if (esUrgente) return 'ALTA';
  if (categoria === 'QUEJA' || categoria === 'PEDIDO_GRANDE') return 'ALTA';
  return 'MEDIA';
}

function crearTicket({ numeroCliente, categoria, esUrgente, solicitud, respuestaEnviada }) {
  const tickets = leerTickets();

  const ticket = {
    id: generarIdTicket(tickets.length + 1),
    fecha: new Date().toISOString(),
    cliente: numeroCliente,
    categoria: categoria || 'OTRO',
    prioridad: calcularPrioridad({ esUrgente, categoria }),
    solicitud,
    respuestaEnviada,
    estado: 'PENDIENTE',
    horaRevision: null,
    horaResolucion: null,
    tiempoResolucionMinutos: null,
  };

  tickets.push(ticket);
  guardarTickets(tickets);
  return ticket;
}

// Cambia el estado de un ticket y calcula el tiempo de resolucion cuando
// aplica. "respuestaEnviada" es opcional: se usa cuando el dueno escribe su
// propia respuesta al resolver (ver dashboard.js), para dejar registrado
// que fue lo que realmente se le contesto al cliente (no un texto generico).
// Devuelve null si el ticket no existe (por ejemplo, un link viejo de un
// ticket que ya no esta, o alguien probando IDs al azar).
function actualizarEstadoTicket(id, nuevoEstado, { respuestaEnviada } = {}) {
  const tickets = leerTickets();
  const ticket = tickets.find((t) => t.id === id);
  if (!ticket) return null;

  ticket.estado = nuevoEstado;
  if (respuestaEnviada) ticket.respuestaEnviada = respuestaEnviada;

  if (nuevoEstado === 'EN_REVISION' && !ticket.horaRevision) {
    ticket.horaRevision = new Date().toISOString();
  }

  if (nuevoEstado === 'RESUELTO') {
    ticket.horaResolucion = new Date().toISOString();
    const minutos = (new Date(ticket.horaResolucion) - new Date(ticket.fecha)) / 60000;
    ticket.tiempoResolucionMinutos = Math.round(minutos);
  }

  guardarTickets(tickets);
  return ticket;
}

// Guarda el mensaje que el dueno le escribio al cliente desde el boton
// "Contactar al cliente" del dashboard, SIN tocar el estado del ticket --
// contactar al cliente y marcar el ticket como resuelto son dos acciones
// independientes (ver dashboard.js).
function registrarRespuestaEnviada(id, mensaje) {
  const tickets = leerTickets();
  const ticket = tickets.find((t) => t.id === id);
  if (!ticket) return null;

  ticket.respuestaEnviada = mensaje;
  guardarTickets(tickets);
  return ticket;
}

// Evita crear un ticket duplicado cuando el mismo cliente sigue escribiendo
// despues de que ya se le escalo algo: si la IA mezcla el tema viejo (ya
// abierto) con el mensaje nuevo y lo vuelve a clasificar igual, esto detecta
// que ya existe un ticket sin cerrar de esa MISMA categoria para ese mismo
// cliente. No aplica a "SEGURIDAD" a proposito -- ahi preferimos pecar de
// avisar de mas que perder una amenaza nueva por asumir que ya se atendio.
function existeTicketAbiertoIgual(numeroCliente, categoria) {
  if (categoria === 'SEGURIDAD') return false;

  return leerTickets().some(
    (t) => t.cliente === numeroCliente && t.categoria === categoria && t.estado !== 'RESUELTO'
  );
}

// Borra TODOS los tickets. Se usa desde la ruta de mantenimiento del
// dashboard (ver dashboard.js) para reiniciar el sistema durante pruebas.
function vaciarTickets() {
  guardarTickets([]);
}

function obtenerTickets() {
  return leerTickets();
}

function obtenerTicketPorId(id) {
  return leerTickets().find((t) => t.id === id) || null;
}

// El ticket sin resolver mas reciente de un cliente (de cualquier
// categoria). Se usa desde la pantalla de chat (ver dashboard.js): al
// mandarle un mensaje al cliente desde ahi, se actualiza el
// "respuestaEnviada" de su ticket abierto, si tiene uno, para que la
// tabla de tickets refleje lo ultimo que se le dijo.
function obtenerTicketAbiertoPorCliente(numeroCliente) {
  const abiertos = leerTickets()
    .filter((t) => t.cliente === numeroCliente && t.estado !== 'RESUELTO')
    .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

  return abiertos[0] || null;
}

module.exports = {
  crearTicket,
  actualizarEstadoTicket,
  registrarRespuestaEnviada,
  existeTicketAbiertoIgual,
  vaciarTickets,
  obtenerTickets,
  obtenerTicketPorId,
  obtenerTicketAbiertoPorCliente,
  calcularPrioridad,
};
