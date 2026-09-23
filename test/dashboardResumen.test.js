const test = require('node:test');
const assert = require('node:assert/strict');
const { usarCarpetaDeDatosTemporal, borrarCarpeta } = require('./_testUtils');

const carpeta = usarCarpetaDeDatosTemporal();
test.after(() => borrarCarpeta(carpeta));

const { ordenarTickets, contarPedidosDelDia } = require('../dashboard');

test('ordenarTickets: ALTA primero y, dentro de cada prioridad, el mas reciente arriba', () => {
  const tickets = [
    { id: 'm-vieja', prioridad: 'MEDIA', fecha: '2026-09-20T10:00:00Z' },
    { id: 'a-vieja', prioridad: 'ALTA', fecha: '2026-09-20T09:00:00Z' },
    { id: 'm-nueva', prioridad: 'MEDIA', fecha: '2026-09-22T10:00:00Z' },
    { id: 'a-nueva', prioridad: 'ALTA', fecha: '2026-09-21T09:00:00Z' },
  ];
  assert.deepEqual(ordenarTickets(tickets).map((t) => t.id), ['a-nueva', 'a-vieja', 'm-nueva', 'm-vieja']);
  assert.equal(tickets[0].id, 'm-vieja', 'no debe mutar el arreglo original');
});

test('contarPedidosDelDia: pedidos de hoy en hora de Mexico, separados en entregados y pendientes', () => {
  const pedidos = [
    { creadaEn: '2026-09-23T15:00:00Z', estado: 'COMPLETADA' },
    { creadaEn: '2026-09-23T16:00:00Z', estado: 'PENDIENTE' },
    { creadaEn: '2026-09-24T05:00:00Z', estado: 'PENDIENTE' }, // 23:00 del 23 en CDMX
    { creadaEn: '2026-09-23T03:00:00Z', estado: 'PENDIENTE' }, // 21:00 del 22 en CDMX
    { creadaEn: '2026-09-23T17:00:00Z', estado: 'CANCELADA' },
  ];
  assert.deepEqual(contarPedidosDelDia(pedidos, '2026-09-23'), { entregados: 1, pendientes: 2 });
  assert.deepEqual(contarPedidosDelDia([], '2026-09-23'), { entregados: 0, pendientes: 0 });
});
