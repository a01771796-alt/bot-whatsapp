// ============================================================
// eventoProgramado.js
// ------------------------------------------------------------
// Modelo GENERICO de "evento programado": cualquier interaccion con el
// negocio que tiene un estado que avanza con el tiempo y, opcionalmente,
// una fecha/hora real (una cita, una clase, una reserva, un pedido con hora
// de entrega...). Inspirado en citas.js de salones-belleza, pero sin nada
// especifico de citas de salon.
//
// A proposito NO incluye la logica de AGENDA (horario de atencion del
// negocio, deteccion de horarios libres/ocupados, calculo de disponibilidad)
// -- esa parte varia demasiado entre giros (un salon calcula huecos libres
// dentro de un horario de atencion; un gimnasio tiene un horario de clases
// YA publicado y fijo; una cafeteria ni siquiera agenda, solo registra a que
// hora se recoge). Cada giro que necesite eso lo implementa por su cuenta,
// reusando si le sirve las utilidades de fecha/hora de aqui abajo.
//
// Lo que SI es comun a cualquier giro con eventos programados, y por eso
// vive aqui:
//   - CRUD del evento: crear, leer, cambiar estado, registrar la respuesta
//     del cliente a un aviso, marcar como completado.
//   - El registro de "seguimiento" por evento: un objeto LIBRE donde
//     recordatorios.js (Motor A) y seguimientoPostEvento.js (Motor B)
//     anotan el estado de cada aviso que le toca mandar. Este archivo no
//     valida que claves de seguimiento son validas -- cuantas ventanas de
//     recordatorio existen lo decide cada giro en su .env (ver
//     recordatorios.js), este modulo no necesita saberlo.
//   - Utilidades de fecha/hora en la zona horaria del negocio (configurable
//     con ZONA_HORARIA en el .env; default America/Mexico_City) -- las usa
//     Motor A para calcular cuanto falta para el evento.
//
// crearGestorDeEventos(opciones) es una FABRICA (mismo patron que
// crearDescargadorConCache en csv.js): cada giro crea su propio gestor
// apuntando a su propio archivo JSON. Esto importa cuando un mismo proyecto
// tiene MAS de un tipo de evento y solo uno de ellos debe llevar los
// motores -- ej. gimnasios: "reserva de clase" (con motores) vive en un
// archivo, "inscripcion a membresia" (sin motores, ni siquiera pasa por
// aqui) vive aparte.
// ============================================================

const fs = require('fs');
const { rutaArchivoDatos, escribirArchivoDatos } = require('./almacenamiento');

const ZONA_HORARIA = process.env.ZONA_HORARIA || 'America/Mexico_City';

const MINUTOS_ENVIANDO_INTERRUMPIDO = 10;
const MAX_INTENTOS_AVISO = 2;

const NOMBRES_DIA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const NOMBRES_MES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

// Estados por los que puede pasar un evento. Cada giro decide cuales de
// estos usa de verdad (ej. un pedido de cafeteria probablemente nunca pasa
// por CONFIRMADA) -- este archivo no obliga a usarlos todos.
const ESTADOS = ['PENDIENTE', 'CONFIRMADA', 'COMPLETADA', 'CANCELADA', 'NO_SHOW'];

// --- Utilidades de fecha/hora (zona horaria del negocio) -------------------
// Mismo criterio que citas.js: todo el calculo de "hoy" y "cuanto falta" se
// hace en la zona horaria del negocio, sin importar en que zona horaria este
// corriendo el servidor de hosting.

function hoyISO() {
  return new Date().toLocaleDateString('en-CA', { timeZone: ZONA_HORARIA }); // 'en-CA' = formato AAAA-MM-DD
}

function horaActualHHMM() {
  return new Date().toLocaleTimeString('en-GB', {
    timeZone: ZONA_HORARIA,
    hour: '2-digit',
    minute: '2-digit',
  });
}

function horaActualEnMinutos() {
  const [horas, minutos] = horaActualHHMM().split(':').map(Number);
  return horas * 60 + minutos;
}

function fechaComoUtc(fechaISO) {
  const [anio, mes, dia] = fechaISO.split('-').map(Number);
  return new Date(Date.UTC(anio, mes - 1, dia));
}

function diaDeLaSemana(fechaISO) {
  return fechaComoUtc(fechaISO).getUTCDay();
}

function sumarDias(fechaISO, cantidad) {
  const fecha = fechaComoUtc(fechaISO);
  fecha.setUTCDate(fecha.getUTCDate() + cantidad);
  return fecha.toISOString().slice(0, 10);
}

function horaAMinutos(horaHHMM) {
  const [horas, minutos] = horaHHMM.split(':').map(Number);
  return horas * 60 + (minutos || 0);
}

function minutosAHora(minutos) {
  const horas = Math.floor(minutos / 60).toString().padStart(2, '0');
  const mins = (minutos % 60).toString().padStart(2, '0');
  return `${horas}:${mins}`;
}

// Offset (en minutos) de ZONA_HORARIA respecto a UTC para un instante
// especifico -- no se asume un numero fijo porque eso se rompe si algun dia
// vuelve el horario de verano, o si esta plantilla se reusa en otro pais con
// reglas distintas. Trata "fechaISO+horaHHMM" como si fueran UTC, las
// formatea EN la zona del negocio, y la diferencia entre ambas lecturas es
// el offset real de esa zona para ese momento.
function obtenerOffsetMinutos(fechaISO, horaHHMM) {
  const comoSiFueraUtc = new Date(`${fechaISO}T${horaHHMM}:00Z`);
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: ZONA_HORARIA,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(comoSiFueraUtc);

  const valor = {};
  for (const { type, value } of partes) valor[type] = value;
  const hora24 = valor.hour === '24' ? 0 : Number(valor.hour);

  const comoSiFueraLocal = Date.UTC(
    Number(valor.year), Number(valor.month) - 1, Number(valor.day),
    hora24, Number(valor.minute), Number(valor.second)
  );

  return (comoSiFueraLocal - comoSiFueraUtc.getTime()) / 60000;
}

// Instante real (UTC) de un evento, dada su fecha/hora en la zona horaria
// del negocio. Se usa SOLO para calcular cuanto falta para el evento
// (recordatorios, ver recordatorios.js).
function eventoComoFechaUtc(fechaISO, horaHHMM) {
  const comoSiFueraUtc = new Date(`${fechaISO}T${horaHHMM}:00Z`);
  const offsetMin = obtenerOffsetMinutos(fechaISO, horaHHMM);
  return new Date(comoSiFueraUtc.getTime() - offsetMin * 60000);
}

// Minutos que faltan para un evento (negativo si ya paso), calculado en la
// zona horaria del negocio. La usa recordatorios.js para decidir cuando le
// toca a cada ventana de recordatorio configurada.
function minutosHastaEvento(fechaISO, horaHHMM) {
  const fechaEvento = eventoComoFechaUtc(fechaISO, horaHHMM);
  return Math.round((fechaEvento.getTime() - Date.now()) / 60000);
}

// Verdadero si la fecha/hora dada ya paso (es antes de "ahora" en la zona
// horaria del negocio).
function fechaHoraYaPaso(fechaISO, horaHHMM) {
  const hoy = hoyISO();
  if (fechaISO < hoy) return true;
  if (fechaISO > hoy) return false;
  return horaAMinutos(horaHHMM) <= horaActualEnMinutos();
}

function formatearFechaLarga(fechaISO) {
  const [anio, mes, dia] = fechaISO.split('-').map(Number);
  return `${NOMBRES_DIA[diaDeLaSemana(fechaISO)].toLowerCase()} ${dia} de ${NOMBRES_MES[mes - 1]} de ${anio}`;
}

function formatearFechaCorta(fechaISO) {
  const [anio, mes, dia] = fechaISO.split('-').map(Number);
  return `${dia}/${mes}/${anio}`;
}

// --- Fabrica del gestor de eventos -----------------------------------------

function generarIdEvento(prefijo, numeroDeEvento) {
  const ahora = new Date();
  const fecha = ahora.toISOString().slice(0, 10).replace(/-/g, '');
  const hora = ahora.toTimeString().slice(0, 8).replace(/:/g, '');
  return `${prefijo}-${fecha}-${hora}-${numeroDeEvento}`;
}

// opciones.archivo: nombre del JSON donde se guardan estos eventos (por
// defecto "eventosProgramados.json"). opciones.prefijoId: prefijo del id
// generado para cada evento nuevo (por defecto "EVENTO", ej. "CLASE",
// "PEDIDO").
function crearGestorDeEventos(opciones = {}) {
  const archivo = opciones.archivo || 'eventosProgramados.json';
  const prefijoId = opciones.prefijoId || 'EVENTO';
  const ARCHIVO_EVENTOS = rutaArchivoDatos(archivo);

  function leerEventos() {
    if (!fs.existsSync(ARCHIVO_EVENTOS)) return [];
    try {
      return JSON.parse(fs.readFileSync(ARCHIVO_EVENTOS, 'utf8'));
    } catch {
      return []; // Si el archivo se corrompio, no tronamos el bot por esto.
    }
  }

  function guardarEventos(eventos) {
    escribirArchivoDatos(ARCHIVO_EVENTOS, JSON.stringify(eventos, null, 2));
  }

  // datos: { cliente, nombreCliente, tipo, descripcion, duracionMin, fecha,
  // hora, responsable, metadata }. "fecha"/"hora" son opcionales -- si un
  // giro no tiene horario real (ej. Motor B solo, sin Motor A), se dejan
  // null y Motor A simplemente nunca aplica a este evento (ver
  // recordatorios.js).
  function crearEvento(datos) {
    const eventos = leerEventos();

    const evento = {
      id: generarIdEvento(prefijoId, eventos.length + 1),
      creadaEn: new Date().toISOString(),
      cliente: datos.cliente,
      nombreCliente: datos.nombreCliente || '',
      tipo: datos.tipo || '',
      descripcion: datos.descripcion || 'Sin descripción',
      duracionMin: datos.duracionMin || null,
      fecha: datos.fecha || null,
      hora: datos.hora || null,
      responsable: datos.responsable || '',
      estado: 'PENDIENTE',
      respuestaCliente: null, // null | 'CONFIRMADA' | 'CANCELADA'
      completadaEn: null,
      seguimiento: {}, // lo llenan recordatorios.js / seguimientoPostEvento.js sobre la marcha
      metadata: datos.metadata || {},
    };

    eventos.push(evento);
    guardarEventos(eventos);
    return evento;
  }

  function actualizarEstadoEvento(id, estado) {
    const eventos = leerEventos();
    const evento = eventos.find((e) => e.id === id);
    if (!evento) return null;

    evento.estado = estado;
    // Se guarda UNA sola vez, la primera vez que se marca completado -- lo
    // usa seguimientoPostEvento.js para saber desde cuando contar la espera
    // antes de pedir la reseña.
    if (estado === 'COMPLETADA' && !evento.completadaEn) {
      evento.completadaEn = new Date().toISOString();
    }
    guardarEventos(eventos);
    return evento;
  }

  // Cambia el estado de un aviso de seguimiento puntual de un evento. "tipo"
  // es una clave libre (ej. "recordatorio1", "resena") que define quien la
  // llama -- este archivo no la valida. Se llama DOS veces por cada envio
  // real: una con 'ENVIANDO' ANTES de llamar a WhatsApp (para que quede
  // escrito en disco antes de que el mensaje de verdad salga) y otra con
  // 'ENVIADO'/'FALLIDO' justo despues, segun el resultado -- ver el
  // comentario grande en programador.js sobre por que este orden evita
  // mensajes duplicados.
  function actualizarSeguimiento(idEvento, tipo, estado) {
    const eventos = leerEventos();
    const evento = eventos.find((e) => e.id === idEvento);
    if (!evento) return null;

    if (!evento.seguimiento) evento.seguimiento = {};
    // "intentos" cuenta cuantas veces se ha empezado a mandar este aviso
    // (cada 'ENVIANDO' suma uno) -- lo usa recuperarEnviandoInterrumpidos.
    const previos = evento.seguimiento[tipo]?.intentos || 0;
    evento.seguimiento[tipo] = {
      estado,
      intentoEn: new Date().toISOString(),
      intentos: estado === 'ENVIANDO' ? previos + 1 : previos,
    };
    guardarEventos(eventos);
    return evento;
  }

  // Se llama UNA vez al arrancar el bot (ver programador.js). Un aviso que
  // quedo en 'ENVIANDO' hace mas de MINUTOS_ENVIANDO_INTERRUMPIDO minutos
  // se corto a medio envio (crash/redeploy): si aun no llega al maximo de
  // MAX_INTENTOS_AVISO intentos vuelve a 'PENDIENTE' para que el siguiente
  // ciclo lo reintente; si ya lo alcanzo, queda 'FALLIDO' con error
  // 'interrumpido'. Un registro viejo sin "intentos" cuenta como 1.
  // Regresa cuantos avisos reintentara y cuantos marco FALLIDO.
  function recuperarEnviandoInterrumpidos() {
    const eventos = leerEventos();
    const resultado = { reintentar: 0, fallidos: 0 };
    const ahora = Date.now();

    for (const evento of eventos) {
      for (const aviso of Object.values(evento.seguimiento || {})) {
        if (aviso.estado !== 'ENVIANDO') continue;
        const minutos = (ahora - new Date(aviso.intentoEn).getTime()) / 60000;
        if (!(minutos > MINUTOS_ENVIANDO_INTERRUMPIDO)) continue;

        const intentos = aviso.intentos || 1;
        aviso.intentos = intentos;
        if (intentos >= MAX_INTENTOS_AVISO) {
          aviso.estado = 'FALLIDO';
          aviso.error = 'interrumpido';
          resultado.fallidos++;
        } else {
          aviso.estado = 'PENDIENTE';
          resultado.reintentar++;
        }
      }
    }

    if (resultado.reintentar || resultado.fallidos) guardarEventos(eventos);
    return resultado;
  }

  // Guarda la respuesta del cliente a un recordatorio ("confirmo"/"cancelar",
  // ver la interpretacion en recordatorios.js). Si cancela, ademas se marca
  // el evento como CANCELADA.
  function registrarRespuestaCliente(idEvento, respuesta) {
    const eventos = leerEventos();
    const evento = eventos.find((e) => e.id === idEvento);
    if (!evento) return null;

    evento.respuestaCliente = respuesta; // 'CONFIRMADA' | 'CANCELADA'
    if (respuesta === 'CANCELADA') evento.estado = 'CANCELADA';
    guardarEventos(eventos);
    return evento;
  }

  // Guarda en el evento el resultado del aviso al dueno que regreso
  // avisarAlDueno (whatsapp.js): {estado: 'ENVIADO'|'FALLIDO', intentoEn,
  // error, via}. Va aparte de "seguimiento" (que solo guarda estado/intentoEn
  // de los recordatorios y reseñas) porque aqui tambien se guarda el error.
  // Un resultado 'OMITIDO' (no hay OWNER_WHATSAPP_NUMBER) no se guarda.
  // "campo" es donde se guarda: 'avisoDueno' por default (el aviso de evento
  // nuevo). Un giro que manda OTRO aviso sobre el mismo evento (ej. "el
  // cliente cancelo") usa su propio campo, para que un aviso exitoso no tape
  // a uno que fallo.
  function registrarAvisoDueno(idEvento, resultado, campo = 'avisoDueno') {
    if (!resultado || resultado.estado === 'OMITIDO') return null;

    const eventos = leerEventos();
    const evento = eventos.find((e) => e.id === idEvento);
    if (!evento) return null;

    evento[campo] = resultado;
    guardarEventos(eventos);
    return evento;
  }

  function obtenerEventos() {
    return leerEventos();
  }

  function obtenerEventoPorId(id) {
    return leerEventos().find((e) => e.id === id) || null;
  }

  // Guarda una copia de TODOS los eventos actuales en un archivo aparte,
  // ANTES de un borrado total (ej. /reiniciar en el dashboard) -- mismo
  // criterio que respaldarCitas() en salones-belleza, respaldarTickets() en
  // tickets.js y respaldarConversaciones() en conversaciones.js.
  function respaldarEventos(marcaDeTiempo) {
    const archivoRespaldo = rutaArchivoDatos(`respaldo_${archivo.replace(/\.json$/, '')}_${marcaDeTiempo}.json`);
    fs.writeFileSync(archivoRespaldo, JSON.stringify(leerEventos(), null, 2));
  }

  function vaciarEventos() {
    guardarEventos([]);
  }

  return {
    crearEvento,
    obtenerEventos,
    obtenerEventoPorId,
    actualizarEstadoEvento,
    actualizarSeguimiento,
    recuperarEnviandoInterrumpidos,
    registrarRespuestaCliente,
    registrarAvisoDueno,
    respaldarEventos,
    vaciarEventos,
  };
}

module.exports = {
  crearGestorDeEventos,
  ESTADOS,
  ZONA_HORARIA,
  hoyISO,
  horaActualHHMM,
  horaActualEnMinutos,
  diaDeLaSemana,
  sumarDias,
  horaAMinutos,
  minutosAHora,
  minutosHastaEvento,
  fechaHoraYaPaso,
  formatearFechaLarga,
  formatearFechaCorta,
  NOMBRES_DIA,
  NOMBRES_MES,
};
