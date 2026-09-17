// ============================================================
// recordatorios.js  (Motor A: recordatorios de anticipación)
// ------------------------------------------------------------
// Modulo OPCIONAL (activar con ACTIVAR_RECORDATORIOS_EVENTO=true en el
// .env) para reducir inasistencias: manda recordatorios de WhatsApp antes de
// cada evento agendado (PENDIENTE o CONFIRMADA) que tenga fecha/hora real.
//
// SOLO tiene sentido activarlo si el giro tiene eventos con horario REAL
// (evitar empalmes, horario de atencion por dia) -- ver la nota de Motor A
// en el CLAUDE.md general. Un evento sin "fecha"/"hora" (ej. un pedido de
// cafeteria que se recoge "en un rato") simplemente nunca le toca ningun
// recordatorio, sin que haya que configurar nada distinto.
//
// Las ventanas de anticipacion son CONFIGURABLES por giro -- no se asume
// 24h/2h como en salones-belleza. Se leen de RECORDATORIO_EVENTO_VENTANAS_MIN
// en el .env, una lista de minutos separados por coma, ej:
//   RECORDATORIO_EVENTO_VENTANAS_MIN=1440,120        (24h y 2h antes)
//   RECORDATORIO_EVENTO_VENTANAS_MIN=180,30           (3h y 30min antes)
// El ORDEN no importa al escribirlas (se ordenan de mayor a menor solas),
// pero la POSICION que les toca despues de ordenar si importa: a la ventana
// mas lejana le toca la plantilla WHATSAPP_PLANTILLA_RECORDATORIO_1, a la
// siguiente WHATSAPP_PLANTILLA_RECORDATORIO_2, etc. (misma idea que
// WHATSAPP_PLANTILLA_RECORDATORIO_24H/_2H en salones-belleza, generalizada a
// N ventanas). Cada una necesita ademas su bandera
// WHATSAPP_PLANTILLA_RECORDATORIO_<N>_APROBADA=true (ver nombrePlantillaLista
// mas abajo) -- una persona la prende a mano cuando confirma en Meta que esa
// plantilla ya quedo "Approved".
//
// Tambien vive aqui la interpretacion de la respuesta del cliente
// ("confirmo"/"cancelar") -- el index.js del giro la llama como una regla
// fija ANTES de preguntarle a la IA, con el mismo criterio que el filtro de
// seguridad (ver seguridad.js): cambiar el estado real de un evento no se le
// puede dejar a como la IA interprete el mensaje ese dia.
//
// procesarRecordatorios(gestorEventos) se llama desde programador.js cada N
// minutos -- ver ese archivo para el mecanismo anti doble-envio (se marca
// "ENVIANDO" antes de mandar el WhatsApp, y cada aviso se intenta como
// MAXIMO una vez; ver tambien actualizarSeguimiento en eventoProgramado.js).
//
// "gestorEventos" es el objeto que regresa crearGestorDeEventos() en
// eventoProgramado.js -- se recibe como parametro (en vez de importar un
// archivo fijo) para que este motor pueda operar sobre CUALQUIER tipo de
// evento del giro (citas, clases, reservas...) sin acoplarse a uno solo, y
// para poder probarlo con un gestor de prueba sin tocar archivos reales.
// ============================================================

const { minutosHastaEvento, formatearFechaCorta } = require('./eventoProgramado');
const { enviarPlantillaWhatsApp } = require('./whatsapp');

// Un aviso colgado en "ENVIANDO" por mas de esto se asume que el proceso se
// murio a medio envio (crash/redeploy del hosting) -- se resuelve a FALLIDO
// sin reintentar. Nunca se vuelve a intentar mandar ese mismo aviso solo:
// preferimos arriesgar un recordatorio de menos (siempre queda logueado) que
// mandar el mismo dos veces.
const MINUTOS_ENVIANDO_COLGADO = 20;

// Solo tiene sentido recordarle un evento al cliente si todavia sigue en pie.
const ESTADOS_ELEGIBLES = ['PENDIENTE', 'CONFIRMADA'];

function activo() {
  return process.env.ACTIVAR_RECORDATORIOS_EVENTO === 'true';
}

// Lee y normaliza RECORDATORIO_EVENTO_VENTANAS_MIN: minutos enteros
// positivos, sin duplicados, ordenados de mayor a menor (el primero de la
// lista es siempre la ventana mas lejana al evento -> recordatorio1).
function obtenerVentanasMin() {
  const crudo = process.env.RECORDATORIO_EVENTO_VENTANAS_MIN || '';
  const minutos = crudo
    .split(',')
    .map((texto) => parseInt(texto.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  return [...new Set(minutos)].sort((a, b) => b - a);
}

function claveVentana(indice) {
  return `recordatorio${indice + 1}`;
}

function estaColgado(seguimientoDeTipo) {
  if (seguimientoDeTipo.estado !== 'ENVIANDO') return false;
  const minutosDesdeElIntento = (Date.now() - new Date(seguimientoDeTipo.intentoEn).getTime()) / 60000;
  return minutosDesdeElIntento > MINUTOS_ENVIANDO_COLGADO;
}

// true si a este evento le toca ESTA ventana de recordatorio ahora mismo:
// tiene fecha/hora real, nunca se ha intentado (o se quedo colgado en
// ENVIANDO, ver arriba) y falta un tiempo dentro de (ventanaMinMin,
// ventanaMaxMin] -- ej. con ventanas [1440, 120] la de 1440 cubre (120,
// 1440] y la de 120 cubre (0, 120]. El piso "ventanaMinMin" evita que un
// evento agendado con MENOS anticipacion que la ventana mas lejana dispare
// dos recordatorios casi juntos en la misma corrida -- solo le toca el mas
// cercano al momento del evento.
function leTocaVentana(evento, tipo, ventanaMaxMin, ventanaMinMin) {
  if (!evento.fecha || !evento.hora) return false;
  if (!ESTADOS_ELEGIBLES.includes(evento.estado)) return false;

  const seguimiento = evento.seguimiento?.[tipo];
  if (seguimiento) {
    if (seguimiento.estado === 'ENVIADO' || seguimiento.estado === 'FALLIDO') return false;
    if (seguimiento.estado === 'ENVIANDO' && !estaColgado(seguimiento)) return false;
  }

  const faltan = minutosHastaEvento(evento.fecha, evento.hora);
  return faltan > ventanaMinMin && faltan <= ventanaMaxMin;
}

function armarParametros(evento) {
  return [evento.nombreCliente || 'cliente', evento.descripcion, formatearFechaCorta(evento.fecha), evento.hora];
}

// Intenta mandar UN recordatorio puntual de UN evento. Marca ENVIANDO antes
// de llamar a WhatsApp (bloqueante, queda escrito en disco antes del envio
// real -- ver actualizarSeguimiento en eventoProgramado.js) y
// ENVIADO/FALLIDO justo despues, sin reintentar.
async function intentarRecordatorio(gestorEventos, evento, tipo, nombrePlantilla) {
  gestorEventos.actualizarSeguimiento(evento.id, tipo, 'ENVIANDO');

  try {
    const idioma = process.env.WHATSAPP_IDIOMA_PLANTILLA || 'es_MX';
    const ok = await enviarPlantillaWhatsApp(evento.cliente, nombrePlantilla, idioma, armarParametros(evento));
    gestorEventos.actualizarSeguimiento(evento.id, tipo, ok ? 'ENVIADO' : 'FALLIDO');
    if (!ok) {
      console.error(
        `RECORDATORIOS: fallo el envio de "${tipo}" para el evento ${evento.id} ` +
        `(el proveedor de WhatsApp rechazo la plantilla "${nombrePlantilla}", o el numero no es valido). No se reintenta solo.`
      );
    }
  } catch (error) {
    gestorEventos.actualizarSeguimiento(evento.id, tipo, 'FALLIDO');
    console.error(`RECORDATORIOS: error inesperado mandando "${tipo}" para el evento ${evento.id}:`, error.message);
  }
}

// Da el nombre de una plantilla SOLO si esta configurada Y su bandera
// "..._APROBADA" esta explicitamente en "true". Sin las dos cosas, regresa
// null -- y con null, procesarRecordatorios ni siquiera llama a
// enviarPlantillaWhatsApp. Esto es a proposito MAS estricto que "dejar que
// el proveedor lo rechace y loguear el error": un envio real rechazado por
// Meta (plantilla inexistente o no aprobada) cuenta en contra de la calidad
// del numero de WhatsApp Business. La bandera "..._APROBADA" la prende una
// persona, nunca el codigo solo.
function nombrePlantillaLista(nombreVar, aprobadaVar) {
  const nombre = process.env[nombreVar];
  const aprobada = process.env[aprobadaVar] === 'true';
  if (!nombre) return null;
  if (!aprobada) {
    console.warn(
      `RECORDATORIOS: ${nombreVar}="${nombre}" esta configurada, pero ${aprobadaVar} no esta en "true" -- ` +
      `no se intenta mandar hasta que confirmes que la plantilla quedo aprobada y pongas ${aprobadaVar}=true.`
    );
    return null;
  }
  return nombre;
}

// Revisa TODOS los eventos y manda los recordatorios que les toquen ahora.
// Se procesan uno por uno (no en paralelo) a proposito, para no complicar el
// mecanismo anti doble-envio con corridas simultaneas sobre el mismo evento.
async function procesarRecordatorios(gestorEventos) {
  if (!activo()) return;

  const ventanas = obtenerVentanasMin();
  if (!ventanas.length) {
    console.warn(
      'RECORDATORIOS: ACTIVAR_RECORDATORIOS_EVENTO=true pero RECORDATORIO_EVENTO_VENTANAS_MIN ' +
      'esta vacia o mal escrita (debe ser minutos separados por coma, ej. "1440,120") -- no se manda nada.'
    );
    return;
  }

  const plantillasPorVentana = ventanas.map((_, indice) =>
    nombrePlantillaLista(`WHATSAPP_PLANTILLA_RECORDATORIO_${indice + 1}`, `WHATSAPP_PLANTILLA_RECORDATORIO_${indice + 1}_APROBADA`)
  );

  if (plantillasPorVentana.every((p) => !p)) {
    console.warn(
      `RECORDATORIOS: ninguna de las ${ventanas.length} plantilla(s) esperadas ` +
      `(WHATSAPP_PLANTILLA_RECORDATORIO_1..${ventanas.length}) esta lista -- no se manda nada.`
    );
    return;
  }

  for (const evento of gestorEventos.obtenerEventos()) {
    for (let i = 0; i < ventanas.length; i++) {
      const plantilla = plantillasPorVentana[i];
      if (!plantilla) continue;

      const ventanaMaxMin = ventanas[i];
      const ventanaMinMin = i + 1 < ventanas.length ? ventanas[i + 1] : 0;
      const tipo = claveVentana(i);

      if (leTocaVentana(evento, tipo, ventanaMaxMin, ventanaMinMin)) {
        await intentarRecordatorio(gestorEventos, evento, tipo, plantilla);
      }
    }
  }
}

// Quita acentos y pasa a minusculas, para que "Confirmo", "CONFIRMO" y
// "confírmo" (con o sin acento) se detecten igual.
function normalizarTexto(texto) {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

// Palabras/raices que indican que el cliente quiere CAMBIAR su evento (no
// confirmarlo ni cancelarlo). Dos niveles: las raices "fuertes" (reagendar,
// posponer, aplazar) son señal suficiente por si solas; "mover"/"cambia" son
// verbos mas genericos que solo cuentan si ademas aparece una palabra de
// contexto (hora/dia/fecha/cita/clase/reserva) -- si no, "cambia" solo daria
// falsos positivos con mensajes sin relacion (ej. "cambie de opinion").
const REAGENDAR_RAICES_FUERTES = ['reagend', 'pospon', 'aplaz'];
const REAGENDAR_VERBOS_DEBILES = ['mover', 'cambia'];
const REAGENDAR_CONTEXTO = ['cita', 'clase', 'reserva', 'hora', 'dia', 'fecha'];

function mencionaReagendar(normalizado) {
  if (REAGENDAR_RAICES_FUERTES.some((raiz) => normalizado.includes(raiz))) return true;
  const tieneVerboDebil = REAGENDAR_VERBOS_DEBILES.some((v) => normalizado.includes(v));
  const tieneContexto = REAGENDAR_CONTEXTO.some((c) => normalizado.includes(c));
  return tieneVerboDebil && tieneContexto;
}

// true para mensajes que no traen ningun contenido reconocible como
// respuesta real: vacios, solo emoji/puntuacion (sin ninguna letra ni
// numero), o una de las muletillas cortas de "recibido" mas comunes. A
// proposito NO intenta adivinar si es una pregunta de verdad (esas SI deben
// caer al flujo normal de la IA) -- por eso exige que el mensaje completo
// normalizado sea EXACTAMENTE una de estas palabras sueltas.
const RESPUESTAS_SIN_CONTENIDO = ['ok', 'okay', 'oka', 'vale', 'va', 'si', 'no', 'gracias', 'ya', 'listo', 'entendido'];

function pareceRespuestaSinContenido(texto) {
  const limpio = texto.trim();
  if (limpio.length === 0) return true;
  if (!/[a-zA-Z0-9áéíóúñÁÉÍÓÚÑ]/.test(limpio)) return true; // solo emoji/puntuacion/espacios
  return RESPUESTAS_SIN_CONTENIDO.includes(normalizarTexto(limpio));
}

// true si a este evento ya se le mando la ULTIMA ventana de recordatorio
// configurada (la mas cercana al evento) y el cliente todavia no ha
// respondido "confirmo" ni "cancelar" (y el evento sigue vigente, no
// cancelado/completado/no-show). Se usa tanto para decidir si un mensaje sin
// contenido reconocible amerita repetirle la opcion de responder, como para
// el badge "Sin respuesta" que puede mostrar el dashboard de cada giro.
function eventoEsperaRespuestaDelCliente(evento) {
  const ventanas = obtenerVentanasMin();
  if (!ventanas.length) return false;

  const claveUltima = claveVentana(ventanas.length - 1);
  return (
    evento.seguimiento?.[claveUltima]?.estado === 'ENVIADO' &&
    !evento.respuestaCliente &&
    !['CANCELADA', 'COMPLETADA', 'NO_SHOW'].includes(evento.estado)
  );
}

// El evento (si hay EXACTAMENTE uno) que este cliente todavia puede
// confirmar/cancelar/reagendar: sigue PENDIENTE o CONFIRMADA y su fecha/hora
// no ha pasado. Si el cliente tiene 0 o 2+ eventos en ese estado, regresa
// null -- no se adivina a cual se refiere.
function obtenerEventoAccionableUnico(gestorEventos, numeroCliente) {
  const accionables = gestorEventos.obtenerEventos().filter(
    (e) =>
      e.cliente === numeroCliente &&
      ESTADOS_ELEGIBLES.includes(e.estado) &&
      e.fecha && e.hora &&
      minutosHastaEvento(e.fecha, e.hora) > 0
  );
  return accionables.length === 1 ? accionables[0] : null;
}

// Interpreta la respuesta de un cliente a un recordatorio de evento. Regresa
// null si no aplica ninguna regla fija (el mensaje sigue el flujo normal de
// la IA, sin tocar nada del evento), o { evento, intencion } donde
// "intencion" es una de:
//   - 'CONFIRMADA' / 'CANCELADA': mensaje claro, YA se aplico en
//     eventoProgramado.js (registrarRespuestaCliente). El index.js del giro
//     solo tiene que avisar al cliente (y al dueno si cancelo).
//   - 'AMBIGUA': el mensaje menciona CONFIRMAR y CANCELAR a la vez -- a
//     proposito NO se toca el estado del evento.
//   - 'REAGENDAR': el cliente quiere cambiar fecha/hora. No hay flujo
//     automatico de reagendado, asi que esto no toca el evento -- el
//     index.js del giro le contesta y crea un ticket para que el dueno lo
//     reagende a mano.
//   - 'SIN_RESPUESTA_CLARA': el cliente SI tiene la ultima ventana de
//     recordatorio ya mandada y sin respuesta, pero mando algo sin contenido
//     reconocible -- se le repite la opcion de responder CONFIRMO/CANCELAR.
//
// No depende de que el recordatorio automatico ya se haya mandado para
// CONFIRMADA/CANCELADA/REAGENDAR: un cliente puede escribir "cancelar" o
// "quiero cambiar mi cita" por su cuenta en cualquier momento.
function interpretarRespuestaCliente(gestorEventos, numeroCliente, texto) {
  if (!activo()) return null;

  const evento = obtenerEventoAccionableUnico(gestorEventos, numeroCliente);
  if (!evento) return null;

  const normalizado = normalizarTexto(texto);
  const mencionaConfirmar = normalizado.includes('confirm');
  const mencionaCancelar = normalizado.includes('cancel');

  if (mencionaConfirmar && mencionaCancelar) {
    return { evento, intencion: 'AMBIGUA' };
  }
  if (mencionaConfirmar) {
    gestorEventos.registrarRespuestaCliente(evento.id, 'CONFIRMADA');
    return { evento, intencion: 'CONFIRMADA' };
  }
  if (mencionaCancelar) {
    gestorEventos.registrarRespuestaCliente(evento.id, 'CANCELADA');
    return { evento, intencion: 'CANCELADA' };
  }
  if (mencionaReagendar(normalizado)) {
    return { evento, intencion: 'REAGENDAR' };
  }
  if (eventoEsperaRespuestaDelCliente(evento) && pareceRespuestaSinContenido(texto)) {
    return { evento, intencion: 'SIN_RESPUESTA_CLARA' };
  }
  return null;
}

// El evento (si hay uno solo) que este cliente todavia no responde despues
// de su ultima ventana de recordatorio -- lo usa el index.js del giro para,
// cuando el cliente manda un tipo de mensaje que el bot no puede leer
// (audio, foto, etc.), agregarle a la respuesta generica un recordatorio
// especifico de "responde CONFIRMO o CANCELAR por texto".
function obtenerEventoEsperandoRespuesta(gestorEventos, numeroCliente) {
  if (!activo()) return null;
  const evento = obtenerEventoAccionableUnico(gestorEventos, numeroCliente);
  return evento && eventoEsperaRespuestaDelCliente(evento) ? evento : null;
}

module.exports = {
  activo,
  obtenerVentanasMin,
  procesarRecordatorios,
  interpretarRespuestaCliente,
  obtenerEventoEsperandoRespuesta,
  eventoEsperaRespuestaDelCliente,
};
