// ============================================================
// _testUtils.js
// ------------------------------------------------------------
// Utilidades compartidas por las pruebas del motor de eventos/recordatorios
// /reseñas. No es un archivo de pruebas en si (node --test lo ignora porque
// no empieza con "test" ni termina en ".test.js").
// ============================================================

const fs = require('fs');
const os = require('os');
const path = require('path');

// Crea una carpeta temporal nueva y apunta RAILWAY_VOLUME_MOUNT_PATH ahi
// (ver almacenamiento.js) para que cada prueba lea/escriba sus propios
// archivos .json sin tocar los del proyecto ni pisarse entre pruebas.
function usarCarpetaDeDatosTemporal() {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-whatsapp-test-'));
  process.env.RAILWAY_VOLUME_MOUNT_PATH = carpeta;
  return carpeta;
}

function borrarCarpeta(carpeta) {
  fs.rmSync(carpeta, { recursive: true, force: true });
}

// Fecha/hora (formato AAAA-MM-DD / HH:MM en America/Mexico_City, igual que
// eventoProgramado.js) que caen exactamente "minutos" a partir de ahora --
// para construir eventos de prueba sin depender de una fecha fija que se
// volveria obsoleta.
function fechaHoraDentroDe(minutos, zona = 'America/Mexico_City') {
  const objetivo = new Date(Date.now() + minutos * 60000);
  const fecha = objetivo.toLocaleDateString('en-CA', { timeZone: zona });
  const hora = objetivo.toLocaleTimeString('en-GB', { timeZone: zona, hour: '2-digit', minute: '2-digit' });
  return { fecha, hora };
}

// Reemplaza global.fetch por uno falso que registra las llamadas y siempre
// contesta "ok" (o lo que se le indique) -- para probar
// recordatorios.js/seguimientoPostEvento.js sin pegarle a la red real ni
// depender de credenciales de WhatsApp.
//
// Opcional: "respuestas" es una lista de respuestas para las llamadas en
// orden (la ultima se repite si hay mas llamadas que respuestas). Cada una
// puede ser {ok, status, texto} (texto = cuerpo de la respuesta, ej. el JSON
// de error de Meta) o un Error, para simular que la red se cae.
function instalarFetchFalso({ ok = true, respuestas } = {}) {
  const llamadas = [];
  const original = global.fetch;
  global.fetch = async (url, opciones) => {
    llamadas.push({ url, body: JSON.parse(opciones.body) });

    const respuesta = respuestas ? respuestas[Math.min(llamadas.length, respuestas.length) - 1] : { ok };
    if (respuesta instanceof Error) throw respuesta;

    return {
      ok: respuesta.ok,
      status: respuesta.status ?? (respuesta.ok ? 200 : 400),
      text: async () => respuesta.texto ?? (respuesta.ok ? '' : 'error simulado'),
    };
  };
  return {
    llamadas,
    restaurar: () => {
      global.fetch = original;
    },
  };
}

// Reescribe "completadaEn" de un evento YA guardado directo en su archivo
// JSON, simulando que se completo hace "horasAtras" horas -- crearGestorDeEventos
// no expone forma de hacer esto por la API publica (a proposito: completadaEn
// solo se fija una vez, ver actualizarEstadoEvento), asi que las pruebas de
// seguimientoPostEvento.js que necesitan "ya paso el tiempo de espera" tocan
// el archivo directo.
function backdatarCompletadaEn(archivo, idEvento, horasAtras) {
  const ruta = path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, archivo);
  const eventos = JSON.parse(fs.readFileSync(ruta, 'utf8'));
  const evento = eventos.find((e) => e.id === idEvento);
  evento.completadaEn = new Date(Date.now() - horasAtras * 3600000).toISOString();
  fs.writeFileSync(ruta, JSON.stringify(eventos, null, 2));
}

module.exports = { usarCarpetaDeDatosTemporal, borrarCarpeta, fechaHoraDentroDe, instalarFetchFalso, backdatarCompletadaEn };
