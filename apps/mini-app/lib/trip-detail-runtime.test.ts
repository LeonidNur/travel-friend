import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sectionState } from '../components/TripDraftFields';
import type { TripDraftContent } from './backend-api-client';

import type * as TripDetailRuntimeModule from './trip-detail-runtime';

const {
  formatTripBudget,
  formatTripDetailDates,
  formatTripParticipants,
  formatTripRouteStops,
  getTripDetailScreenState,
  getTripOverviewData
}: typeof TripDetailRuntimeModule = await import(new URL('./trip-detail-runtime.ts', import.meta.url).href);

test('builds the route from persisted stops in their returned order', () => {
  assert.equal(
    formatTripRouteStops([{ place_label: 'Tokyo' }, { place_label: 'Kyoto' }]),
    'Tokyo → Kyoto'
  );
  assert.equal(formatTripRouteStops([]), null);
});

test('uses only backend participant display names', () => {
  assert.deepEqual(
    formatTripParticipants([
      { display_name: 'Алина' },
      { display_name: null },
      { display_name: '  Мария  ' }
    ]),
    ['Алина', 'Мария']
  );
});

test('renders dates and budget only from persisted values', () => {
  assert.equal(formatTripDetailDates('2026-10-01', '2026-10-10'), '1 октября 2026 г. — 10 октября 2026 г.');
  assert.equal(formatTripDetailDates(null, null), null);
  assert.equal(
    formatTripBudget({ min: '1200.00', max: '1500.00', currency: 'RUB', scope: 'per_person' }),
    '1\u00a0200,00–1\u00a0500,00 RUB · на человека'
  );
  assert.equal(formatTripBudget({ min: null, max: null, currency: 'RUB', scope: null }), null);
});

test('selects loading, error, not-found, and success detail states', () => {
  assert.equal(getTripDetailScreenState({ isLoading: true, hasError: false, errorStatus: null, detail: null }), 'loading');
  assert.equal(getTripDetailScreenState({ isLoading: false, hasError: true, errorStatus: 500, detail: null }), 'error');
  assert.equal(getTripDetailScreenState({ isLoading: false, hasError: true, errorStatus: 404, detail: null }), 'not_found');
  assert.equal(getTripDetailScreenState({ isLoading: false, hasError: false, errorStatus: null, detail: {} }), 'success');
});

const empty: TripDraftContent = {
  route_stops: [], date_from: null, date_to: null, accommodations: [], transport: [],
  budget: { min: null, max: null, currency: null, scope: null }, days: [], notes: ''
};
const stop = (label: string) => ({
  id: label, place_label: label, place_ref: null, country_code: null, stay_from: null, stay_to: null, notes: null
});
const day = (id: string, title: string | null) => ({ id, title, date: null, notes: null, events: [] });
const snapshot = (content: TripDraftContent, version = 2) => ({ content, version });

test('compact Draft summaries distinguish real edits from identical values without repeating section headings', () => {
  const counts = (days: readonly { id: string; title: string }[]) => days.length ? `${days.length} день` : null;
  const confirmed = [{ id: 'day', title: 'Москва' }];
  assert.equal(sectionState('', [{ title: 'Москва', id: 'day' }], confirmed, undefined, counts),
    'Согласовано · 1 день');
  assert.equal(sectionState('', [{ id: 'day', title: 'Казань' }], confirmed, undefined, counts),
    'Согласовано · 1 день · Есть правки в черновике');
});

test('only a forming trip with loaded empty plans uses the new-trip composition', () => {
  assert.equal(getTripOverviewData('forming', 'loaded', empty, snapshot(empty)).mode, 'new');
  assert.equal(getTripOverviewData('forming', 'loading', empty, snapshot(empty)).mode, 'standard');
  assert.equal(getTripOverviewData('forming', 'error', empty, snapshot(empty)).mode, 'standard');
  assert.equal(getTripOverviewData('forming', 'loaded', empty, undefined).mode, 'standard');
  assert.equal(getTripOverviewData('completed', 'loaded', empty, snapshot(empty)).mode, 'standard');
  const draftFirstDay = { ...empty, days: [day('first', 'Первый день')] };
  assert.equal(getTripOverviewData('forming', 'loaded', empty, snapshot(draftFirstDay)).mode, 'partial');
});

test('partial overview distinguishes stable day IDs and isolates draft route edits and deletions', () => {
  const first = day('first', 'Санкт-Петербург');
  const confirmed = { ...empty, route_stops: [stop('Москва'), stop('Санкт-Петербург')], days: [first, day('third', 'Третий')] };
  const second = day('second', 'Санкт-Петербург');
  const persisted = { ...confirmed, route_stops: [stop('Выборг')], days: [{ ...first, title: 'Новый заголовок' }, second] };
  const data = getTripOverviewData('forming', 'loaded', confirmed, snapshot(persisted));
  assert.equal(data.mode, 'partial');
  assert.deepEqual(data.changedSections, ['route']);
  assert.deepEqual(data.draftDays.map(({ day, number, existing }) => [day.id, number, existing]), [
    ['first', 1, true], ['second', 2, false]
  ]);
  assert.deepEqual(data.removedDayNumbers, [2]);
  assert.equal(confirmed.days[0].title, 'Санкт-Петербург');
  assert.equal(getTripOverviewData('forming', 'loaded', confirmed, snapshot(empty, 1)).mode, 'standard');
});

test('range grouping uses consecutive confirmed positions with an unambiguous exact place name', () => {
  const confirmed = { ...empty, route_stops: [stop('Сидней'), stop('Кэрнс'), stop('Кэрнс')], days: [
    day('d1', 'Сидней'), day('d2', ' Сидней '), day('d3', 'Прогулка по Сиднею'),
    day('d4', 'Сидней'), day('d5', 'Кэрнс'), day('d6', null)
  ] };
  const draft = snapshot({ ...confirmed, days: [...confirmed.days, day('draft', 'Сидней')] });
  const data = getTripOverviewData('active', 'loaded', confirmed, draft);
  assert.equal(data.mode, 'complex');
  assert.deepEqual(data.ranges.map(({ first, last, place }) => [first, last, place]), [
    [1, 2, 'Сидней'], [3, 3, null], [4, 4, 'Сидней'], [5, 6, null]
  ]);
  assert.equal(data.draftDays[0].day.id, 'draft');
});

test('overview ignores decimal representation while distinguishing actual budget and event costs', () => {
  const event = {
    id: 'museum', kind: 'activity' as const, title: 'Музей', start_time: null, duration_minutes: null,
    address: null, estimated_cost: '50.00', currency: 'RUB', notes: null
  };
  const confirmed = {
    ...empty, budget: { ...empty.budget, min: '18000.00' },
    days: [{ ...day('one', 'Первый'), events: [event] }]
  };
  const equivalent = {
    ...confirmed, budget: { ...confirmed.budget, min: '18000' },
    days: [{ ...confirmed.days[0], events: [{ ...event, estimated_cost: '50' }] }]
  };
  assert.equal(getTripOverviewData('forming', 'loaded', confirmed, snapshot(equivalent)).mode, 'standard');
  const budgetChange = { ...equivalent, budget: { ...equivalent.budget, min: '18500' } };
  assert.deepEqual(getTripOverviewData('forming', 'loaded', confirmed, snapshot(budgetChange)).changedSections, ['budget']);
});

test('overview recognizes draft day reordering and numbers proposed tiles in draft order', () => {
  const first = day('a', 'Первый');
  const second = day('b', 'Второй');
  const confirmed = { ...empty, days: [first, second] };
  const reordered = { ...confirmed, days: [second, first] };
  const data = getTripOverviewData('forming', 'loaded', confirmed, snapshot(reordered));
  assert.equal(data.mode, 'partial');
  assert.equal(data.daysReordered, true);
  const inserted = { ...confirmed, days: [first, day('x', 'Вставка'), { ...second, title: 'Правка' }] };
  assert.deepEqual(getTripOverviewData('forming', 'loaded', confirmed, snapshot(inserted)).draftDays.map(({ number }) => number), [2, 3]);
});
