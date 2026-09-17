// ============================================================
// index.js
// ------------------------------------------------------------
// SERVIDOR PRINCIPAL del bot de WhatsApp para cafeterias/restaurantes.
//
// Que hace, en resumen:
// 1. Recibe cada mensaje que le escriben al numero de WhatsApp del negocio.
// 2. Filtra mensajes repetidos, abuso, y tipos que no puede leer (fotos, audios, etc).
// 3. Revisa primero la red de seguridad (amenazas / contenido grave).
// 4. Lee el menu/horario/FAQ y los "casos aprendidos" desde Google Sheets.
// 5. Le pide a la IA (Claude) que decida la respuesta.
// 6. Manda esa respuesta por WhatsApp y avisa al dueno si aplica.
// 7. Si el bot no supo que contestar, lo deja anotado para revisarlo despues.
//
// No necesitas entender cada linea para operar el negocio: con seguir
// README_INSTALACION.md es suficiente.
// ============================================================

require('dotenv').config();
const express = require('express');
const { obtenerContextoDelNegocio } = require('./menu');
const { preguntarAClaude } = require('./claude');
const { enviarMensajeWhatsApp } = require('./whatsapp');
const { gestor: gestorPedidos, guardarPedido, avisarAlDuenio } = require('./orders');
const { crearProgramador } = require('./programador');
const { contieneContenidoGrave, RESPUESTA_NEUTRAL_PARA_EL_CLIENTE } = require('./seguridad');
const { obtenerCasosAprendidos, registrarCasoDificil } = require('./aprendizaje');
const { crearTicket, existeTicketAbiertoIgual, obtenerTicketAbiertoPorCliente } = require('./tickets');
const { agregarMensaje, obtenerUltimosMensajes } = require('./conversaciones');
const { router: rutasDashboard, notificarTicketAlDuenio } = require('./dashboard');

// Si algo se nos escapa de todos los try/catch (un error asincrono que no
// esperamos con await, una promesa rechazada sin .catch, etc), Node por
// defecto mata el proceso EN SILENCIO sin imprimir nada util a veces (o
// PowerShell se lleva el mensaje al cerrar la ventana). Estos dos manejadores
// son la ultima red: imprimen el error completo (mensaje + stack) antes de
// que el proceso muera, para poder ver la causa real la proxima vez que pase.
process.on('uncaughtException', (error) => {
  console.error('=== ERROR NO CAPTURADO (uncaughtException) ===');
  console.error(error);
  process.exit(1);
});

process.on('unhandledRejection', (razon) => {
  console.error('=== PROMESA RECHAZADA SIN CAPTURAR (unhandledRejection) ===');
  console.error(razon);
});

const app = express();
app.use(express.json());
app.use(rutasDashboard);

const PUERTO = process.env.PORT || 3000;

const MENSAJE_FALLA_TECNICA =
  'Tuvimos un problema técnico por un momento. Intenta escribir de nuevo en unos minutos, o si es urgente, márcanos por teléfono.';

// --- Memoria en RAM del servidor -----------------------------------------
// OJO: esto se borra si el servidor se reinicia (por ejemplo al hacer un
// deploy nuevo) -- pero a diferencia del historial de conversacion (que
// ahora vive en conversaciones.json, en disco persistente, ver
// conversaciones.js), esto es informacion de corta duracion que no pasa
// nada perderla: en el peor caso, un mensaje viejo se procesa una vez de
// mas, o un limite de flood se resetea antes de tiempo.

// IDs de mensajes ya procesados (Meta a veces reenvia el mismo mensaje si no
// contestamos rapido). Evita que el bot conteste dos veces lo mismo.
const idsMensajesProcesados = new Map();

// Cuenta cuantos mensajes ha mandado cada numero en la ultima ventana de 60
// segundos, para frenar flood/abuso (o un numero que manda spam) sin que se
// dispare el gasto de la API de IA.
const contadorMensajesPorNumero = new Map();
const LIMITE_MENSAJES_POR_MINUTO = 20;

// Limpieza periodica de memoria: quita IDs de mensajes de hace mas de 15
// minutos, para no acumularlos para siempre.
setInterval(() => {
  const ahora = Date.now();
  const QUINCE_MINUTOS = 15 * 60 * 1000;

  for (const [id, marcaDeTiempo] of idsMensajesProcesados) {
    if (ahora - marcaDeTiempo > QUINCE_MINUTOS) idsMensajesProcesados.delete(id);
  }
}, 10 * 60 * 1000); // Se ejecuta cada 10 minutos.

function estaExcedidoDeMensajes(numeroCliente) {
  const ahora = Date.now();
  const UN_MINUTO = 60 * 1000;
  const registro = contadorMensajesPorNumero.get(numeroCliente);

  if (!registro || ahora - registro.inicioVentana > UN_MINUTO) {
    contadorMensajesPorNumero.set(numeroCliente, { cantidad: 1, inicioVentana: ahora });
    return false;
  }

  registro.cantidad += 1;
  return registro.cantidad > LIMITE_MENSAJES_POR_MINUTO;
}

// --- 1. Verificacion del webhook -----------------------------------------
// Meta llama a esta ruta UNA SOLA VEZ, cuando configuras el webhook desde
// el panel de Meta for Developers, para confirmar que el servidor es tuyo.
app.get('/webhook', (req, res) => {
  const modo = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (modo === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log('Webhook verificado correctamente.');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// Mensajes segun el tipo de contenido que el bot todavia no puede "leer".
const RESPUESTAS_POR_TIPO_NO_SOPORTADO = {
  image: 'Por ahora no puedo ver fotos 🙏 ¿me lo describes con palabras?',
  audio: 'Por ahora no puedo escuchar audios 🙏 ¿me lo escribes con palabras?',
  video: 'Por ahora no puedo ver videos 🙏 ¿me lo escribes con palabras?',
  document: 'Por ahora no puedo abrir documentos 🙏 ¿me lo escribes con palabras?',
  sticker: 'Jaja, por ahora solo entiendo texto 🙏 ¿me lo escribes con palabras?',
  location: 'Recibí tu ubicación, pero por ahora solo puedo leer texto. ¿Tienes alguna pregunta que te pueda contestar por escrito?',
  contacts: 'Por ahora no puedo procesar contactos compartidos 🙏 ¿en qué te puedo ayudar por escrito?',
};

// --- 2. Recepcion de mensajes ---------------------------------------------
app.post('/webhook', async (req, res) => {
  // Respondemos 200 de inmediato. Si Meta no recibe un "OK" rapido, vuelve a
  // mandar el mismo mensaje varias veces y el cliente recibiria respuestas duplicadas.
  res.sendStatus(200);

  let numeroCliente; // Se usa tambien en el catch final, por eso se declara aqui afuera.

  try {
    const entry = req.body.entry?.[0];
    const cambio = entry?.changes?.[0]?.value;
    const mensaje = cambio?.messages?.[0];

    if (!mensaje) return; // Puede ser solo una notificacion de "entregado/visto"; se ignora.

    numeroCliente = mensaje.from;
    if (!numeroCliente) return;

    // Evita procesar el mismo mensaje dos veces si Meta lo reenvio.
    if (mensaje.id && idsMensajesProcesados.has(mensaje.id)) return;
    if (mensaje.id) idsMensajesProcesados.set(mensaje.id, Date.now());

    // Frena flood/abuso sin gastar de mas en la IA. No mandamos respuesta para
    // no "alimentar" a quien esta mandando spam.
    if (estaExcedidoDeMensajes(numeroCliente)) {
      console.warn(`Numero ${numeroCliente} excedio el limite de mensajes por minuto, se ignora.`);
      return;
    }

    // Si este cliente ya tiene un ticket sin resolver (PENDIENTE o EN_REVISION),
    // el dueno ya lo esta atendiendo a mano desde el chat del dashboard -- el
    // bot se queda callado con TODO lo que mande el cliente mientras tanto
    // (fotos, audios, texto normal, todo) para no contestar algo que se cruce
    // o contradiga lo que el dueno ya le dijo. Los mensajes se siguen
    // guardando en el historial como siempre, solo que sin respuesta
    // automatica. En cuanto el ticket se marca RESUELTO, esto vuelve a dar
    // "false" solo con que el cliente escriba de nuevo -- no hace falta
    // limpiar ningun estado aparte.
    //
    // La UNICA excepcion es el filtro de seguridad de mas abajo (palabras
    // clave de amenazas/autolesion): eso no es la IA, es una regla fija, y
    // siempre se revisa sin importar si hay ticket abierto o no -- preferimos
    // un aviso de mas a perder una emergencia real (mismo criterio que ya
    // se usa en existeTicketAbiertoIgual, ver tickets.js).
    const ticketAbierto = obtenerTicketAbiertoPorCliente(numeroCliente);

    // Tipos de mensaje que el bot no puede leer (solo entiende texto por ahora).
    if (mensaje.type && mensaje.type !== 'text') {
      agregarMensaje(numeroCliente, 'cliente', `[mensaje de tipo "${mensaje.type}", no soportado]`);
      if (!ticketAbierto) {
        const respuestaTipo = RESPUESTAS_POR_TIPO_NO_SOPORTADO[mensaje.type] ||
          'Por ahora solo puedo leer mensajes de texto 🙏 ¿me lo escribes con palabras?';
        agregarMensaje(numeroCliente, 'bot', respuestaTipo);
        await enviarMensajeWhatsApp(numeroCliente, respuestaTipo);
      }
      return;
    }

    const texto = mensaje.text?.body;
    if (!texto) return; // Mensaje de texto vacio o con un formato inesperado: se ignora.

    // Se guarda el mensaje del cliente en el historial completo de la
    // conversacion (ver conversaciones.js) ANTES de cualquier otra cosa,
    // para que quede registrado incluso si mas adelante truena algo.
    agregarMensaje(numeroCliente, 'cliente', texto);

    // --- Red de seguridad: amenazas, autolesion, etc ---------------------
    // Esto se revisa ANTES de mandarle nada a la IA, y ANTES del check de
    // ticket abierto de arriba (a proposito, ver el comentario ahi). No
    // confiamos en que la IA sola detecte bien este tipo de contenido: aqui
    // es una regla fija, siempre la misma respuesta neutral al cliente y
    // aviso urgente al dueno.
    if (contieneContenidoGrave(texto)) {
      agregarMensaje(numeroCliente, 'bot', RESPUESTA_NEUTRAL_PARA_EL_CLIENTE);
      await enviarMensajeWhatsApp(numeroCliente, RESPUESTA_NEUTRAL_PARA_EL_CLIENTE);
      const ticket = crearTicket({
        numeroCliente,
        categoria: 'SEGURIDAD',
        esUrgente: true,
        solicitud: texto,
        respuestaEnviada: RESPUESTA_NEUTRAL_PARA_EL_CLIENTE,
      });
      await notificarTicketAlDuenio(ticket);
      registrarCasoDificil({ numeroCliente, mensaje: texto, motivo: 'urgente' });
      return;
    }

    // Si hay un ticket abierto, el mensaje ya quedo guardado en el historial
    // arriba -- aqui es donde el bot se queda callado, sin llamar a la IA ni
    // mandar nada. (Ver el comentario grande donde se calculo "ticketAbierto".)
    if (ticketAbierto) return;

    // Le mandamos a la IA los ultimos 6 mensajes de la conversacion (no toda
    // la historia, para no gastar de mas en cada llamada), leidos del
    // historial persistido -- ya incluye el mensaje que se acaba de guardar.
    const historial = obtenerUltimosMensajes(numeroCliente, 6);

    const [contextoNegocio, casosAprendidos] = await Promise.all([
      obtenerContextoDelNegocio(),
      obtenerCasosAprendidos(),
    ]);

    const respuesta = await preguntarAClaude({
      contextoNegocio,
      casosAprendidos,
      historial,
    });

    // Si la IA misma detecto algo urgente (amenaza, violencia, autolesion, etc), lo
    // tratamos EXACTAMENTE igual que si lo hubiera detectado el filtro de palabras
    // clave: mismo texto neutral fijo, mismo aviso urgente al dueno. No confiamos en
    // que la IA elija bien las palabras del aviso para algo tan delicado.
    if (respuesta.esUrgente) {
      agregarMensaje(numeroCliente, 'bot', RESPUESTA_NEUTRAL_PARA_EL_CLIENTE);
      await enviarMensajeWhatsApp(numeroCliente, RESPUESTA_NEUTRAL_PARA_EL_CLIENTE);
      const ticket = crearTicket({
        numeroCliente,
        categoria: respuesta.categoria || 'SEGURIDAD',
        esUrgente: true,
        solicitud: texto,
        respuestaEnviada: RESPUESTA_NEUTRAL_PARA_EL_CLIENTE,
      });
      await notificarTicketAlDuenio(ticket);
      registrarCasoDificil({ numeroCliente, mensaje: texto, motivo: 'urgente' });
      return;
    }

    // Nunca mandamos un mensaje vacio/roto al cliente, aunque la IA falle en
    // darnos un texto valido (fallback de seguridad, no deberia pasar seguido).
    const textoParaElCliente = respuesta.textoParaElCliente ||
      'Gracias por tu mensaje, en un momento te contesta alguien del negocio.';

    agregarMensaje(numeroCliente, 'bot', textoParaElCliente);

    await enviarMensajeWhatsApp(numeroCliente, textoParaElCliente);

    if (respuesta.esPedidoCompleto) {
      guardarPedido(numeroCliente, respuesta.detallePedido);
      await avisarAlDuenio(respuesta.detallePedido, numeroCliente);
    }

    if (respuesta.necesitaHumano) {
      const categoria = respuesta.categoria || 'OTRO';

      // Si el cliente sigue escribiendo despues de que ya se le escalo algo
      // de esta misma categoria (y la IA arrastro ese tema viejo al mensaje
      // nuevo, como cuando mezcla "tu pedido ya quedo anotado" con una
      // pregunta sin relacion), no duplicamos el ticket -- ya existe uno
      // sin cerrar para lo mismo. Igual queda registrado el caso dificil,
      // por si conviene ensenarle la respuesta despues (ver aprendizaje.js).
      if (!existeTicketAbiertoIgual(numeroCliente, categoria)) {
        const ticket = crearTicket({
          numeroCliente,
          categoria,
          esUrgente: false,
          solicitud: texto,
          respuestaEnviada: textoParaElCliente,
        });
        await notificarTicketAlDuenio(ticket);
      }
      registrarCasoDificil({ numeroCliente, mensaje: texto, motivo: 'necesita_humano' });
    }
  } catch (error) {
    // Si algo truena a la mitad, avisamos al cliente que hubo un problema (en
    // vez de dejarlo sin ninguna respuesta) y lo dejamos anotado en los logs.
    console.error('Error procesando el mensaje:', error);
    if (numeroCliente) {
      try {
        agregarMensaje(numeroCliente, 'bot', MENSAJE_FALLA_TECNICA);
        await enviarMensajeWhatsApp(numeroCliente, MENSAJE_FALLA_TECNICA);
        registrarCasoDificil({ numeroCliente, mensaje: '(error tecnico)', motivo: 'error_tecnico' });
      } catch (errorSecundario) {
        console.error('Tampoco se pudo avisar al cliente del error:', errorSecundario);
      }
    }
  }
});

// Ruta simple para confirmar que el servidor esta vivo (util para monitoreo).
app.get('/', (req, res) => res.send('Bot de WhatsApp funcionando correctamente ✅'));

// Motor de reseñas post-pedido (Motor B, ver orders.js y programador.js) --
// SOLO Motor B: no se llama nada de Motor A aqui a proposito, las recogidas
// son el mismo dia y no aplican ventanas de recordatorio tipo 24h/2h (ver
// la tabla de Precedentes en el CLAUDE.md general). Se activa con
// ACTIVAR_SOLICITUD_RESENA=true en el .env; si no esta activo, este ciclo
// no hace nada.
const programadorPedidos = crearProgramador(gestorPedidos, {
  obtenerInfoNegocioCsv: obtenerContextoDelNegocio,
});
programadorPedidos.iniciarProgramador();

app.listen(PUERTO, () => {
  console.log(`Servidor escuchando en el puerto ${PUERTO}`);
});
