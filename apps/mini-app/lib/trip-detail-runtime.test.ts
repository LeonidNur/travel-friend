import assert from 'node:assert/strict';
import { test } from 'node:test';

import type * as TripDetailRuntimeModule from './trip-detail-runtime';

const {
  formatTripBudget,
  formatTripDetailDates,
  formatTripParticipants,
  formatTripRouteStops,
  getTripDetailScreenState
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
  assert.equal(formatTripDetailDates('2026-10-01', '2026-10-10'), '2026-10-01 — 2026-10-10');
  assert.equal(formatTripDetailDates(null, null), null);
  assert.equal(
    formatTripBudget({ min: '1200.00', max: '1500.00', currency: 'RUB', scope: 'per_person' }),
    '1200.00–1500.00 RUB · на человека'
  );
  assert.equal(formatTripBudget({ min: null, max: null, currency: 'RUB', scope: null }), null);
});

test('selects loading, error, not-found, and success detail states', () => {
  assert.equal(getTripDetailScreenState({ isLoading: true, hasError: false, errorStatus: null, detail: null }), 'loading');
  assert.equal(getTripDetailScreenState({ isLoading: false, hasError: true, errorStatus: 500, detail: null }), 'error');
  assert.equal(getTripDetailScreenState({ isLoading: false, hasError: true, errorStatus: 404, detail: null }), 'not_found');
  assert.equal(getTripDetailScreenState({ isLoading: false, hasError: false, errorStatus: null, detail: {} }), 'success');
});
