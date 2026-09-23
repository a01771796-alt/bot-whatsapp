const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { usarCarpetaDeDatosTemporal, borrarCarpeta, instalarFetchFalso, backdatarCompletadaEn } = require('./_testUtils');

// Las rutas de los .json se calculan con RAILWAY_VOLUME_MOUNT_PATH: la carpeta
// temporal tiene que existir ANTES de usar los modulos.
const carpeta = usarCarpetaDeDatosTemporal();
test.after(() => borrarCarpeta(carpeta));

const { crearGestorDeEventos } = require('../eventoProgramado');
const { crearProgramador } = require('../programador');
const { extraerLinkResena, esLinkDeGoogle, leTocaSolicitarResena, procesarSolicitudesDeResena } = require('../seguimientoPostEvento');
const { escribirArchivoDatos, rutaArchivoDatos, carpetaRespaldos, RESPALDOS_A_CONSERVAR } = require('../almacenamiento');

const VARIABLES = [
  'ACTIVAR_SOLICITUD_RESENA',
  'RESENA_ESPERA_HORAS',
  'WHATSAPP_PLANTILLA_RESENA',
  'WHATSAPP_PLANTILLA_RESENA_APROBADA',
  'OWNER_WHATSAPP_NUMBER',
];
function limpiarEnv() {
  for (const variable of VARIABLES) delete process.env[variable];
}
test.beforeEach(limpiarEnv);
test.after(limpiarEnv);

// --- Punto 1: link de reseña solo de Google, aviso CONFIG una vez, tope 48 h ---

test('esLinkDeGoogle: acepta los dominios de Google y rechaza cualquier otro', () => {
  for (const bueno of [
    'https://g.page/r/abc/review',
    'https://maps.app.goo.gl/xyz',
    'https://goo.gl/maps/xyz',
    'https://www.google.com/maps/place/x',
    'https://www.google.com.mx/maps/place/x',
    'https://g.co/kgs/abc',
    'https://share.google/abc123',
    'https://search.google.com/local/writereview?placeid=abc',
  ]) {
    assert.equal(esLinkDeGoogle(bueno), true, bueno);
  }
  for (const malo of [
    'https://example.com/resena',
    'https://instagram.com/negocio',
    'https://google.com.evil.com/x',
    'https://notgoogle.com/x',
    'javascript:alert(1)',
    'g.page/sin-protocolo',
    '',
  ]) {
    assert.equal(esLinkDeGoogle(malo), false, malo);
  }
  assert.equal(extraerLinkResena('Link de reseña Google: https://instagram.com/negocio'), '');
  assert.equal(extraerLinkResena('Campo,Valor\nLink de reseña Google,https://example.com/x\n'), '');
});

test('leTocaSolicitarResena ignora eventos completados hace mas de 48 h', () => {
  const completadaHace = (horas) => ({ estado: 'COMPLETADA', completadaEn: new Date(Date.now() - horas * 3600000).toISOString() });
  assert.equal(leTocaSolicitarResena(completadaHace(47)), true);
  assert.equal(leTocaSolicitarResena(completadaHace(49)), false);
});

test('link faltante o invalido: avisa al dueno (CONFIG) una sola vez, y vuelve a avisar si se rompe otra vez', async () => {
  process.env.ACTIVAR_SOLICITUD_RESENA = 'true';
  process.env.RESENA_ESPERA_HORAS = '2';
  process.env.WHATSAPP_PLANTILLA_RESENA = 'plantilla_resena';
  process.env.WHATSAPP_PLANTILLA_RESENA_APROBADA = 'true';
  process.env.OWNER_WHATSAPP_NUMBER = '5215512345678';

  const archivo = `res-${Date.now()}-config.json`;
  const gestor = crearGestorDeEventos({ archivo });
  const nuevoEventoCompletado = () => {
    const evento = gestor.crearEvento({ cliente: '5215500001111', descripcion: 'x' });
    gestor.actualizarEstadoEvento(evento.id, 'COMPLETADA');
    backdatarCompletadaEn(archivo, evento.id, 3);
    return evento;
  };
  nuevoEventoCompletado();

  const fetchFalso = instalarFetchFalso();
  try {
    const LINK_MALO = async () => 'Link de reseña Google: https://example.com/resena';
    await procesarSolicitudesDeResena(gestor, LINK_MALO);
    assert.equal(fetchFalso.llamadas.length, 1); // el aviso al dueno
    assert.match(fetchFalso.llamadas[0].body.to, /5512345678$/);
    assert.match(fetchFalso.llamadas[0].body.text.body, /link de reseña/i);

    await procesarSolicitudesDeResena(gestor, LINK_MALO); // siguiente ciclo: no repite
    await procesarSolicitudesDeResena(gestor, async () => '');
    assert.equal(fetchFalso.llamadas.length, 1);

    // El dueno lo corrige: se manda la reseña al cliente (no al dueno) y se rearma el aviso.
    await procesarSolicitudesDeResena(gestor, async () => 'Link de reseña Google: https://g.page/negocio/review');
    assert.equal(fetchFalso.llamadas.length, 2);
    assert.equal(fetchFalso.llamadas[1].body.type, 'template');

    nuevoEventoCompletado();
    await procesarSolicitudesDeResena(gestor, LINK_MALO);
    assert.equal(fetchFalso.llamadas.length, 3); // volvio a romperse: avisa de nuevo
  } finally {
    fetchFalso.restaurar();
  }
});

// --- Punto 4: escritura atomica y respaldo diario -----------------------------

test('escribirArchivoDatos: escribe sin dejar temporales y respalda una sola vez por dia', () => {
  const ruta = rutaArchivoDatos('prueba-datos.json');
  escribirArchivoDatos(ruta, '{"v":1}'); // no existia: no hay nada que respaldar
  const copiasDe = (prefijo) =>
    (fs.existsSync(carpetaRespaldos()) ? fs.readdirSync(carpetaRespaldos()) : []).filter((n) => n.startsWith(prefijo));
  assert.equal(copiasDe('prueba-datos.').length, 0);

  escribirArchivoDatos(ruta, '{"v":2}');
  escribirArchivoDatos(ruta, '{"v":3}');
  assert.equal(fs.readFileSync(ruta, 'utf8'), '{"v":3}');

  const copias = copiasDe('prueba-datos.');
  assert.equal(copias.length, 1); // la segunda escritura del dia no crea otra
  assert.equal(fs.readFileSync(path.join(carpetaRespaldos(), copias[0]), 'utf8'), '{"v":1}'); // el estado previo
  assert.deepEqual(fs.readdirSync(carpeta).filter((n) => n.endsWith('.tmp')), []);
});

test('escribirArchivoDatos: conserva solo los ultimos 7 respaldos', () => {
  const ruta = rutaArchivoDatos('rotacion.json');
  fs.writeFileSync(ruta, '{}');
  fs.mkdirSync(carpetaRespaldos(), { recursive: true });
  for (let dia = 1; dia <= 9; dia++) {
    fs.writeFileSync(path.join(carpetaRespaldos(), `rotacion.2020-01-0${dia}.json`), '{}');
  }
  fs.writeFileSync(path.join(carpetaRespaldos(), 'otro.2020-01-01.json'), '{}'); // de otro archivo: no se toca

  escribirArchivoDatos(ruta, '{"nuevo":true}'); // crea el de hoy -> 10 en total, quedan 7

  const nombres = fs.readdirSync(carpetaRespaldos());
  const propios = nombres.filter((n) => n.startsWith('rotacion.')).sort();
  assert.equal(propios.length, RESPALDOS_A_CONSERVAR);
  assert.ok(!propios.includes('rotacion.2020-01-01.json'));
  assert.ok(!propios.includes('rotacion.2020-01-03.json'));
  assert.ok(propios.includes('rotacion.2020-01-04.json'));
  assert.ok(nombres.includes('otro.2020-01-01.json'));
});

test('escribirArchivoDatos: si el renombrado falla, el archivo original queda intacto y sin temporales', () => {
  const ruta = rutaArchivoDatos('atomico.json');
  fs.writeFileSync(ruta, '{"original":true}');

  const renombrarOriginal = fs.renameSync;
  fs.renameSync = () => {
    throw new Error('disco lleno');
  };
  try {
    assert.throws(() => escribirArchivoDatos(ruta, '{"a medias'), /disco lleno/);
  } finally {
    fs.renameSync = renombrarOriginal;
  }

  assert.equal(fs.readFileSync(ruta, 'utf8'), '{"original":true}');
  assert.deepEqual(fs.readdirSync(carpeta).filter((n) => n.endsWith('.tmp')), []);
});

// --- Punto 5: avisos ENVIANDO interrumpidos al arrancar -------------------------

function envejecerSeguimiento(archivo, idEvento, tipo, minutosAtras) {
  const ruta = rutaArchivoDatos(archivo);
  const eventos = JSON.parse(fs.readFileSync(ruta, 'utf8'));
  eventos.find((e) => e.id === idEvento).seguimiento[tipo].intentoEn = new Date(Date.now() - minutosAtras * 60000).toISOString();
  fs.writeFileSync(ruta, JSON.stringify(eventos, null, 2));
}

test('actualizarSeguimiento cuenta los intentos: cada ENVIANDO suma uno', () => {
  const gestor = crearGestorDeEventos({ archivo: `ev-${Date.now()}-intentos.json` });
  const evento = gestor.crearEvento({ cliente: '1', descripcion: 'x' });

  assert.equal(gestor.actualizarSeguimiento(evento.id, 'resena', 'ENVIANDO').seguimiento.resena.intentos, 1);
  assert.equal(gestor.actualizarSeguimiento(evento.id, 'resena', 'ENVIADO').seguimiento.resena.intentos, 1);
  assert.equal(gestor.actualizarSeguimiento(evento.id, 'resena', 'ENVIANDO').seguimiento.resena.intentos, 2);
});

test('recuperarEnviandoInterrumpidos: >10 min y <2 intentos -> pendiente; 2 intentos -> FALLIDO "interrumpido"; reciente -> intacto', () => {
  const archivo = `ev-${Date.now()}-recuperar.json`;
  const gestor = crearGestorDeEventos({ archivo });
  const evento = gestor.crearEvento({ cliente: '1', descripcion: 'x' });

  gestor.actualizarSeguimiento(evento.id, 'recordatorio1', 'ENVIANDO'); // 1 intento, viejo
  gestor.actualizarSeguimiento(evento.id, 'recordatorio2', 'ENVIANDO');
  gestor.actualizarSeguimiento(evento.id, 'recordatorio2', 'ENVIANDO'); // 2 intentos, viejo
  gestor.actualizarSeguimiento(evento.id, 'resena', 'ENVIANDO'); // 1 intento, reciente
  envejecerSeguimiento(archivo, evento.id, 'recordatorio1', 11);
  envejecerSeguimiento(archivo, evento.id, 'recordatorio2', 11);
  envejecerSeguimiento(archivo, evento.id, 'resena', 5);

  assert.deepEqual(gestor.recuperarEnviandoInterrumpidos(), { reintentar: 1, fallidos: 1 });

  const { seguimiento } = gestor.obtenerEventoPorId(evento.id);
  assert.equal(seguimiento.recordatorio1.estado, 'PENDIENTE');
  assert.equal(seguimiento.recordatorio2.estado, 'FALLIDO');
  assert.equal(seguimiento.recordatorio2.error, 'interrumpido');
  assert.equal(seguimiento.resena.estado, 'ENVIANDO');
});

test('al arrancar, iniciarProgramador recupera los avisos y la reseña interrumpida se reintenta una vez', async () => {
  process.env.ACTIVAR_SOLICITUD_RESENA = 'true';
  process.env.RESENA_ESPERA_HORAS = '2';
  process.env.WHATSAPP_PLANTILLA_RESENA = 'plantilla_resena';
  process.env.WHATSAPP_PLANTILLA_RESENA_APROBADA = 'true';

  const archivo = `ev-${Date.now()}-arranque.json`;
  const gestor = crearGestorDeEventos({ archivo });
  const evento = gestor.crearEvento({ cliente: '5215500001111', descripcion: 'x' });
  gestor.actualizarEstadoEvento(evento.id, 'COMPLETADA');
  backdatarCompletadaEn(archivo, evento.id, 3);
  gestor.actualizarSeguimiento(evento.id, 'resena', 'ENVIANDO'); // el bot se cayo aqui
  envejecerSeguimiento(archivo, evento.id, 'resena', 11);

  const programador = crearProgramador(gestor, { obtenerInfoNegocioCsv: async () => 'Link de reseña Google: https://g.page/x' });

  const setIntervalOriginal = global.setInterval;
  global.setInterval = () => ({}); // sin timer real: la prueba no debe quedar colgada
  const logOriginal = console.log;
  const warnOriginal = console.warn;
  console.log = console.warn = () => {};
  try {
    programador.iniciarProgramador();
  } finally {
    global.setInterval = setIntervalOriginal;
    console.log = logOriginal;
    console.warn = warnOriginal;
  }
  assert.equal(gestor.obtenerEventoPorId(evento.id).seguimiento.resena.estado, 'PENDIENTE');

  const fetchFalso = instalarFetchFalso();
  try {
    await programador.cicloDeSeguimiento();
  } finally {
    fetchFalso.restaurar();
  }
  assert.equal(fetchFalso.llamadas.length, 1);
  const resena = gestor.obtenerEventoPorId(evento.id).seguimiento.resena;
  assert.equal(resena.estado, 'ENVIADO');
  assert.equal(resena.intentos, 2);
});
