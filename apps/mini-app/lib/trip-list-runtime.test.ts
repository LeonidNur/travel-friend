import assert from 'node:assert/strict';
import { test } from 'node:test';

import type * as TripListRuntimeModule from './trip-list-runtime';

const { formatTripDates, formatTripRoute, getTripListScreenState, getPersistedTripStatusLabel }: typeof TripListRuntimeModule =
  await import(new URL('./trip-list-runtime.ts', import.meta.url).href);

test('uses route place labels as the direction in their persisted order', () => {
  assert.equal(formatTripRoute([' Москва ', 'Тбилиси']), 'Москва → Тбилиси');
});

test('does not invent a direction when a trip has no route stops', () => {
  assert.equal(formatTripRoute([]), null);
});

test('shows only persisted dates and statuses', () => {
  assert.equal(formatTripDates('2026-09-09', '2026-09-18'), '2026-09-09 — 2026-09-18');
  assert.equal(formatTripDates(null, null), null);
  assert.equal(getPersistedTripStatusLabel('forming'), 'Формируется');
  assert.equal(getPersistedTripStatusLabel('cancelled'), 'Отменена');
});

test('selects loading, error, empty, and success states for a trip list', () => {
  assert.equal(getTripListScreenState({ isLoading: true, error: null, trips: [] }), 'loading');
  assert.equal(getTripListScreenState({ isLoading: false, error: 'Request failed', trips: [] }), 'error');
  assert.equal(getTripListScreenState({ isLoading: false, error: null, trips: [] }), 'empty');
  assert.equal(getTripListScreenState({ isLoading: false, error: null, trips: [{}] }), 'success');
});
