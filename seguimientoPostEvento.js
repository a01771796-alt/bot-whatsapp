// ============================================================
// seguimientoPostEvento.js  (Motor B: solicitud de reseña post-evento)
// ------------------------------------------------------------
// Modulo OPCIONAL (activar con ACTIVAR_SOLICITUD_RESENA=true en el .env)
// que, un rato despues de que el dueno marca un evento como COMPLETADA (ej.
// boton "Marcar como completada"/"Marcar como entregado" en el dashboard del
// giro), le manda al cliente una plantilla de WhatsApp pidiendole una reseña
// en Google, con el link configurado en el Sheet del negocio.
//
// A DIFERENCIA de Motor A (recordatorios.js), este motor NO depende de que
// el evento tenga fecha/hora -- solo depende de que exista un estado
// COMPLETADA con "completadaEn" (timestamp). Por eso funciona igual sobre
// una cita, una clase, o un pedido de cafeteria entregado: puede activarse
// SOLO, sin que Motor A este activo, para negocios sin agenda real.
//
// Nunca se manda si el evento se cancelo o el cliente no se presento
// (estados CANCELADA/NO_SHOW) -- solo aplica a eventos en estado COMPLETADA.
//
// procesarSolicitudesDeResena(gestorEventos, obtenerInfoNegocioCsv) se llama
// desde programador.js cada N minutos -- ver ese archivo para el mecanismo
// anti doble-envio (se marca "ENVIANDO" antes de mandar el WhatsApp, y cada
// aviso se intenta como MAXIMO una vez; ver tambien actualizarSeguimiento en
// eventoProgramado.js).
//
// "gestorEventos" es el objeto que regresa crearGestorDeEventos() en
// eventoProgramado.js (ver el comentario equivalente en recordatorios.js).
// "obtenerInfoNegocioCsv" es una funcion async que regresa el texto CSV
// crudo de la pestaña "Información del negocio" del Sheet del giro -- se
// recibe como parametro en vez de asumir una URL fija en env, porque cada
// giro decide como esta organizado su Sheet (una pestaña aparte como en
// salones-belleza, o la misma que ya usa el chat).
// ============================================================

const fs = require('fs');
const { parseCsv } = require('./csv');
const { enviarPlantillaWhatsApp, avisarAlDueno } = require('./whatsapp');
const { rutaArchivoDatos, escribirArchivoDatos } = require('./almacenamiento');

// Igual que en recordatorios.js: un aviso colgado en "ENVIANDO" por mas de
// esto se asume que el proceso se murio a medio envio -- se resuelve a
// FALLIDO sin reintentar, nunca se vuelve a intentar solo.
const MINUTOS_ENVIANDO_COLGADO = 20;

const TIPO_SEGUIMIENTO = 'resena';

// Un evento completado hace mas que esto ya no se pide reseña: pedirla dias
// despues se siente fuera de lugar, y al corregir el link del Sheet no se
// mandan de golpe todas las solicitudes atrasadas.
const HORAS_MAXIMAS_DESDE_COMPLETADA = 48;

// Solo se acepta un link de Google (cualquier otro sitio no sirve para pedir
// una reseña de Google). Vale el dominio y sus subdominios.
const DOMINIOS_GOOGLE = ['google.com', 'google.com.mx', 'g.page', 'g.co', 'goo.gl', 'maps.app.goo.gl', 'share.google'];

function activo() {
  return process.env.ACTIVAR_SOLICITUD_RESENA === 'true';
}

// 2 horas por default (mismo default que salones-belleza) si la variable no
// esta configurada o trae un valor invalido.
function horasDeEspera() {
  const horas = Number(process.env.RESENA_ESPERA_HORAS);
  return Number.isFinite(horas) && horas > 0 ? horas : 2;
}

function esLinkDeGoogle(texto) {
  let url;
  try {
    url = new URL((texto || '').trim());
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  return DOMINIOS_GOOGLE.some((dominio) => url.hostname === dominio || url.hostname.endsWith(`.${dominio}`));
}

// Lee el link de reseña de Google desde el CSV de informacion del negocio.
// Soporta las DOS convenciones de Sheet que ya usan los giros existentes:
//   - Una sola celda de texto libre: "Link de reseña Google: https://..."
//     (formato de salones-belleza, pestaña "Información del negocio").
//   - Dos columnas "Campo,Valor": una fila con "Link de reseña Google" en la
//     primera columna y la URL en la segunda (formato "Campo,Valor" que ya
//     usan gimnasios/cafeteria para su hoja de informacion del negocio).
// Acepta con o sin acento y valida que de verdad sea un link de Google
// (esLinkDeGoogle) -- si el dueno todavia no llena esa fila, la escribe mal o
// pone un link que no es de Google, se trata igual que si no existiera (no se manda nada, se loguea, no se rompe nada). Exportada
// aparte para poder probarla sin tocar red.
function extraerLinkResena(csvInfo) {
  const filas = parseCsv(csvInfo || '');
  const esUrl = esLinkDeGoogle;

  for (const fila of filas) {
    const primeraColumna = (fila[0] || '').trim();

    const m = /^Link de rese[ñn]a Google:\s*(.+)$/i.exec(primeraColumna);
    if (m && esUrl(m[1])) return m[1].trim();

    if (/^Link de rese[ñn]a Google$/i.test(primeraColumna) && esUrl(fila[1])) {
      return fila[1].trim();
    }
  }

  return '';
}

function estaColgado(seguimientoDeTipo) {
  if (seguimientoDeTipo.estado !== 'ENVIANDO') return false;
  const minutosDesdeElIntento = (Date.now() - new Date(seguimientoDeTipo.intentoEn).getTime()) / 60000;
  return minutosDesdeElIntento > MINUTOS_ENVIANDO_COLGADO;
}

// true si a este evento le toca la solicitud de reseña ahora mismo: esta
// COMPLETADA, ya paso el tiempo de espera configurado desde que se completo,
// y nunca se ha intentado mandar (o se quedo colgada en ENVIANDO).
function leTocaSolicitarResena(evento) {
  if (evento.estado !== 'COMPLETADA' || !evento.completadaEn) return false;

  const seguimiento = evento.seguimiento?.[TIPO_SEGUIMIENTO];
  if (seguimiento) {
    if (seguimiento.estado === 'ENVIADO' || seguimiento.estado === 'FALLIDO') return false;
    if (seguimiento.estado === 'ENVIANDO' && !estaColgado(seguimiento)) return false;
  }

  const minutosDesdeCompletada = (Date.now() - new Date(evento.completadaEn).getTime()) / 60000;
  if (minutosDesdeCompletada > HORAS_MAXIMAS_DESDE_COMPLETADA * 60) return false;
  return minutosDesdeCompletada >= horasDeEspera() * 60;
}

// Intenta mandar UNA solicitud de reseña. Marca ENVIANDO antes de llamar a
// WhatsApp (bloqueante, queda escrito en disco antes del envio real) y
// ENVIADO/FALLIDO justo despues, sin reintentar.
async function intentarSolicitudResena(gestorEventos, evento, linkResena, nombrePlantilla) {
  gestorEventos.actualizarSeguimiento(evento.id, TIPO_SEGUIMIENTO, 'ENVIANDO');

  try {
    const idioma = process.env.WHATSAPP_IDIOMA_PLANTILLA || 'es_MX';
    const parametros = [evento.nombreCliente || 'cliente', process.env.NOMBRE_NEGOCIO || 'nuestro negocio', linkResena];
    const ok = await enviarPlantillaWhatsApp(evento.cliente, nombrePlantilla, idioma, parametros);
    gestorEventos.actualizarSeguimiento(evento.id, TIPO_SEGUIMIENTO, ok ? 'ENVIADO' : 'FALLIDO');
    if (!ok) {
      console.error(
        `RESEÑAS: fallo el envio de la solicitud para el evento ${evento.id} ` +
        `(el proveedor de WhatsApp rechazo la plantilla "${nombrePlantilla}", o el numero no es valido). No se reintenta solo.`
      );
    }
  } catch (error) {
    gestorEventos.actualizarSeguimiento(evento.id, TIPO_SEGUIMIENTO, 'FALLIDO');
    console.error(`RESEÑAS: error inesperado mandando la solicitud para el evento ${evento.id}:`, error.message);
  }
}

// Aviso de configuracion al dueno: se manda UNA sola vez mientras el link siga
// mal (la marca queda en disco, un reinicio no lo repite). Cuando el link
// vuelve a ser valido se borra la marca, para avisar de nuevo si se rompe otra
// vez. Un aviso 'OMITIDO' (sin OWNER_WHATSAPP_NUMBER) no cuenta como avisado.
const CLAVE_AVISO_LINK = 'linkResena';

function leerAvisosConfig() {
  try {
    return JSON.parse(fs.readFileSync(rutaArchivoDatos('avisosConfig.json'), 'utf8'));
  } catch {
    return {};
  }
}

function guardarAvisosConfig(marcas) {
  escribirArchivoDatos(rutaArchivoDatos('avisosConfig.json'), JSON.stringify(marcas, null, 2));
}

async function avisarLinkResenaInvalido(cantidadEsperando) {
  const marcas = leerAvisosConfig();
  if (marcas[CLAVE_AVISO_LINK]) return;

  const resultado = await avisarAlDueno({
    tipo: 'CONFIG',
    resumen:
      'Falta o está mal el link de reseña de Google en la información del negocio (fila "Link de reseña Google"; ' +
      `debe ser de google.com, google.com.mx, g.page, g.co, goo.gl, maps.app.goo.gl o share.google). ${cantidadEsperando} cliente(s) esperando su solicitud de reseña.`,
    referenciaId: 'RESENA',
  });
  if (resultado.estado === 'OMITIDO') return;

  marcas[CLAVE_AVISO_LINK] = { avisadoEn: resultado.intentoEn, estado: resultado.estado };
  guardarAvisosConfig(marcas);
}

function limpiarAvisoLinkResena() {
  const marcas = leerAvisosConfig();
  if (!marcas[CLAVE_AVISO_LINK]) return;
  delete marcas[CLAVE_AVISO_LINK];
  guardarAvisosConfig(marcas);
}

// Revisa TODOS los eventos y manda la solicitud de reseña a los que les
// toque ahora. Se procesan uno por uno (no en paralelo), mismo criterio que
// recordatorios.js.
async function procesarSolicitudesDeResena(gestorEventos, obtenerInfoNegocioCsv) {
  if (!activo()) return;

  const nombrePlantilla = process.env.WHATSAPP_PLANTILLA_RESENA;
  if (!nombrePlantilla) {
    console.warn('RESEÑAS: ACTIVAR_SOLICITUD_RESENA=true pero falta WHATSAPP_PLANTILLA_RESENA en el .env -- no se manda nada.');
    return;
  }

  if (process.env.WHATSAPP_PLANTILLA_RESENA_APROBADA !== 'true') {
    console.warn(
      `RESEÑAS: WHATSAPP_PLANTILLA_RESENA="${nombrePlantilla}" esta configurada, pero ` +
      `WHATSAPP_PLANTILLA_RESENA_APROBADA no esta en "true" -- no se intenta mandar hasta que confirmes que la ` +
      `plantilla quedo aprobada y pongas WHATSAPP_PLANTILLA_RESENA_APROBADA=true.`
    );
    return;
  }

  const eventosElegibles = gestorEventos.obtenerEventos().filter(leTocaSolicitarResena);
  if (!eventosElegibles.length) return;

  const linkResena = extraerLinkResena(await obtenerInfoNegocioCsv());
  if (!linkResena) {
    console.warn(
      `RESEÑAS: falta (o esta mal escrita) la fila "Link de reseña Google: https://..." en la informacion del ` +
      `negocio -- ${eventosElegibles.length} evento(s) esperando, no se manda nada hasta que se llene.`
    );
    await avisarLinkResenaInvalido(eventosElegibles.length);
    return;
  }
  limpiarAvisoLinkResena();

  for (const evento of eventosElegibles) {
    await intentarSolicitudResena(gestorEventos, evento, linkResena, nombrePlantilla);
  }
}

module.exports = { activo, procesarSolicitudesDeResena, extraerLinkResena, esLinkDeGoogle, leTocaSolicitarResena };
