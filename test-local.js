// ============================================================
// test-local.js
// ------------------------------------------------------------
// Script SOLO PARA PROBAR el "cerebro" del bot (la parte de la IA)
// desde tu propia computadora, en la terminal, SIN necesitar todavia
// una cuenta de WhatsApp/Meta ni un Google Sheet real.
//
// Usa un negocio de prueba (dummy-negocio.txt) con datos falsos, y un
// archivo de ejemplo de "casos aprendidos" (dummy-aprendizaje.txt) para
// que veas como el bot usa respuestas que antes se le hubieran tenido
// que ensenar a mano.
//
// Cuando un caso se escala, aqui TAMBIEN se crea un ticket de verdad en
// tickets.json (no solo se imprime en pantalla) -- asi puedes correr
// despues "node index.js" y abrir /tickets en tu navegador para ver el
// dashboard con datos reales de tu propia prueba.
//
// Lo unico que SI necesitas ya configurado en tu archivo .env es:
//   ANTHROPIC_API_KEY=tu_llave_real_de_anthropic
//
// Como se usa:
//   1) node test-local.js
//   2) Escribe preguntas como si fueras un cliente del cafe de prueba
//      (ej: "cual es su horario?", "quiero 2 cafes para llevar, soy Ana")
//   3) Para salir, escribe "salir" y da Enter.
// ============================================================

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { preguntarAClaude } = require('./claude');
const { contieneContenidoGrave, RESPUESTA_NEUTRAL_PARA_EL_CLIENTE } = require('./seguridad');
const { crearTicket } = require('./tickets');

const contextoNegocio = fs.readFileSync(path.join(__dirname, 'dummy-negocio.txt'), 'utf8');
const casosAprendidos = fs.readFileSync(path.join(__dirname, 'dummy-aprendizaje.txt'), 'utf8');

const CLIENTE_DE_PRUEBA = '000_cliente_demo'; // No es un numero real, solo una etiqueta para la prueba.

const historial = [];

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// Bandera para saber si ya se cerró la conversación (por "salir" o porque se
// acabó la entrada). Evita un error feo si intentamos preguntar de nuevo
// después de cerrado.
let cerrado = false;
rl.on('close', () => {
  cerrado = true;
});

function mostrarTicketCreado(ticket) {
  console.log(`[🎫 Se creó el ticket ${ticket.id} — categoría ${ticket.categoria}, prioridad ${ticket.prioridad}]`);
  console.log('[Esto es lo que le llegaría al dueño por WhatsApp: aviso con links para marcarlo "en revisión" / "resuelto"]\n');
}

console.log('============================================');
console.log(' DEMO LOCAL - Bot de "Café La Esquina" (prueba)');
console.log('============================================');
console.log('Escribe como si fueras un cliente. Para salir: "salir"\n');

function preguntarSiguiente() {
  rl.question('Tú (cliente): ', async (texto) => {
    if (texto.trim().toLowerCase() === 'salir') {
      rl.close();
      return;
    }

    historial.push({ rol: 'cliente', texto });

    // Misma red de seguridad que usa el bot real (ver seguridad.js): esto se
    // revisa ANTES de la IA, para amenazas/autolesion/contenido grave.
    if (contieneContenidoGrave(texto)) {
      console.log(`\nBot: ${RESPUESTA_NEUTRAL_PARA_EL_CLIENTE}\n`);
      const ticket = crearTicket({
        numeroCliente: CLIENTE_DE_PRUEBA,
        categoria: 'SEGURIDAD',
        esUrgente: true,
        solicitud: texto,
        respuestaEnviada: RESPUESTA_NEUTRAL_PARA_EL_CLIENTE,
      });
      mostrarTicketCreado(ticket);
      if (!cerrado) preguntarSiguiente();
      return;
    }

    try {
      const respuesta = await preguntarAClaude({ contextoNegocio, casosAprendidos, historial });

      // Si la IA misma detecto algo urgente (aunque el filtro de palabras clave no lo
      // haya visto), lo tratamos igual que si lo hubiera detectado el filtro.
      if (respuesta.esUrgente) {
        historial.push({ rol: 'bot', texto: RESPUESTA_NEUTRAL_PARA_EL_CLIENTE });
        console.log(`\nBot: ${RESPUESTA_NEUTRAL_PARA_EL_CLIENTE}\n`);
        const ticket = crearTicket({
          numeroCliente: CLIENTE_DE_PRUEBA,
          categoria: respuesta.categoria || 'SEGURIDAD',
          esUrgente: true,
          solicitud: texto,
          respuestaEnviada: RESPUESTA_NEUTRAL_PARA_EL_CLIENTE,
        });
        mostrarTicketCreado(ticket);
        if (!cerrado) preguntarSiguiente();
        return;
      }

      // Nunca mostramos/mandamos un mensaje vacío aunque la IA falle en darnos texto.
      const textoParaElCliente = respuesta.textoParaElCliente ||
        'Gracias por tu mensaje, en un momento te contesta alguien del negocio.';

      historial.push({ rol: 'bot', texto: textoParaElCliente });

      console.log(`\nBot: ${textoParaElCliente}\n`);

      if (respuesta.esPedidoCompleto) {
        console.log(`[Esto es lo que le llegaría al dueño por WhatsApp -> PEDIDO: ${respuesta.detallePedido}]\n`);
      }

      if (respuesta.necesitaHumano) {
        const ticket = crearTicket({
          numeroCliente: CLIENTE_DE_PRUEBA,
          categoria: respuesta.categoria || 'OTRO',
          esUrgente: false,
          solicitud: texto,
          respuestaEnviada: textoParaElCliente,
        });
        mostrarTicketCreado(ticket);
      }
    } catch (error) {
      console.error('\n⚠️  Hubo un error hablando con Claude:', error.message);
      console.error('Revisa que ANTHROPIC_API_KEY esté bien puesto en tu archivo .env\n');
    }

    if (!cerrado) preguntarSiguiente();
  });
}

preguntarSiguiente();
