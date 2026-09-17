// ============================================================
// orders.js
// ------------------------------------------------------------
// Guarda los PEDIDOS PARA LLEVAR ya completos (no confundir con los
// "tickets" de tickets.js/dashboard.js, que son casos escalados a un
// humano). Un pedido normal no necesita ticket: solo hay que avisarle
// al dueno que lo prepare.
//
// Usa el motor GENERICO de eventos programados (ver eventoProgramado.js,
// generalizado desde bot-whatsapp-template a partir de salones-belleza)
// SOLO para Motor B (solicitud de reseña despues de marcar el pedido como
// entregado) -- Motor A (recordatorios de anticipacion) NO aplica aqui: las
// recogidas son el mismo dia (minutos/horas de anticipacion como mucho), no
// ventanas tipo 24h/2h (ver la tabla de Precedentes en el CLAUDE.md
// general). Como los pedidos nunca traen "fecha"/"hora" real, Motor A
// simplemente nunca encontraria nada que hacer con ellos aunque se activara
// -- por eso ni siquiera hace falta llamarlo desde este proyecto.
//
// Cada pedido usa el estado "COMPLETADA" del motor generico para marcar
// "entregado" (mismo campo que usan citas/clases, ver eventoProgramado.js)
// -- el timestamp que ese estado fija automaticamente (completadaEn) es
// exactamente "entregadoEn": el momento en que se completo/entrego el
// pedido, que es lo que necesita seguimientoPostEvento.js para contar la
// espera antes de pedir la reseña.
// ============================================================

const { crearGestorDeEventos } = require('./eventoProgramado');
const { enviarMensajeWhatsApp } = require('./whatsapp');

const gestor = crearGestorDeEventos({ archivo: 'pedidos.json', prefijoId: 'PEDIDO' });

// OJO: este archivo (pedidos.json) tenia datos de un formato ANTERIOR (sin
// "id"/"estado", solo {fecha, cliente, detalle}) antes de este motor. Esos
// registros viejos se respaldaron en pedidos_respaldo_formato_anterior.json
// y se filtran aqui (les falta "id") para que no rompan el dashboard nuevo
// -- no se perdieron, solo ya no participan en Motor B.
function obtenerPedidos() {
  return gestor.obtenerEventos().filter((p) => p.id);
}

function guardarPedido(numeroCliente, detallePedido) {
  return gestor.crearEvento({
    cliente: numeroCliente,
    tipo: 'pedido',
    descripcion: (detallePedido || '').trim() || 'Pedido sin detalle',
  });
}

async function avisarAlDuenio(detallePedido, numeroCliente) {
  const numeroDuenio = process.env.OWNER_WHATSAPP_NUMBER;

  // Si el negocio todavia no configuro su numero, simplemente no avisamos
  // a nadie (pero el pedido queda guardado igual).
  if (!numeroDuenio) return;

  await enviarMensajeWhatsApp(numeroDuenio, `Nuevo pedido de ${numeroCliente}:\n${detallePedido}`);
}

module.exports = { gestor, obtenerPedidos, guardarPedido, avisarAlDuenio };
