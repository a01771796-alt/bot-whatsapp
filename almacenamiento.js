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

const path = require('path');

function rutaArchivoDatos(nombreArchivo) {
  const carpetaDatos = process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname;
  return path.join(carpetaDatos, nombreArchivo);
}

module.exports = { rutaArchivoDatos };
