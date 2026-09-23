// Carpeta de datos temporal ANTES de requerir './orders' -- ese modulo crea
// su gestor de eventos (y por lo tanto resuelve la ruta del archivo .json)
// en cuanto se importa, asi que RAILWAY_VOLUME_MOUNT_PATH debe existir desde
// antes (ver almacenamiento.js).
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.RAILWAY_VOLUME_MOUNT_PATH = fs.mkdtempSync(path.join(os.tmpdir(), 'cafeteria-test-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const { instalarFetchFalso } = require('./_testUtils');

const { gestor, obtenerPedidos, guardarPedido } = require('../orders');
const { activo: motorAactivo, procesarRecordatorios } = require('../recordatorios');
const { procesarSolicitudesDeResena, extraerLinkResena } = require('../seguimientoPostEvento');
const { crearProgramador } = require('../programador');

function limpiarEnv() {
  delete process.env.ACTIVAR_RECORDATORIOS_EVENTO;
  delete process.env.RECORDATORIO_EVENTO_VENTANAS_MIN;
  delete process.env.ACTIVAR_SOLICITUD_RESENA;
  delete process.env.RESENA_ESPERA_HORAS;
  delete process.env.WHATSAPP_PLANTILLA_RESENA;
  delete process.env.WHATSAPP_PLANTILLA_RESENA_APROBADA;
  delete process.env.NOMBRE_NEGOCIO;
}
test.beforeEach(limpiarEnv);
test.after(limpiarEnv);

function backdatarCompletadaEn(idEvento, horasAtras) {
  const ruta = path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'pedidos.json');
  const eventos = JSON.parse(fs.readFileSync(ruta, 'utf8'));
  eventos.find((e) => e.id === idEvento).completadaEn = new Date(Date.now() - horasAtras * 3600000).toISOString();
  fs.writeFileSync(ruta, JSON.stringify(eventos, null, 2));
}

test('guardarPedido crea un evento PENDIENTE sin fecha/hora (no aplica Motor A)', () => {
  const pedido = guardarPedido('5215500001111', '2 cafés americanos, nombre Erika, recoge a las 5pm');
  assert.ok(pedido.id.startsWith('PEDIDO-'));
  assert.equal(pedido.estado, 'PENDIENTE');
  assert.equal(pedido.fecha, null);
  assert.equal(pedido.hora, null);
});

test('obtenerPedidos filtra registros del formato anterior sin "id" (migracion no destructiva)', () => {
  const rutaArchivo = path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'pedidos.json');
  const existentes = fs.existsSync(rutaArchivo) ? JSON.parse(fs.readFileSync(rutaArchivo, 'utf8')) : [];
  fs.writeFileSync(rutaArchivo, JSON.stringify([
    ...existentes,
    { fecha: '10/9/2026, 6:55:47 p.m.', cliente: '5217223490354', detalle: 'pedido en formato viejo, sin id' },
  ], null, 2));

  const pedidos = obtenerPedidos();
  assert.ok(pedidos.every((p) => p.id), 'ningun pedido listado deberia carecer de id');
});

test('Motor A (recordatorios) nunca se activa en este giro -- ACTIVAR_RECORDATORIOS_EVENTO no se configura', () => {
  // No se define ACTIVAR_RECORDATORIOS_EVENTO en .env.example de este
  // proyecto (ver nota en ese archivo): confirmamos que, aun si alguien lo
  // prendiera sin querer, un pedido (sin fecha/hora) nunca dispara nada.
  assert.equal(motorAactivo(), false);
});

test('procesarRecordatorios no manda nada aunque se active por error (los pedidos no tienen fecha/hora)', async () => {
  process.env.ACTIVAR_RECORDATORIOS_EVENTO = 'true';
  process.env.RECORDATORIO_EVENTO_VENTANAS_MIN = '60';
  const pedido = guardarPedido('5215500002222', 'Pedido de prueba');

  const fetchFalso = instalarFetchFalso();
  await procesarRecordatorios(gestor);
  fetchFalso.restaurar();

  assert.equal(fetchFalso.llamadas.length, 0);
  assert.deepEqual(gestor.obtenerEventoPorId(pedido.id).seguimiento, {});
});

test('extraerLinkResena lee la fila en formato de una sola celda (dummy-negocio.txt de este giro)', () => {
  const texto = 'Promociones: 2x1 en café americano de 8am a 10am, todos los días\n' +
    'Link de reseña Google: https://g.page/r/cafe-la-esquina/review';
  assert.equal(extraerLinkResena(texto), 'https://g.page/r/cafe-la-esquina/review');
});

test('flujo completo: pedido -> marcar entregado -> Motor B manda la solicitud de reseña tras 30 minutos', async () => {
  process.env.ACTIVAR_SOLICITUD_RESENA = 'true';
  process.env.RESENA_ESPERA_HORAS = '0.5'; // 30 minutos, valor real de este giro
  process.env.WHATSAPP_PLANTILLA_RESENA = 'plantilla_resena_cafe';
  process.env.WHATSAPP_PLANTILLA_RESENA_APROBADA = 'true';
  process.env.NOMBRE_NEGOCIO = 'Café La Esquina';

  const pedido = guardarPedido('5215500003333', '1 capuchino, nombre Vale');

  // Todavia no ha pasado la espera -- no debe mandarse nada.
  const fetchAntes = instalarFetchFalso();
  await procesarSolicitudesDeResena(gestor, async () => 'Link de reseña Google: https://g.page/cafe');
  fetchAntes.restaurar();
  assert.equal(fetchAntes.llamadas.length, 0, 'no deberia mandar nada antes de marcar el pedido como entregado');

  // Se marca como entregado (accion manual del dueno, ver dashboard.js) y se
  // backdatea completadaEn para simular que ya pasaron los 30 minutos.
  gestor.actualizarEstadoEvento(pedido.id, 'COMPLETADA');
  backdatarCompletadaEn(pedido.id, 1); // "hace 1 hora" > 30 min de espera

  const fetchDespues = instalarFetchFalso();
  await procesarSolicitudesDeResena(gestor, async () => 'Link de reseña Google: https://g.page/cafe');
  fetchDespues.restaurar();

  assert.equal(fetchDespues.llamadas.length, 1);
  assert.equal(fetchDespues.llamadas[0].body.template.name, 'plantilla_resena_cafe');
  assert.deepEqual(fetchDespues.llamadas[0].body.template.components[0].parameters.map((p) => p.text), [
    'cliente', // este pedido se guardo sin nombreCliente
    'Café La Esquina',
    'https://g.page/cafe',
  ]);

  assert.equal(gestor.obtenerEventoPorId(pedido.id).seguimiento.resena.estado, 'ENVIADO');
});

test('crearProgramador con solo Motor B activo corre sin necesitar Motor A configurado', async () => {
  process.env.ACTIVAR_SOLICITUD_RESENA = 'true';
  process.env.RESENA_ESPERA_HORAS = '0.5';
  process.env.WHATSAPP_PLANTILLA_RESENA = 'plantilla_resena_cafe';
  process.env.WHATSAPP_PLANTILLA_RESENA_APROBADA = 'true';

  const pedido = guardarPedido('5215500004444', 'Pedido para el ciclo del programador');
  gestor.actualizarEstadoEvento(pedido.id, 'COMPLETADA');
  backdatarCompletadaEn(pedido.id, 1);

  const programador = crearProgramador(gestor, { obtenerInfoNegocioCsv: async () => 'Link de reseña Google: https://g.page/x' });

  const fetchFalso = instalarFetchFalso();
  await programador.cicloDeSeguimiento();
  fetchFalso.restaurar();

  assert.equal(fetchFalso.llamadas.length, 1);
});

test('guardarPedido guarda nombreCliente (y queda vacio si no se da)', () => {
  const conNombre = guardarPedido('5215500004444', '1 latte', '  Erika  ');
  const sinNombre = guardarPedido('5215500005555', '1 té');

  assert.equal(conNombre.nombreCliente, 'Erika');
  assert.equal(gestor.obtenerEventoPorId(conNombre.id).nombreCliente, 'Erika');
  assert.equal(sinNombre.nombreCliente, '');
});
