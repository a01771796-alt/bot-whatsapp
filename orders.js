// ============================================================
// orders.js
// ------------------------------------------------------------
// Guarda los PEDIDOS PARA LLEVAR ya completos (no confundir con los
// "tickets" de tickets.js/dashboard.js, que son casos escalados a un
// humano). Un pedido normal no necesita ticket: solo hay que avisarle
// al dueno que lo prepare.
// ============================================================

const fs = require('fs');
const path = require('path');
const { enviarMensajeWhatsApp } = require('./whatsapp');

const ARCHIVO_PEDIDOS = path.join(__dirname, 'pedidos.json');

function guardarPedido(numeroCliente, detallePedido) {
  let pedidos = [];

  if (fs.existsSync(ARCHIVO_PEDIDOS)) {
    pedidos = JSON.parse(fs.readFileSync(ARCHIVO_PEDIDOS, 'utf8'));
  }

  pedidos.push({
    fecha: new Date().toLocaleString('es-MX'),
    cliente: numeroCliente,
    detalle: detallePedido,
  });

  fs.writeFileSync(ARCHIVO_PEDIDOS, JSON.stringify(pedidos, null, 2));
}

async function avisarAlDuenio(detallePedido, numeroCliente) {
  const numeroDuenio = process.env.OWNER_WHATSAPP_NUMBER;

  // Si el negocio todavia no configuro su numero, simplemente no avisamos
  // a nadie (pero el pedido queda guardado igual).
  if (!numeroDuenio) return;

  await enviarMensajeWhatsApp(numeroDuenio, `Nuevo pedido de ${numeroCliente}:\n${detallePedido}`);
}

module.exports = { guardarPedido, avisarAlDuenio };
