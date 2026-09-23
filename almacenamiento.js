// ============================================================
// almacenamiento.js
// ------------------------------------------------------------
// Punto unico para decidir DONDE se guardan los archivos .json que el
// bot escribe en tiempo de ejecucion (tickets.json, pedidos.json,
// casos-dificiles.json).
//
// En Railway, el disco del contenedor es TEMPORAL: se borra en cada
// redeploy o cada vez que el contenedor se reinicia por un crash. Por
// eso el proyecto tiene un Volume (disco persistente) conectado, y
// Railway pone automaticamente la variable de entorno
// RAILWAY_VOLUME_MOUNT_PATH con la carpeta que SI sobrevive entre
// despliegues -- ahi es donde hay que escribir estos archivos.
//
// En desarrollo local (sin volume, esa variable no existe) simplemente
// se usa la carpeta del proyecto, como siempre.
// ============================================================

const fs = require('fs');
const path = require('path');

const RESPALDOS_A_CONSERVAR = 7;

function carpetaDeDatos() {
  return process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname;
}

function rutaArchivoDatos(nombreArchivo) {
  return path.join(carpetaDeDatos(), nombreArchivo);
}

// Carpeta de respaldos diarios: "respaldos" dentro de la carpeta de datos
// (en Railway, el Volume -- ej. /data/respaldos).
function carpetaRespaldos() {
  return path.join(carpetaDeDatos(), 'respaldos');
}

function fechaDeHoyParaRespaldo() {
  const zona = process.env.ZONA_HORARIA || 'America/Mexico_City';
  return new Intl.DateTimeFormat('en-CA', { timeZone: zona }).format(new Date()); // YYYY-MM-DD
}

// Antes de la PRIMERA escritura del dia sobre un archivo, guarda una copia de
// como estaba en respaldos/<nombre>.<YYYY-MM-DD>.json y borra las copias mas
// viejas, dejando solo las ultimas RESPALDOS_A_CONSERVAR. Si el respaldo
// falla, se loguea y la escritura sigue: un respaldo caido no debe tumbar el bot.
function respaldarSiHaceFalta(rutaArchivo) {
  try {
    if (!fs.existsSync(rutaArchivo)) return;

    const base = path.basename(rutaArchivo, '.json');
    const carpeta = carpetaRespaldos();
    const destino = path.join(carpeta, `${base}.${fechaDeHoyParaRespaldo()}.json`);
    if (fs.existsSync(destino)) return;

    fs.mkdirSync(carpeta, { recursive: true });
    fs.copyFileSync(rutaArchivo, destino);

    const esCopiaDeEsteArchivo = (nombre) =>
      nombre.startsWith(`${base}.`) && /^\d{4}-\d{2}-\d{2}\.json$/.test(nombre.slice(base.length + 1));
    const copias = fs.readdirSync(carpeta).filter(esCopiaDeEsteArchivo).sort();
    for (const vieja of copias.slice(0, Math.max(0, copias.length - RESPALDOS_A_CONSERVAR))) {
      fs.unlinkSync(path.join(carpeta, vieja));
    }
  } catch (error) {
    console.error(`ALMACENAMIENTO: no se pudo respaldar ${rutaArchivo}:`, error.message);
  }
}

// Escribe en un archivo temporal y lo renombra sobre el definitivo: si el
// proceso se muere a media escritura, el archivo real queda intacto (nunca
// a medias). rename es atomico dentro de la misma carpeta.
function escribirArchivoDatos(rutaArchivo, contenido) {
  respaldarSiHaceFalta(rutaArchivo);

  const temporal = `${rutaArchivo}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporal, contenido);
    fs.renameSync(temporal, rutaArchivo);
  } catch (error) {
    try { fs.unlinkSync(temporal); } catch { /* no existia */ }
    throw error;
  }
}

module.exports = { rutaArchivoDatos, escribirArchivoDatos, carpetaRespaldos, RESPALDOS_A_CONSERVAR };
