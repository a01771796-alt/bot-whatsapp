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

// Saca el codigo y el mensaje del cuerpo de error que regresa Meta
// ({"error":{"code":131047,"message":"..."}}). Si el cuerpo no es JSON (o no
// trae esa forma), usa el texto tal cual, recortado.
function leerErrorDeMeta(textoRespuesta) {
  try {
    const { error } = JSON.parse(textoRespuesta);
    if (error && (error.code || error.message)) {
      return { codigo: error.code ?? null, mensaje: String(error.message ?? '').slice(0, 300) };
    }
  } catch {
    // No era JSON: se usa el texto crudo de abajo.
  }
  return { codigo: null, mensaje: String(textoRespuesta || '').slice(0, 300) };
}

// El POST real a la API de Meta. Regresa el detalle ({ok, status, codigo,
// mensaje}) en vez de solo true/false -- lo usa avisarAlDueno para decidir si
// reintenta por plantilla. Igual que antes, NO atrapa errores de red: si
// fetch truena, la excepcion sube a quien llamo.
async function mandarAWhatsAppDetallado(numeroDestino, body) {
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
    return { ok: false, status: respuesta.status ?? null, ...leerErrorDeMeta(detalleError) };
  }

  return { ok: true };
}

// Todo mensaje (de texto o con boton) se manda con este mismo POST, solo
// cambia el "body" que arma cada funcion de arriba. Regresa true/false, como
// siempre -- los avisos al dueno usan avisarAlDueno (mas abajo) para tener
// el detalle del error.
async function mandarAWhatsApp(numeroDestino, body) {
  return (await mandarAWhatsAppDetallado(numeroDestino, body)).ok;
}

function armarBodyTexto(texto) {
  return { type: 'text', text: { body: texto } };
}

async function enviarMensajeWhatsApp(numeroDestino, texto) {
  return mandarAWhatsApp(numeroDestino, armarBodyTexto(texto));
}

function armarBodyBotonConLink(textoCuerpo, textoBoton, url) {
  return {
    type: 'interactive',
    interactive: {
      type: 'cta_url',
      body: { text: textoCuerpo },
      action: { name: 'cta_url', parameters: { display_text: textoBoton, url } },
    },
  };
}

// Manda un mensaje con un boton NATIVO de WhatsApp que abre una URL (tipo
// "cta_url" de los mensajes interactivos). Se usa para los links de accion
// del dashboard de tickets, para que se vean como un boton de verdad en vez
// de una URL pelona dentro del texto. OJO: cada mensaje de este tipo solo
// admite UN boton -- si se necesitan varias acciones hay que mandar varios
// mensajes, uno por boton.
async function enviarBotonConLinkWhatsApp(numeroDestino, textoCuerpo, textoBoton, url) {
  return mandarAWhatsApp(numeroDestino, armarBodyBotonConLink(textoCuerpo, textoBoton, url));
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
function armarBodyPlantilla(nombrePlantilla, idioma, parametros = []) {
  return {
    type: 'template',
    template: {
      name: nombrePlantilla,
      language: { code: idioma },
      components: parametros.length
        ? [{ type: 'body', parameters: parametros.map((texto) => ({ type: 'text', text: String(texto) })) }]
        : [],
    },
  };
}

async function enviarPlantillaWhatsApp(numeroDestino, nombrePlantilla, idioma, parametros = []) {
  return mandarAWhatsApp(numeroDestino, armarBodyPlantilla(nombrePlantilla, idioma, parametros));
}

// ------------------------------------------------------------
// Avisos al DUENO (tickets, pedidos, etc)
// ------------------------------------------------------------
// Un aviso al dueno lo inicia el bot, no es respuesta a algo que el dueno
// acaba de escribir. Si el dueno no le ha escrito al numero del bot en las
// ultimas 24 h, Meta rechaza el texto libre y los botones (codigo 131047,
// "Re-engagement message") y antes eso fallaba EN SILENCIO. Ahora:
//   1. Se intenta primero texto (+ boton con el link, si lo hay).
//   2. Si el texto falla por CUALQUIER motivo, se reintenta UNA vez con la
//      plantilla Utility WHATSAPP_PLANTILLA_AVISO_DUENO -- pero solo si
//      WHATSAPP_PLANTILLA_AVISO_DUENO_APROBADA=true (mismo patron que los
//      motores A y B: un envio real contra una plantilla que Meta no ha
//      aprobado afecta la calidad del numero).
//   3. Nunca lanza excepcion. Regresa {estado, intentoEn, error, via} para
//      que quien llamo lo guarde en su registro (ticket, pedido, etc) y el
//      dashboard pueda marcar los avisos que no llegaron.
//
// estado: 'ENVIADO' | 'FALLIDO' | 'OMITIDO' (no hay OWNER_WHATSAPP_NUMBER;
// no es un error, no se guarda).
// via:    'texto' | 'plantilla' | null.
// error:  null si todo salio bien por texto. Si llego por plantilla, trae el
//         motivo por el que fallo el texto. Si el texto llego pero un boton
//         fallo, estado sigue siendo ENVIADO y aqui va el motivo del boton
//         (no se reenvia por plantilla: el dueno ya recibio el aviso).
//
// Parametros:
//   tipo         etiqueta corta del aviso ("ticket", "pedido", "CANCELACION"...).
//                Va tal cual en el boton y en {{1}} de la plantilla.
//   resumen      el texto del aviso.
//   link         (opcional) link principal; va como boton y como {{3}}.
//   textoBoton   (opcional) texto del boton del link. Default "Ver detalle".
//   botonesExtra (opcional) [{texto, url}] botones adicionales -- solo se
//                mandan por la via libre (un boton por mensaje, ver arriba).
//   referenciaId id del ticket/pedido/etc, para el log.
//
// La plantilla (ver README_INSTALACION.md) lleva 3 variables:
//   {{1}} tipo, {{2}} resumen, {{3}} link.
const CODIGO_META_FUERA_DE_VENTANA = 131047;
const MAX_CARACTERES_RESUMEN_PLANTILLA = 200;

// Meta rechaza parametros de plantilla con saltos de linea, tabs o mas de 4
// espacios seguidos. Todo se junta en una sola linea, separado por " | ".
function aUnaLinea(texto) {
  return String(texto ?? '')
    .split(/[\r\n\t]+/)
    .map((parte) => parte.trim())
    .filter(Boolean)
    .join(' | ')
    .replace(/ {2,}/g, ' ')
    .trim();
}

// Recorta a "max" caracteres (contando el "…" final) sin dejar un link a
// medias: si el corte cae dentro de una URL, esa URL se quita completa.
function truncarSinCortarLinks(texto, max) {
  if (texto.length <= max) return texto;

  let corte = texto.slice(0, max - 1);
  const urlPartida = /https?:\/\/\S*$/i.exec(corte);
  if (urlPartida && !/\s/.test(texto.charAt(max - 1))) {
    corte = corte.slice(0, urlPartida.index);
  }
  return `${corte.trimEnd()}…`;
}

function describirError(resultado) {
  const codigo = resultado.codigo ?? resultado.status ?? 'sin codigo';
  return `${codigo}: ${resultado.mensaje || 'sin detalle'}`.slice(0, 300);
}

// Convierte una excepcion de red en el mismo formato que un rechazo de Meta,
// para que avisarAlDueno la trate igual (y nunca truene).
async function intentarEnvio(numeroDestino, body) {
  try {
    return await mandarAWhatsAppDetallado(numeroDestino, body);
  } catch (error) {
    console.error('Error de red al enviar mensaje de WhatsApp:', error.message);
    return { ok: false, status: null, codigo: null, mensaje: `red: ${error.message}` };
  }
}

async function avisarAlDueno({ tipo, resumen, link, textoBoton, botonesExtra = [], referenciaId }) {
  const intentoEn = new Date().toISOString();
  const numeroDueno = process.env.OWNER_WHATSAPP_NUMBER;

  // Sin numero configurado no hay a quien avisar (igual que antes): no es un
  // fallo, y no se guarda nada.
  if (!numeroDueno) return { estado: 'OMITIDO', intentoEn, error: null, via: null };

  const etiqueta = `tipo=${tipo} ref=${referenciaId ?? '-'}`;
  const tipoLegible = aUnaLinea(tipo) || 'aviso';
  const cuerpoBoton = `${tipoLegible.charAt(0).toUpperCase()}${tipoLegible.slice(1)}${referenciaId ? ` ${referenciaId}` : ''}`;

  // 1. Via libre: texto y luego botones.
  const resultadoTexto = await intentarEnvio(numeroDueno, armarBodyTexto(resumen));

  if (resultadoTexto.ok) {
    const botones = [...(link ? [{ texto: textoBoton || 'Ver detalle', url: link }] : []), ...botonesExtra];
    let errorBoton = null;

    for (const boton of botones) {
      const resultadoBoton = await intentarEnvio(numeroDueno, armarBodyBotonConLink(cuerpoBoton, boton.texto, boton.url));
      if (!resultadoBoton.ok && !errorBoton) errorBoton = `boton "${boton.texto}": ${describirError(resultadoBoton)}`;
    }

    if (errorBoton) {
      console.warn(`AVISO_DUENO (${etiqueta}): el texto llego pero fallo un boton -- ${errorBoton}`);
    }
    return { estado: 'ENVIADO', intentoEn, error: errorBoton, via: 'texto' };
  }

  // 2. Via plantilla.
  const motivoTexto = describirError(resultadoTexto);
  const fueraDeVentana = resultadoTexto.codigo === CODIGO_META_FUERA_DE_VENTANA;
  const contexto = fueraDeVentana ? `fuera de la ventana de 24 h (${motivoTexto})` : motivoTexto;

  const nombrePlantilla = process.env.WHATSAPP_PLANTILLA_AVISO_DUENO;
  const fallar = (razon) => {
    const error = `texto: ${motivoTexto}; ${razon}`.slice(0, 500);
    console.error(`AVISO_DUENO (${etiqueta}): no se le pudo avisar al dueño -- ${error}`);
    return { estado: 'FALLIDO', intentoEn, error, via: null };
  };

  if (!nombrePlantilla) {
    return fallar('sin plantilla de respaldo (falta WHATSAPP_PLANTILLA_AVISO_DUENO en el .env)');
  }
  if (process.env.WHATSAPP_PLANTILLA_AVISO_DUENO_APROBADA !== 'true') {
    return fallar(
      `plantilla "${nombrePlantilla}" sin aprobar (WHATSAPP_PLANTILLA_AVISO_DUENO_APROBADA no esta en "true"; ` +
      `no se intenta mandar hasta que confirmes en Meta que quedo "Approved")`
    );
  }

  const idioma = process.env.WHATSAPP_IDIOMA_PLANTILLA || 'es_MX';
  const parametros = [
    tipoLegible,
    truncarSinCortarLinks(aUnaLinea(resumen), MAX_CARACTERES_RESUMEN_PLANTILLA) || '—',
    aUnaLinea(link) || '—', // el link nunca se recorta: va completo en {{3}}
  ];
  const resultadoPlantilla = await intentarEnvio(numeroDueno, armarBodyPlantilla(nombrePlantilla, idioma, parametros));

  if (resultadoPlantilla.ok) {
    console.warn(`AVISO_DUENO (${etiqueta}): el texto libre fallo, ${contexto}; se mando por plantilla "${nombrePlantilla}".`);
    return { estado: 'ENVIADO', intentoEn, error: `texto libre fallo: ${motivoTexto}`.slice(0, 500), via: 'plantilla' };
  }

  return fallar(`plantilla "${nombrePlantilla}" tambien fallo: ${describirError(resultadoPlantilla)}`);
}

module.exports = {
  enviarMensajeWhatsApp,
  enviarBotonConLinkWhatsApp,
  enviarPlantillaWhatsApp,
  avisarAlDueno,
  // Exportadas solo para probarlas por separado (ver test/avisoDueno.test.js).
  aUnaLinea,
  truncarSinCortarLinks,
};
