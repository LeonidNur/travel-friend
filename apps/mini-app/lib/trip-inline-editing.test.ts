import assert from 'node:assert/strict';
import test from 'node:test';

import type { TripDraftContent } from './backend-api-client';
import { buildDraftContentForScope, formatProposalValue, getDraftScopeSnapshot, getInlineProposalTitle, validateTripDraftForProposal } from './trip-inline-editing';

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

test('validating a budget Proposal ignores locally invalid dates in another section', () => {
  const local: TripDraftContent = { ...emptyContent, date_from: '2026-08-12', date_to: '2026-08-10', budget: { ...emptyContent.budget, min: '100', max: '200' } };
  assert.deepEqual(validateTripDraftForProposal(local, 'budget'), []);
  assert.match(validateTripDraftForProposal(local, 'dates')[0], /Дата окончания/);
});

test('builds a backend-valid Proposal save from persisted data plus only the selected scope', () => {
  const persisted: TripDraftContent = {
    ...emptyContent,
    date_from: '2026-08-01', date_to: '2026-08-08',
    budget: { min: '100', max: '200', currency: 'RUB', scope: 'per_person' },
    route_stops: [{ id: 'route-1', place_label: 'Казань', country_code: null, place_ref: null, stay_from: null, stay_to: null, notes: null }]
  };
  const local: TripDraftContent = {
    ...persisted,
    date_from: '2026-08-12', date_to: '2026-08-10',
    route_stops: [{ ...persisted.route_stops[0], place_label: 'Самара' }],
    budget: { min: '300', max: '500', currency: 'RUB', scope: 'per_person' },
    notes: 'Локальная заметка'
  };
  const scoped = buildDraftContentForScope(local, persisted, 'budget');
  assert.deepEqual(scoped.budget, local.budget);
  assert.deepEqual(scoped.route_stops, persisted.route_stops);
  assert.equal(scoped.date_from, persisted.date_from);
  assert.equal(scoped.notes, persisted.notes);
  assert.deepEqual(getDraftScopeSnapshot(local, 'route'), local.route_stops);
});

test('merges one selected day or event into the persisted itinerary without sibling edits', () => {
  const day = (id: string, title: string) => ({ id, date: null, title, notes: null, events: [] });
  const persisted: TripDraftContent = { ...emptyContent, days: [day('day-1', 'Первый'), day('day-2', 'Второй')] };
  const local: TripDraftContent = { ...persisted, days: [day('day-1', 'Изменённый первый'), day('day-2', 'Локально изменённый второй')] };
  const scoped = buildDraftContentForScope(local, persisted, 'itinerary:day:day-1');
  assert.deepEqual(scoped.days.map((item) => item.title), ['Изменённый первый', 'Второй']);
  assert.deepEqual(getDraftScopeSnapshot(local, 'itinerary:day:day-1'), day('day-1', 'Изменённый первый'));
});

test('formats Proposal snapshots as readable labels rather than JSON', () => {
  assert.equal(formatProposalValue({ min: '100', max: '200', currency: 'RUB', scope: 'per_person' }),
    'От: 100 · До: 200 · Валюта: RUB · На: на человека');
  assert.equal(formatProposalValue([{ place_label: 'Казань' }, { place_label: 'Самара' }]), 'Место: Казань; Место: Самара');
  assert.match(formatProposalValue([{ name: 'Отель', date_from: '2026-08-01', date_to: '2026-08-03' }]), /Начало: 2026-08-01 · Окончание: 2026-08-03/);
  assert.equal(formatProposalValue(null), 'Не указано');
});
