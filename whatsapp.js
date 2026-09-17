// ============================================================
// whatsapp.js
// ------------------------------------------------------------
// Se encarga UNICAMENTE de mandar mensajes de WhatsApp, usando la
// API oficial de Meta (WhatsApp Cloud API). Todo lo demas (que
// contestar, cuando avisar al dueno, etc) vive en otros archivos.
// ============================================================

// Meta agrega historicamente un "1" extra despues del "52" en los numeros
// moviles mexicanos (formato: 521XXXXXXXXXX), y asi es como llega el
// numero del cliente en el campo "from" de cada webhook entrante. Pero al
// ENVIAR un mensaje, la API rechaza ese "1" (error 131030, "Recipient
// phone number not in allowed list") aunque el mismo numero si sea
// valido/permitido -- hay que quitarlo antes de usarlo como destinatario.
function normalizarNumeroMexicano(numero) {
  if (/^521\d{10}$/.test(numero)) {
    return `52${numero.slice(3)}`;
  }
  return numero;
}

// Todo mensaje (de texto o con boton) se manda con este mismo POST, solo
// cambia el "body" que arma cada funcion de arriba.
async function mandarAWhatsApp(numeroDestino, body) {
  const url = `https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

  const respuesta = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: normalizarNumeroMexicano(numeroDestino), ...body }),
  });

  if (!respuesta.ok) {
    // No tronamos el programa si un mensaje falla: solo lo dejamos anotado
    // en los "logs" (el historial que se ve en Railway/Render) para poder
    // revisarlo despues. Ver TROUBLESHOOTING.md.
    const detalleError = await respuesta.text();
    console.error('Error al enviar mensaje de WhatsApp:', detalleError);
    return false;
  }

  return true;
}

async function enviarMensajeWhatsApp(numeroDestino, texto) {
  return mandarAWhatsApp(numeroDestino, { type: 'text', text: { body: texto } });
}

// Manda un mensaje con un boton NATIVO de WhatsApp que abre una URL (tipo
// "cta_url" de los mensajes interactivos). Se usa para los links de accion
// del dashboard de tickets, para que se vean como un boton de verdad en vez
// de una URL pelona dentro del texto. OJO: cada mensaje de este tipo solo
// admite UN boton -- si se necesitan varias acciones hay que mandar varios
// mensajes, uno por boton.
async function enviarBotonConLinkWhatsApp(numeroDestino, textoCuerpo, textoBoton, url) {
  return mandarAWhatsApp(numeroDestino, {
    type: 'interactive',
    interactive: {
      type: 'cta_url',
      body: { text: textoCuerpo },
      action: { name: 'cta_url', parameters: { display_text: textoBoton, url } },
    },
  });
}

// Manda un mensaje de PLANTILLA (Message Template) pre-aprobada por Meta. A
// diferencia de enviarMensajeWhatsApp (texto libre), esto SI se puede mandar
// aunque hayan pasado mas de 24h desde el ultimo mensaje del cliente -- por
// eso lo usa el motor de recordatorios y reseñas (ver recordatorios.js y
// seguimientoPostEvento.js): son mensajes que el negocio inicia por su
// cuenta, no respuestas a algo que el cliente acaba de escribir, y Meta
// exige plantilla aprobada para ese caso.
//
// "nombrePlantilla" debe existir YA APROBADA en Meta Business Manager
// (WhatsApp Manager -> Message Templates) con esa cantidad exacta de
// variables {{1}}, {{2}}, etc. "parametros" es un arreglo de texto plano, en
// el mismo orden que las variables de la plantilla.
async function enviarPlantillaWhatsApp(numeroDestino, nombrePlantilla, idioma, parametros = []) {
  return mandarAWhatsApp(numeroDestino, {
    type: 'template',
    template: {
      name: nombrePlantilla,
      language: { code: idioma },
      components: parametros.length
        ? [{ type: 'body', parameters: parametros.map((texto) => ({ type: 'text', text: String(texto) })) }]
        : [],
    },
  });
}

module.exports = { enviarMensajeWhatsApp, enviarBotonConLinkWhatsApp, enviarPlantillaWhatsApp };
