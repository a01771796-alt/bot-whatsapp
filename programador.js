// ============================================================
// programador.js
// ------------------------------------------------------------
// El "cron casero" del bot: cada CIERTOS minutos revisa los eventos
// programados y manda los recordatorios/solicitudes de reseña que les
// toquen (ver recordatorios.js y seguimientoPostEvento.js -- ahi vive la
// logica de CUANDO le toca a cada evento; aqui solo esta el "orquestador"
// que los llama).
//
// Motor A y Motor B son INDEPENDIENTES: cada uno revisa su propia bandera
// ACTIVAR_... y no hace nada si esta apagado (ver activo() en cada archivo),
// asi que un giro puede activar solo Motor B (ej. una cafeteria, sin
// horario real) sin que haga falta tocar nada de este archivo.
//
// Se corre como un setInterval DENTRO del mismo proceso del servidor -- en
// vez de un servicio de cron aparte en el hosting. Para que esto funcione
// bien, el servicio NO debe tener activado "sleep"/hibernacion: si el
// proceso se duerme, este timer se pausa y los avisos se mandan tarde.
//
// Anti corridas encimadas: si una corrida tarda mas que el intervalo (ej.
// por muchos eventos o WhatsApp lento), el candado "procesando" evita que
// arranque una segunda corrida antes de que termine la primera -- esa
// corrida nueva simplemente se salta, no se pierde nada porque los eventos
// que sigan pendientes se vuelven a revisar en el siguiente ciclo.
//
// crearProgramador(gestorEventos, opciones) es una FABRICA: cada giro crea
// su propio programador apuntando al gestor de eventos que le corresponda
// (ver eventoProgramado.js) y, si usa Motor B, a su propia forma de leer la
// informacion del negocio (link de reseña).
// ============================================================

const { procesarRecordatorios } = require('./recordatorios');
const { procesarSolicitudesDeResena } = require('./seguimientoPostEvento');

const INTERVALO_MIN = 10;

// opciones.obtenerInfoNegocioCsv: funcion async que regresa el CSV crudo de
// la informacion del negocio (solo hace falta si el giro activa Motor B; si
// no se da y Motor B esta activo, procesarSolicitudesDeResena lo reportara
// al intentar usarla). opciones.intervaloMin: cada cuantos minutos corre el
// ciclo (por defecto 10, igual que salones-belleza).
function crearProgramador(gestorEventos, opciones = {}) {
  const obtenerInfoNegocioCsv = opciones.obtenerInfoNegocioCsv || (async () => '');
  const intervaloMin = opciones.intervaloMin || INTERVALO_MIN;

  let procesando = false;

  async function cicloDeSeguimiento() {
    if (procesando) {
      console.warn('PROGRAMADOR: la corrida anterior de recordatorios/reseñas todavia no termina, se salta este ciclo.');
      return;
    }

    procesando = true;
    try {
      await procesarRecordatorios(gestorEventos);
      await procesarSolicitudesDeResena(gestorEventos, obtenerInfoNegocioCsv);
    } catch (error) {
      // No deberia pasar (cada modulo ya atrapa sus propios errores por
      // evento individual), pero si algo se escapa, no tumbamos el
      // intervalo por esto.
      console.error('PROGRAMADOR: error inesperado en el ciclo de seguimiento:', error);
    } finally {
      procesando = false;
    }
  }

  function iniciarProgramador() {
    // Avisos que se quedaron en ENVIANDO por un crash/redeploy: se reintentan
    // (maximo 2 intentos) o quedan FALLIDO 'interrumpido' -- ver eventoProgramado.js.
    try {
      const { reintentar, fallidos } = gestorEventos.recuperarEnviandoInterrumpidos();
      if (reintentar || fallidos) {
        console.warn(`PROGRAMADOR: avisos interrumpidos al arrancar -- ${reintentar} a reintentar, ${fallidos} marcados FALLIDO.`);
      }
    } catch (error) {
      console.error('PROGRAMADOR: no se pudieron recuperar los avisos interrumpidos:', error.message);
    }

    setInterval(cicloDeSeguimiento, intervaloMin * 60 * 1000);
    console.log(`Programador de recordatorios/reseñas iniciado (revisa cada ${intervaloMin} minutos).`);
  }

  // cicloDeSeguimiento se exporta aparte de iniciarProgramador para poder
  // probarlo directamente en pruebas automatizadas sin tener que esperar
  // minutos reales a que dispare un setInterval.
  return { iniciarProgramador, cicloDeSeguimiento };
}

module.exports = { crearProgramador };
