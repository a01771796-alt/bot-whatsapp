// ============================================================
// dashboard.js
// ------------------------------------------------------------
// Paginas web sencillas para ver y mover los tickets, equivalente al
// dashboard de KPIs y a los links de accion del proyecto de Make (ahi
// iban en un correo de Gmail; aqui van en el aviso de WhatsApp al dueno).
//
//   GET  /tickets                 -> dashboard con metricas y la lista de tickets
//   GET  /ticket/:id/revisar      -> marca el ticket como "en revision"
//   GET  /ticket/:id/resolver     -> marca el ticket como "resuelto" directamente
//   GET  /conversacion            -> chat completo con un cliente (?numero=...), o buscador si no hay numero
//   POST /conversacion/enviar     -> manda un mensaje al cliente desde el chat
//
// "Marcar como resuelto" es una accion independiente de contestarle al
// cliente -- el dueno puede escribirle varias veces desde la pantalla de
// conversacion (o resolver sin escribirle nada, si ya lo arreglo por
// telefono/en persona) antes de cerrar el ticket.
//
// Las rutas piden "?token=..." que debe coincidir con TOKEN_DASHBOARD del
// .env. Sin eso, cualquiera que adivine la URL podria ver o mover tickets
// de otras personas -- con el token, solo quien tiene el link de verdad
// (el dueno, por WhatsApp) puede usarlas.
// ============================================================

const express = require('express');
const {
  obtenerTickets,
  actualizarEstadoTicket,
  registrarRespuestaEnviada,
  obtenerTicketAbiertoPorCliente,
  respaldarTickets,
  vaciarTickets,
} = require('./tickets');
const { enviarMensajeWhatsApp, enviarBotonConLinkWhatsApp } = require('./whatsapp');
const { agregarMensaje, obtenerConversacion, respaldarConversaciones, vaciarConversaciones } = require('./conversaciones');

const router = express.Router();
router.use(express.urlencoded({ extended: true })); // Para leer el formulario de respuesta.

function tokenValido(req) {
  const token = req.query.token || req.body?.token;
  return Boolean(process.env.TOKEN_DASHBOARD) && token === process.env.TOKEN_DASHBOARD;
}

function urlBase() {
  return process.env.URL_PUBLICA_DEL_SERVIDOR || '';
}

// Link con el token ya incluido, listo para pegarse en un mensaje de WhatsApp.
function linkAccion(idTicket, accion) {
  return `${urlBase()}/ticket/${encodeURIComponent(idTicket)}/${accion}?token=${process.env.TOKEN_DASHBOARD}`;
}

// Link directo a la pantalla de chat con un cliente especifico.
function linkConversacion(numeroCliente) {
  return `${urlBase()}/conversacion?numero=${encodeURIComponent(numeroCliente)}&token=${process.env.TOKEN_DASHBOARD}`;
}

// Le manda al dueno el aviso de un ticket nuevo: un mensaje de texto con el
// resumen, seguido de un mensaje POR CADA accion (cada uno con su propio
// boton nativo de WhatsApp) -- un mensaje interactivo solo admite un boton,
// por eso van separados en vez de ir todos los links juntos en un solo texto.
// Equivalente al correo interno con asunto dinamico ("🚨 ALTA | QUEJA | ...")
// del proyecto de Make.
async function notificarTicketAlDuenio(ticket) {
  const numeroDuenio = process.env.OWNER_WHATSAPP_NUMBER;
  if (!numeroDuenio) return;

  const esAlta = ticket.prioridad === 'ALTA';
  const etiquetaPrioridad = esAlta ? '🚨 *ALTA*' : '🟡 MEDIA';

  // WhatsApp no soporta HTML en los mensajes, solo su propio formato con
  // asteriscos para negritas. En prioridad ALTA resaltamos mas (categoria,
  // cliente y mensaje en negritas) para que el dueno lo note de inmediato
  // entre varios avisos; en MEDIA se deja mas discreto, sin negritas de mas.
  const resumen = esAlta
    ? `${etiquetaPrioridad} | *${ticket.categoria}* | Ticket ${ticket.id}\n` +
      `*Cliente:* ${ticket.cliente}\n` +
      `*Mensaje:* "${ticket.solicitud}"`
    : `${etiquetaPrioridad} | ${ticket.categoria} | Ticket ${ticket.id}\n` +
      `Cliente: ${ticket.cliente}\n` +
      `Mensaje: "${ticket.solicitud}"`;

  await enviarMensajeWhatsApp(numeroDuenio, resumen);
  await enviarBotonConLinkWhatsApp(numeroDuenio, `Ticket ${ticket.id}`, 'Marcar en revisión', linkAccion(ticket.id, 'revisar'));
  await enviarBotonConLinkWhatsApp(numeroDuenio, `Ticket ${ticket.id}`, 'Ver conversación', linkConversacion(ticket.cliente));
  await enviarBotonConLinkWhatsApp(numeroDuenio, `Ticket ${ticket.id}`, 'Marcar resuelto', linkAccion(ticket.id, 'resolver'));
}

// Evita que un texto con "<" o "&" del cliente rompa el HTML de la pagina.
function escaparHtml(texto) {
  return String(texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

router.get('/tickets', (req, res) => {
  if (!tokenValido(req)) return res.status(403).send('No autorizado.');

  const tickets = obtenerTickets().sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

  const total = tickets.length;
  const pendientes = tickets.filter((t) => t.estado === 'PENDIENTE').length;
  const enRevision = tickets.filter((t) => t.estado === 'EN_REVISION').length;
  const resueltos = tickets.filter((t) => t.estado === 'RESUELTO').length;
  const prioridadAlta = tickets.filter((t) => t.prioridad === 'ALTA').length;
  const tasaResolucion = total ? Math.round((resueltos / total) * 100) : 0;

  const tiempos = tickets.filter((t) => t.tiempoResolucionMinutos != null).map((t) => t.tiempoResolucionMinutos);
  const tiempoPromedio = tiempos.length
    ? Math.round(tiempos.reduce((suma, m) => suma + m, 0) / tiempos.length)
    : null;

  const filas = tickets.map((t) => `
    <tr>
      <td>${escaparHtml(t.id)}</td>
      <td>${new Date(t.fecha).toLocaleString('es-MX')}</td>
      <td>${escaparHtml(t.cliente)}</td>
      <td>${escaparHtml(t.categoria)}</td>
      <td><span class="etiqueta prioridad-${t.prioridad}">${t.prioridad}</span></td>
      <td><a href="${linkConversacion(t.cliente)}" target="_blank" rel="noopener">${escaparHtml(t.solicitud)}</a></td>
      <td><span class="etiqueta estado-${t.estado}">${t.estado.replace('_', ' ')}</span></td>
      <td class="acciones">
        ${t.estado === 'PENDIENTE' ? `<a href="/ticket/${t.id}/revisar?token=${req.query.token}" target="_blank" rel="noopener">Marcar en revisión</a>` : ''}
        ${t.estado !== 'RESUELTO' ? `<a href="/ticket/${t.id}/resolver?token=${req.query.token}" target="_blank" rel="noopener">Marcar como resuelto</a>` : ''}
      </td>
    </tr>
  `).join('');

  res.send(`
    <!doctype html>
    <html lang="es">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Tickets del bot</title>
      <style>
        body { font-family: system-ui, sans-serif; background: #f7f5f2; color: #222; margin: 0; padding: 16px; }
        h1 { font-size: 1.3rem; }
        .kpis { display: flex; flex-wrap: wrap; gap: 10px; margin: 16px 0; }
        .kpi { background: white; border-radius: 10px; padding: 10px 14px; box-shadow: 0 1px 3px rgba(0,0,0,.1); min-width: 110px; }
        .kpi .valor { font-size: 1.4rem; font-weight: 700; }
        .kpi .etiqueta-kpi { font-size: .75rem; color: #666; }
        table { width: 100%; border-collapse: collapse; background: white; border-radius: 10px; overflow: hidden; font-size: .85rem; }
        th, td { padding: 8px 10px; text-align: left; border-bottom: 1px solid #eee; vertical-align: top; }
        .tabla-scroll { overflow-x: auto; }
        .etiqueta { padding: 2px 8px; border-radius: 999px; font-size: .75rem; font-weight: 600; white-space: nowrap; }
        .prioridad-ALTA { background: #fde2e1; color: #a3242a; }
        .prioridad-MEDIA { background: #fff3cd; color: #8a6d1a; }
        .estado-PENDIENTE { background: #eee; color: #555; }
        .estado-EN_REVISION { background: #dbe9ff; color: #1a4a8a; }
        .estado-RESUELTO { background: #dcf5df; color: #1a7a34; }
        .acciones a { display: inline-block; margin-right: 8px; font-size: .8rem; }
        .barra-superior { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; }
        .boton-actualizar { display: inline-block; padding: 6px 14px; background: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,.1); text-decoration: none; color: #222; font-size: .85rem; }
      </style>
    </head>
    <body>
      <div class="barra-superior">
        <h1>Tickets del bot ☕</h1>
        <div style="display:flex;gap:8px;">
          <a class="boton-actualizar" href="/conversacion?token=${req.query.token}">💬 Conversaciones</a>
          <a class="boton-actualizar" href="/tickets?token=${req.query.token}">🔄 Actualizar</a>
        </div>
      </div>
      <p style="font-size:.8rem;color:#666;margin-top:-6px;">
        Los links de acción abren en una pestaña nueva. Esta página se actualiza sola cada
        pocos segundos, o toca "🔄 Actualizar" para verlo al instante.
      </p>
      <div class="kpis">
        <div class="kpi"><div class="valor">${total}</div><div class="etiqueta-kpi">Total</div></div>
        <div class="kpi"><div class="valor">${pendientes}</div><div class="etiqueta-kpi">Pendientes</div></div>
        <div class="kpi"><div class="valor">${enRevision}</div><div class="etiqueta-kpi">En revisión</div></div>
        <div class="kpi"><div class="valor">${resueltos}</div><div class="etiqueta-kpi">Resueltos</div></div>
        <div class="kpi"><div class="valor">${prioridadAlta}</div><div class="etiqueta-kpi">Prioridad alta</div></div>
        <div class="kpi"><div class="valor">${tasaResolucion}%</div><div class="etiqueta-kpi">Tasa de resolución</div></div>
        <div class="kpi"><div class="valor">${tiempoPromedio ?? '—'}</div><div class="etiqueta-kpi">Min. promedio resolución</div></div>
      </div>
      <div class="tabla-scroll">
        <table>
          <thead>
            <tr>
              <th>ID</th><th>Fecha</th><th>Cliente</th><th>Categoría</th><th>Prioridad</th>
              <th>Mensaje</th><th>Estado</th><th>Acciones</th>
            </tr>
          </thead>
          <tbody>${filas || '<tr><td colspan="8">Todavía no hay tickets.</td></tr>'}</tbody>
        </table>
      </div>
      <script>
        // Se actualiza sola cada 8 segundos para reflejar cambios hechos desde
        // los links de accion (que abren en otra pestana), sin que el dueno
        // tenga que estar dando clic en "Actualizar" a cada rato.
        setTimeout(() => location.reload(), 8000);
      </script>
    </body>
    </html>
  `);
});

router.get('/ticket/:id/revisar', (req, res) => {
  if (!tokenValido(req)) return res.status(403).send('No autorizado.');

  const ticket = actualizarEstadoTicket(req.params.id, 'EN_REVISION');
  if (!ticket) return res.status(404).send('Ese ticket no existe (o ya fue borrado).');

  res.send(`
    <!doctype html><html lang="es"><meta charset="utf-8">
    <body style="font-family:system-ui,sans-serif;padding:24px;">
      <h2>✅ Listo</h2>
      <p>El ticket <b>${escaparHtml(ticket.id)}</b> quedó marcado como <b>EN REVISIÓN</b>.</p>
      <p>Puedes cerrar esta pantalla.</p>
    </body></html>
  `);
});

// Marca el ticket como resuelto directamente, sin pedir ningun mensaje --
// para cuando el dueno ya resolvio el tema (por telefono, en persona, o ya
// habia contactado al cliente antes con el boton de "Contactar al cliente")
// y solo quiere dejarlo anotado.
router.get('/ticket/:id/resolver', (req, res) => {
  if (!tokenValido(req)) return res.status(403).send('No autorizado.');

  const ticket = actualizarEstadoTicket(req.params.id, 'RESUELTO');
  if (!ticket) return res.status(404).send('Ese ticket no existe (o ya fue borrado).');

  res.send(`
    <!doctype html><html lang="es"><meta charset="utf-8">
    <body style="font-family:system-ui,sans-serif;padding:24px;">
      <h2>✅ Listo</h2>
      <p>El ticket <b>${escaparHtml(ticket.id)}</b> quedó marcado como <b>RESUELTO</b>.</p>
      <p>Puedes cerrar esta pantalla.</p>
    </body></html>
  `);
});

// Formatea la hora de un mensaje para mostrarla junto a su burbuja.
function formatearHora(fecha) {
  return new Date(fecha).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}

// Formatea la fecha (sin hora) para los separadores tipo "11/09/2026" que
// aparecen cuando cambia el dia dentro de la conversacion.
function formatearFecha(fecha) {
  return new Date(fecha).toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// Arma las burbujas de la conversacion en orden cronologico, con un
// separador de fecha cada vez que el dia cambia (como en WhatsApp de verdad).
function armarBurbujas(mensajes) {
  let fechaAnterior = null;

  return mensajes.map((m) => {
    const fechaMsg = formatearFecha(m.fecha);
    const divisor = fechaMsg !== fechaAnterior ? `<div class="divisor-fecha">${fechaMsg}</div>` : '';
    fechaAnterior = fechaMsg;

    const etiquetaAutor = m.rol === 'bot' ? '🤖 Bot' : m.rol === 'dueno' ? '👤 Tú' : '';

    return `
      ${divisor}
      <div class="fila fila-${m.rol}">
        <div class="burbuja burbuja-${m.rol}">
          <div class="texto-burbuja">${escaparHtml(m.texto)}</div>
          <div class="hora-burbuja">${etiquetaAutor ? etiquetaAutor + ' · ' : ''}${formatearHora(m.fecha)}</div>
        </div>
      </div>
    `;
  }).join('');
}

// Pantalla de chat completa con un cliente -- imita la interfaz de WhatsApp
// (burbujas, cliente de un lado, bot/dueno del otro). Si no se pasa
// "?numero=..." en la URL, se muestra solo el buscador, para poder llegar
// aqui directo (sin pasar por un ticket) y escribir el numero a mano.
router.get('/conversacion', (req, res) => {
  if (!tokenValido(req)) return res.status(403).send('No autorizado.');

  const token = req.query.token;
  const numero = (req.query.numero || '').trim();
  const huboError = req.query.error === '1';

  const mensajes = numero ? obtenerConversacion(numero) : [];
  const burbujas = armarBurbujas(mensajes);

  res.send(`
    <!doctype html>
    <html lang="es">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Conversación${numero ? ' · ' + escaparHtml(numero) : ''}</title>
      <style>
        * { box-sizing: border-box; }
        body { font-family: system-ui, sans-serif; background: #e9e3d8; color: #222; margin: 0; padding: 0; display: flex; flex-direction: column; height: 100vh; }
        .barra-superior { background: #1a7a34; color: white; padding: 12px 16px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
        .barra-superior a { color: white; text-decoration: none; font-size: .85rem; white-space: nowrap; }
        .barra-superior h1 { font-size: 1rem; margin: 0; flex: 1; word-break: break-all; }
        .buscar { background: white; padding: 10px 16px; display: flex; gap: 8px; border-bottom: 1px solid #ddd; }
        .buscar input { flex: 1; min-width: 0; padding: 8px 10px; border-radius: 8px; border: 1px solid #ccc; font-size: .9rem; }
        .buscar button { padding: 8px 14px; border-radius: 8px; border: none; background: #1a7a34; color: white; font-weight: 600; }
        .aviso-error { background: #fde2e1; color: #a3242a; padding: 8px 16px; font-size: .85rem; }
        #mensajes { flex: 1; overflow-y: auto; padding: 16px; }
        .divisor-fecha { text-align: center; font-size: .75rem; color: #888; margin: 14px 0 10px; }
        .fila { display: flex; margin-bottom: 10px; }
        .fila-cliente { justify-content: flex-start; }
        .fila-bot, .fila-dueno { justify-content: flex-end; }
        .burbuja { max-width: 78%; padding: 8px 12px; border-radius: 12px; font-size: .92rem; line-height: 1.35; box-shadow: 0 1px 1px rgba(0,0,0,.06); }
        .burbuja-cliente { background: white; border-bottom-left-radius: 2px; }
        .burbuja-bot { background: #dcf5df; border-bottom-right-radius: 2px; }
        .burbuja-dueno { background: #1a7a34; color: white; border-bottom-right-radius: 2px; }
        .texto-burbuja { white-space: pre-wrap; word-break: break-word; }
        .hora-burbuja { font-size: .68rem; opacity: .7; margin-top: 4px; text-align: right; }
        .sin-mensajes, .sin-numero { text-align: center; color: #888; margin-top: 40px; font-size: .9rem; padding: 0 20px; }
        .barra-envio { background: white; border-top: 1px solid #ddd; padding: 10px 12px; display: flex; gap: 8px; align-items: flex-end; }
        .barra-envio textarea { flex: 1; resize: none; padding: 10px; border-radius: 10px; border: 1px solid #ccc; font-family: inherit; font-size: .95rem; max-height: 120px; }
        .barra-envio button { padding: 10px 16px; border-radius: 10px; border: none; background: #1a7a34; color: white; font-weight: 600; }
      </style>
    </head>
    <body>
      <div class="barra-superior">
        <a href="/tickets?token=${token}">← Tickets</a>
        <h1>${numero ? escaparHtml(numero) : 'Buscar conversación'}</h1>
      </div>
      <form class="buscar" method="GET" action="/conversacion">
        <input type="hidden" name="token" value="${token}">
        <input type="text" name="numero" placeholder="Número de cliente (ej. 5217223490354)" value="${escaparHtml(numero)}">
        <button type="submit">Ir</button>
      </form>
      ${huboError ? '<div class="aviso-error">Ojo: el último mensaje no se pudo mandar por WhatsApp (revisa los logs del servidor).</div>' : ''}
      ${numero ? `
        <div id="mensajes">
          ${burbujas || '<p class="sin-mensajes">Todavía no hay mensajes con este cliente.</p>'}
        </div>
        <form class="barra-envio" method="POST" action="/conversacion/enviar?token=${token}">
          <input type="hidden" name="numero" value="${escaparHtml(numero)}">
          <textarea id="mensaje" name="mensaje" rows="1" placeholder="Escribe un mensaje..." required></textarea>
          <button type="submit">Enviar</button>
        </form>
      ` : `<p class="sin-numero">Busca un número de cliente arriba, o entra desde un ticket en <a href="/tickets?token=${token}">la lista de tickets</a>.</p>`}
      <script>
        var contenedor = document.getElementById('mensajes');
        if (contenedor) contenedor.scrollTop = contenedor.scrollHeight;

        // Se actualiza sola cada 8 segundos, igual que el dashboard de tickets --
        // pero se salta el refresh si ya empezaste a escribir un mensaje, para
        // no borrarte lo que llevas escrito a la mitad.
        var textarea = document.getElementById('mensaje');
        setTimeout(function () {
          if (!textarea || textarea.value.trim() === '') location.reload();
        }, 8000);
      </script>
    </body>
    </html>
  `);
});

// Manda un mensaje al cliente desde la pantalla de chat -- como si fuera
// un chat real. Si el cliente tiene un ticket abierto, tambien se deja
// anotado ahi como su ultima respuesta, para que la tabla de tickets lo
// refleje sin tener que abrir la conversacion.
router.post('/conversacion/enviar', async (req, res) => {
  if (!tokenValido(req)) return res.status(403).send('No autorizado.');

  const numero = (req.body.numero || '').trim();
  const mensaje = (req.body.mensaje || '').trim();
  if (!numero || !mensaje) return res.status(400).send('Falta el número de cliente o el mensaje.');

  agregarMensaje(numero, 'dueno', mensaje);

  let seAvisoAlCliente = false;
  try {
    seAvisoAlCliente = await enviarMensajeWhatsApp(numero, mensaje);
  } catch (error) {
    console.error('No se pudo mandar el mensaje al cliente:', error.message);
  }

  const ticketAbierto = obtenerTicketAbiertoPorCliente(numero);
  if (ticketAbierto) registrarRespuestaEnviada(ticketAbierto.id, mensaje);

  const parametroError = seAvisoAlCliente ? '' : '&error=1';
  res.redirect(`/conversacion?numero=${encodeURIComponent(numero)}&token=${process.env.TOKEN_DASHBOARD}${parametroError}`);
});

// Frase exacta que hay que escribir en la pantalla de confirmacion para
// habilitar el boton de borrar -- ver el <script> de GET /reiniciar.
const FRASE_CONFIRMACION = 'BORRAR TODO';

// Pantalla de confirmacion antes de borrar TODO (tickets y conversaciones).
// Es GET (para poder llegar con un link) pero el borrado real es un POST
// aparte -- asi un link mal clickeado, un prefetch del navegador, o un bot
// que sigue links automaticamente no puede disparar el borrado por
// accidente. Encima de eso, el boton de borrar empieza deshabilitado: solo
// se activa si escribes la frase "BORRAR TODO" tal cual -- un solo clic
// (por accidente, o por el dedo resbalado en el celular) no alcanza.
router.get('/reiniciar', (req, res) => {
  if (!tokenValido(req)) return res.status(403).send('No autorizado.');

  res.send(`
    <!doctype html><html lang="es">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
    </head>
    <body style="font-family:system-ui,sans-serif;padding:24px;max-width:420px;margin:0 auto;">
      <h2>⚠️ Reiniciar el dashboard</h2>
      <p>Esto borra <b>TODOS</b> los tickets y <b>TODAS</b> las conversaciones guardadas.</p>
      <p style="font-size:.85rem;color:#666;">Se guarda un respaldo automático antes de borrar, pero recuperarlo requiere entrar al servidor a mano -- no hay un botón de "deshacer" rápido.</p>
      <form method="POST" action="/reiniciar?token=${req.query.token}">
        <label for="confirmacion">Escribe <b>${FRASE_CONFIRMACION}</b> para confirmar:</label><br>
        <input type="text" id="confirmacion" name="confirmacion" autocomplete="off" style="width:100%;box-sizing:border-box;padding:10px;border-radius:8px;border:1px solid #ccc;font-size:1rem;margin:8px 0;">
        <br>
        <button type="submit" id="boton-borrar" disabled style="width:100%;padding:12px 18px;border-radius:8px;border:none;background:#a3242a;color:white;font-weight:600;opacity:.5;">Sí, borrar todo</button>
      </form>
      <p style="margin-top:16px;"><a href="/tickets?token=${req.query.token}">Cancelar y volver a tickets</a></p>
      <script>
        var input = document.getElementById('confirmacion');
        var boton = document.getElementById('boton-borrar');
        input.addEventListener('input', function () {
          var listo = input.value.trim().toUpperCase() === ${JSON.stringify(FRASE_CONFIRMACION)};
          boton.disabled = !listo;
          boton.style.opacity = listo ? '1' : '.5';
        });
      </script>
    </body></html>
  `);
});

router.post('/reiniciar', (req, res) => {
  if (!tokenValido(req)) return res.status(403).send('No autorizado.');

  // Igual se valida la frase del lado del servidor -- el boton deshabilitado
  // en el HTML es solo una ayuda visual, no una proteccion real (cualquiera
  // podria mandar el POST directo sin pasar por el formulario).
  if ((req.body.confirmacion || '').trim().toUpperCase() !== FRASE_CONFIRMACION) {
    return res.status(400).send(`Escribe exactamente "${FRASE_CONFIRMACION}" para confirmar el borrado.`);
  }

  const marcaDeTiempo = new Date().toISOString().replace(/[:.]/g, '-');
  respaldarTickets(marcaDeTiempo);
  respaldarConversaciones(marcaDeTiempo);

  vaciarTickets();
  vaciarConversaciones();

  res.send(`
    <!doctype html><html lang="es"><meta charset="utf-8">
    <body style="font-family:system-ui,sans-serif;padding:24px;">
      <h2>✅ Listo</h2>
      <p>Se borraron todos los tickets y conversaciones.</p>
      <p style="font-size:.85rem;color:#666;">Quedó un respaldo con la marca de tiempo <code>${marcaDeTiempo}</code> guardado en el servidor.</p>
      <p><a href="/tickets?token=${req.query.token}">Volver a tickets</a></p>
    </body></html>
  `);
});

module.exports = { router, linkAccion, linkConversacion, notificarTicketAlDuenio };
