import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getTripLogistics } from './trip-logistics';

test('logistics leaves empty confirmed sections empty even when itinerary has transport events', () => {
  const trip = { accommodations: [], transport: [], days: [{ events: [{ title: 'Черновой автобус' }] }] };
  assert.deepEqual(getTripLogistics(trip), { accommodations: [], transport: [] });
});

test('logistics keeps input order and uses only the supplied endpoints, dates and details', () => {
  const result = getTripLogistics({
    accommodations: [
      { id: 'a', name: 'Отель', location: 'Казань', date_from: '2026-11-19', date_to: null, notes: 'Общий вариант' }
    ],
    transport: [
      { id: 'later', mode: 'Трансфер', origin: null, destination: 'Казань', departure_at: null,
        arrival_at: '2026-11-19T08:00:00+03:00', notes: null },
      { id: 'sooner', mode: 'поезд', origin: 'Москва', destination: 'Казань', departure_at: null,
        arrival_at: null, notes: 'Без номера рейса' }
    ]
  });
  assert.deepEqual(result.accommodations, [
    { id: 'a', label: 'Отель · Казань', timing: 'Заезд: 19 ноября 2026 г.', notes: 'Общий вариант' }
  ]);
  assert.deepEqual(result.transport, [
    { id: 'later', label: 'Куда: Казань · Трансфер', timing: 'Прибытие: 19 ноября 2026 г. · 05:00 UTC', notes: null },
    { id: 'sooner', label: 'Москва → Казань · поезд', timing: null, notes: 'Без номера рейса' }
  ]);
});

test('logistics keeps zone-less or invalid timestamps unknown and omits blank details', () => {
  const result = getTripLogistics({ accommodations: [], transport: [
    { id: 'one', mode: 'поезд', origin: ' ', destination: null, departure_at: '2026-11-19T09:30',
      arrival_at: 'invalid', notes: '  ' }
  ] });
  assert.deepEqual(result.transport, [{ id: 'one', label: 'поезд', timing: null, notes: null }]);
});
