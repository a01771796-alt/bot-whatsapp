// ============================================================
// dashboard.js
// ------------------------------------------------------------
// Paginas web sencillas para ver y mover los tickets, equivalente al
// dashboard de KPIs y a los links de accion del proyecto de Make (ahi
// iban en un correo de Gmail; aqui van en el aviso de WhatsApp al dueno).
//
//   GET  /tickets                 -> dashboard con metricas y la lista de tickets
//   GET  /ticket/:id/revisar      -> marca el ticket como "en revision"
//   GET  /ticket/:id/contactar    -> muestra un formulario para escribir la respuesta
//   POST /ticket/:id/contactar    -> manda esa respuesta al cliente (NO cambia el estado)
//   GET  /ticket/:id/resolver     -> marca el ticket como "resuelto" directamente
//
// "Contactar al cliente" y "Marcar como resuelto" son acciones independientes
// a proposito: el dueno puede escribirle al cliente varias veces (o resolverlo
// sin escribirle nada, si ya lo arreglo por telefono/en persona) antes de
// cerrar el ticket. El dueno escribe su propia respuesta (no un mensaje
// generico) -- asi el bot puede decirle al cliente "voy a confirmar esto con
// el negocio" para cosas que no sabe (disponibilidad, stock del dia, etc), y
// cuando el dueno contesta desde este formulario, ESA respuesta especifica le
// llega al cliente por WhatsApp.
//
// Las rutas piden "?token=..." que debe coincidir con TOKEN_DASHBOARD del
// .env. Sin eso, cualquiera que adivine la URL podria ver o mover tickets
// de otras personas -- con el token, solo quien tiene el link de verdad
// (el dueno, por WhatsApp) puede usarlas.
// ============================================================

const express = require('express');
const { obtenerTickets, obtenerTicketPorId, actualizarEstadoTicket, registrarRespuestaEnviada } = require('./tickets');
const { enviarMensajeWhatsApp, enviarBotonConLinkWhatsApp } = require('./whatsapp');

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
  await enviarBotonConLinkWhatsApp(numeroDuenio, `Ticket ${ticket.id}`, 'Contactar cliente', linkAccion(ticket.id, 'contactar'));
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
      <td>${escaparHtml(t.solicitud)}</td>
      <td><span class="etiqueta estado-${t.estado}">${t.estado.replace('_', ' ')}</span></td>
      <td class="acciones">
        ${t.estado === 'PENDIENTE' ? `<a href="/ticket/${t.id}/revisar?token=${req.query.token}" target="_blank" rel="noopener">Marcar en revisión</a>` : ''}
        ${t.estado !== 'RESUELTO' ? `<a href="/ticket/${t.id}/contactar?token=${req.query.token}" target="_blank" rel="noopener">Contactar al cliente</a>` : ''}
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
        <a class="boton-actualizar" href="/tickets?token=${req.query.token}">🔄 Actualizar</a>
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

// Paso 1: mostrar el formulario con el mensaje del cliente y una caja de texto
// para que el dueno escriba su respuesta real. Esto NO marca el ticket como
// resuelto -- eso es el boton aparte de "Marcar como resuelto".
router.get('/ticket/:id/contactar', (req, res) => {
  if (!tokenValido(req)) return res.status(403).send('No autorizado.');

  const ticket = obtenerTicketPorId(req.params.id);
  if (!ticket) return res.status(404).send('Ese ticket no existe (o ya fue borrado).');

  res.send(`
    <!doctype html>
    <html lang="es">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Contactar al cliente</title>
      <style>
        body { font-family: system-ui, sans-serif; background: #f7f5f2; color: #222; padding: 20px; max-width: 480px; margin: 0 auto; }
        .mensaje-cliente { background: white; border-radius: 10px; padding: 12px 14px; margin: 12px 0; }
        textarea { width: 100%; box-sizing: border-box; font-size: 1rem; padding: 10px; border-radius: 8px; border: 1px solid #ccc; font-family: inherit; }
        button { margin-top: 12px; padding: 12px 18px; font-size: 1rem; border-radius: 8px; border: none; background: #1a7a34; color: white; font-weight: 600; }
      </style>
    </head>
    <body>
      <h2>Contactar al cliente</h2>
      <p>Ticket ${escaparHtml(ticket.id)} — categoría ${escaparHtml(ticket.categoria)}</p>
      <div class="mensaje-cliente">
        <b>El cliente escribió:</b><br>"${escaparHtml(ticket.solicitud)}"
      </div>
      <form method="POST" action="/ticket/${ticket.id}/contactar?token=${req.query.token}">
        <label for="mensaje"><b>Tu respuesta (se le manda tal cual por WhatsApp):</b></label><br>
        <textarea id="mensaje" name="mensaje" rows="5" placeholder="Escribe aquí lo que le quieres contestar..."></textarea>
        <br>
        <button type="submit">Enviar mensaje</button>
      </form>
      <p style="font-size:.8rem;color:#666;">Esto solo le manda el mensaje al cliente. Cuando el tema quede resuelto, usa el botón "Marcar como resuelto" en el dashboard.</p>
    </body>
    </html>
  `);
});

// Paso 2: se envia el formulario -- mandamos la respuesta del dueno al
// cliente por WhatsApp. El estado del ticket NO cambia aqui a proposito.
router.post('/ticket/:id/contactar', async (req, res) => {
  if (!tokenValido(req)) return res.status(403).send('No autorizado.');

  const mensaje = (req.body.mensaje || '').trim();
  if (!mensaje) return res.status(400).send('Escribe un mensaje antes de enviar.');

  const ticket = registrarRespuestaEnviada(req.params.id, mensaje);
  if (!ticket) return res.status(404).send('Ese ticket no existe (o ya fue borrado).');

  let seAvisoAlCliente = false;
  try {
    seAvisoAlCliente = await enviarMensajeWhatsApp(ticket.cliente, mensaje);
  } catch (error) {
    console.error('No se pudo mandar el mensaje al cliente:', error.message);
  }

  const mensajeAviso = seAvisoAlCliente
    ? 'Tu mensaje ya se le mandó al cliente por WhatsApp.'
    : '<b style="color:#a3242a">Ojo: no se pudo mandar tu mensaje por WhatsApp</b> (revisa los logs del servidor) — igual puedes escribirle tú mismo.';

  res.send(`
    <!doctype html><html lang="es"><meta charset="utf-8">
    <body style="font-family:system-ui,sans-serif;padding:24px;">
      <h2>✅ Listo</h2>
      <p>${mensajeAviso}</p>
      <p>El ticket <b>${escaparHtml(ticket.id)}</b> sigue como estaba. Cuando el tema quede resuelto, márcalo desde el dashboard.</p>
      <p>Puedes cerrar esta pantalla.</p>
    </body></html>
  `);
});

module.exports = { router, linkAccion, notificarTicketAlDuenio };
