import assert from 'node:assert/strict';
import test from 'node:test';

import type { TripDraftContent } from './backend-api-client';
import { getInlineProposalTitle, validateTripDraftForProposal } from './trip-inline-editing';

const emptyContent: TripDraftContent = {
  route_stops: [], date_from: null, date_to: null, accommodations: [], transport: [],
  budget: { min: null, max: null, currency: null, scope: null }, days: [], notes: ''
};

test('generates a readable title from the exact requested scope', () => {
  assert.equal(getInlineProposalTitle('budget'), 'Изменение бюджета');
  assert.equal(getInlineProposalTitle('itinerary:day:day-1', 'День в Казани'), 'Изменение: День в Казани');
  assert.equal(getInlineProposalTitle('itinerary:event:day-1:event-1', 'Музей'), 'Изменение: Музей');
});

test('accepts an empty draft as the first proposal for any supported section', () => {
  assert.deepEqual(validateTripDraftForProposal(emptyContent), []);
});

test('validates only user-correctable draft issues before saving', () => {
  const invalid: TripDraftContent = {
    ...emptyContent,
    date_from: '2026-08-12', date_to: '2026-08-10',
    budget: { min: '200', max: '100', currency: 'RUB', scope: 'per_person' },
    route_stops: [{ id: 'route-1', place_label: ' ', country_code: null, place_ref: null, stay_from: null, stay_to: null, notes: null }],
    accommodations: [{ id: 'stay-1', name: '', location: null, date_from: null, date_to: null, notes: null }],
    transport: [{ id: 'transport-1', mode: '', origin: null, destination: null, departure_at: null, arrival_at: null, notes: null }],
    days: [{ id: 'day-1', date: null, title: null, notes: null, events: [
      { id: 'event-1', kind: 'activity', title: ' ', start_time: null, duration_minutes: null, address: null, estimated_cost: null, currency: null, notes: null }
    ] }]
  };
  assert.deepEqual(validateTripDraftForProposal(invalid), [
    'Дата окончания должна быть не раньше даты начала.',
    'Максимальный бюджет должен быть не меньше минимального.',
    'Укажите место маршрута перед отправкой предложения.',
    'Укажите название проживания перед отправкой предложения.',
    'Укажите вид транспорта перед отправкой предложения.',
    'У каждого события должно быть название.'
  ]);
});
