const test = require('node:test');
const assert = require('node:assert/strict');
const { usarCarpetaDeDatosTemporal, borrarCarpeta, instalarFetchFalso } = require('./_testUtils');

// tickets.js y orders.js calculan la ruta de sus .json al cargarse: la carpeta
// temporal tiene que existir ANTES de requerirlos, o las pruebas escribirian
// en los .json reales del proyecto.
const carpeta = usarCarpetaDeDatosTemporal();
test.after(() => borrarCarpeta(carpeta));

const { avisarAlDueno } = require('../whatsapp');
const { router, notificarTicketAlDuenio } = require('../dashboard');
const { crearTicket, registrarAvisoDueno, vaciarTickets, obtenerTicketPorId } = require('../tickets');
const { gestor, guardarPedido, avisarAlDuenio } = require('../orders');

const VARIABLES = [
  'OWNER_WHATSAPP_NUMBER',
  'TOKEN_DASHBOARD',
  'URL_PUBLICA_DEL_SERVIDOR',
  'WHATSAPP_PLANTILLA_AVISO_DUENO',
  'WHATSAPP_PLANTILLA_AVISO_DUENO_APROBADA',
];
function limpiarEnv() {
  for (const variable of VARIABLES) delete process.env[variable];
}
test.beforeEach(() => {
  limpiarEnv();
  vaciarTickets();
  gestor.vaciarEventos();
  process.env.OWNER_WHATSAPP_NUMBER = '5215512345678';
  process.env.TOKEN_DASHBOARD = 'token-de-prueba';
  process.env.URL_PUBLICA_DEL_SERVIDOR = 'https://bot.example';
});
test.after(limpiarEnv);

const FUERA_DE_VENTANA = {
  ok: false,
  status: 400,
  texto: JSON.stringify({ error: { code: 131047, message: 'Re-engagement message' } }),
};

function configurarPlantilla({ aprobada }) {
  process.env.WHATSAPP_PLANTILLA_AVISO_DUENO = 'aviso_dueno';
  process.env.WHATSAPP_PLANTILLA_AVISO_DUENO_APROBADA = aprobada ? 'true' : 'false';
}

async function conFetchFalso(opciones, fn) {
  const fetchFalso = instalarFetchFalso(opciones);
  try {
    return await fn(fetchFalso);
  } finally {
    fetchFalso.restaurar();
  }
}

// Ejecuta el handler de una ruta GET del router sin levantar el servidor.
function pedirRuta(ruta, query) {
  const capa = router.stack.find((c) => c.route && c.route.path === ruta && c.route.methods.get);
  const respuesta = { codigo: 200, html: '' };
  const res = {
    status(codigo) {
      respuesta.codigo = codigo;
      return this;
    },
    send(contenido) {
      respuesta.html = String(contenido);
      return this;
    },
  };
  capa.route.stack[0].handle({ query, body: {} }, res);
  return respuesta;
}

function filaQueContiene(html, texto) {
  return html.split('<tr>').find((fila) => fila.includes(texto));
}

test('aviso exitoso: sale por texto, sin usar la plantilla', async () => {
  configurarPlantilla({ aprobada: true });

  await conFetchFalso({ respuestas: [{ ok: true }] }, async (fetchFalso) => {
    const resultado = await avisarAlDueno({ tipo: 'pedido', resumen: 'Nuevo pedido', referenciaId: 'PEDIDO-1' });

    assert.equal(resultado.estado, 'ENVIADO');
    assert.equal(resultado.via, 'texto');
    assert.equal(fetchFalso.llamadas.length, 1);
    assert.equal(fetchFalso.llamadas[0].body.type, 'text');
  });
});

test('fallo del texto con plantilla aprobada: reintenta por plantilla', async () => {
  configurarPlantilla({ aprobada: true });

  await conFetchFalso({ respuestas: [FUERA_DE_VENTANA, { ok: true }] }, async (fetchFalso) => {
    const resultado = await avisarAlDueno({ tipo: 'pedido', resumen: 'Nuevo pedido\n2 cafés', referenciaId: 'PEDIDO-1' });

    assert.equal(resultado.estado, 'ENVIADO');
    assert.equal(resultado.via, 'plantilla');
    assert.equal(fetchFalso.llamadas[1].body.template.name, 'aviso_dueno');
    assert.deepEqual(
      fetchFalso.llamadas[1].body.template.components[0].parameters.map((p) => p.text),
      ['pedido', 'Nuevo pedido | 2 cafés', '—']
    );
  });
});

test('fallo del texto con plantilla NO aprobada: FALLIDO y no se manda ninguna plantilla', async () => {
  configurarPlantilla({ aprobada: false });

  await conFetchFalso({ respuestas: [FUERA_DE_VENTANA] }, async (fetchFalso) => {
    const resultado = await avisarAlDueno({ tipo: 'pedido', resumen: 'Nuevo pedido', referenciaId: 'PEDIDO-1' });

    assert.equal(resultado.estado, 'FALLIDO');
    assert.match(resultado.error, /131047/);
    assert.match(resultado.error, /sin aprobar/);
    assert.equal(fetchFalso.llamadas.length, 1);
  });
});

test('pedido: si el aviso falla, queda FALLIDO en el pedido y /pedidos lo marca (solo a ese)', async () => {
  configurarPlantilla({ aprobada: false });

  const pedidoFallido = guardarPedido('5215500001111', 'Pedido con aviso fallido');
  const pedidoViejo = guardarPedido('5215500002222', 'Pedido sin campo avisoDueno');

  await conFetchFalso({ respuestas: [FUERA_DE_VENTANA] }, async () => {
    const resultado = await avisarAlDuenio('Pedido con aviso fallido', '5215500001111', pedidoFallido.id);
    assert.equal(resultado.estado, 'FALLIDO');
  });

  assert.equal(gestor.obtenerEventoPorId(pedidoFallido.id).avisoDueno.estado, 'FALLIDO');
  assert.equal(gestor.obtenerEventoPorId(pedidoViejo.id).avisoDueno, undefined);

  const { codigo, html } = pedirRuta('/pedidos', { token: 'token-de-prueba' });
  assert.equal(codigo, 200);
  assert.match(filaQueContiene(html, 'Pedido con aviso fallido'), /Aviso al dueño no llegó/);
  assert.match(filaQueContiene(html, 'Pedido con aviso fallido'), /131047/); // el motivo va en el tooltip
  assert.doesNotMatch(filaQueContiene(html, 'Pedido sin campo avisoDueno'), /Aviso al dueño no llegó/);
});

test('pedido: si el aviso llega por plantilla se guarda ENVIADO y /pedidos no lo marca', async () => {
  configurarPlantilla({ aprobada: true });
  const pedido = guardarPedido('5215500001111', 'Pedido que llego por plantilla');

  await conFetchFalso({ respuestas: [FUERA_DE_VENTANA, { ok: true }] }, async () => {
    await avisarAlDuenio('Pedido que llego por plantilla', '5215500001111', pedido.id);
  });

  const guardado = gestor.obtenerEventoPorId(pedido.id).avisoDueno;
  assert.equal(guardado.estado, 'ENVIADO');
  assert.equal(guardado.via, 'plantilla');

  const { html } = pedirRuta('/pedidos', { token: 'token-de-prueba' });
  assert.doesNotMatch(html, /Aviso al dueño no llegó/);
});

test('/tickets marca el ticket cuyo aviso fallo, y no uno sin el campo', () => {
  const conAvisoFallido = crearTicket({ numeroCliente: '1', categoria: 'QUEJA', esUrgente: false, solicitud: 'ticket con aviso fallido', respuestaEnviada: 'ok' });
  crearTicket({ numeroCliente: '2', categoria: 'OTRO', esUrgente: false, solicitud: 'ticket sin campo avisoDueno', respuestaEnviada: 'ok' });
  registrarAvisoDueno(conAvisoFallido.id, { estado: 'FALLIDO', intentoEn: new Date().toISOString(), error: 'texto: 131047: x', via: null });

  const { html } = pedirRuta('/tickets', { token: 'token-de-prueba' });
  assert.match(filaQueContiene(html, 'ticket con aviso fallido'), /Aviso al dueño no llegó/);
  assert.doesNotMatch(filaQueContiene(html, 'ticket sin campo avisoDueno'), /Aviso al dueño no llegó/);
  assert.equal(pedirRuta('/tickets', { token: 'otro' }).codigo, 403);
});

test('notificarTicketAlDuenio manda los 3 botones por la via normal, y por plantilla un solo link', async () => {
  const ticket = crearTicket({ numeroCliente: '5215512345678', categoria: 'QUEJA', esUrgente: false, solicitud: 'x', respuestaEnviada: 'ok' });

  await conFetchFalso({ respuestas: [{ ok: true }] }, async (fetchFalso) => {
    await notificarTicketAlDuenio(ticket);
    assert.equal(fetchFalso.llamadas.length, 4); // texto + 3 botones
    assert.deepEqual(
      fetchFalso.llamadas.slice(1).map((c) => c.body.interactive.action.parameters.display_text),
      ['Ver conversación', 'Marcar en revisión', 'Marcar resuelto']
    );
  });

  configurarPlantilla({ aprobada: true });
  await conFetchFalso({ respuestas: [FUERA_DE_VENTANA, { ok: true }] }, async (fetchFalso) => {
    await notificarTicketAlDuenio(ticket);
    assert.equal(fetchFalso.llamadas.length, 2);
    const parametros = fetchFalso.llamadas[1].body.template.components[0].parameters.map((p) => p.text);
    assert.match(parametros[2], /\/conversacion\?numero=/);
    assert.ok(!parametros.some((p) => p.includes('/revisar')));
  });
  assert.equal(obtenerTicketPorId(ticket.id).avisoDueno.via, 'plantilla');
});
