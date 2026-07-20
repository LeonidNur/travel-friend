import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

import type { Trip, TripStatus } from './types';
import type * as MockTripsModule from './mock-trips';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) {
      return nextResolve(new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, context);
    }

    if (specifier.startsWith('./') && !specifier.endsWith('.ts')) {
      return nextResolve(new URL(`${specifier}.ts`, context.parentURL).href, context);
    }

    return nextResolve(specifier, context);
  }
});

const {
  getActiveTripByChatId,
  getTrips,
  getTripsByChatId,
  validateMockTrips
}: typeof MockTripsModule = await import(new URL('./mock-trips.ts', import.meta.url).href);

function createTrip(id: string, status: TripStatus): Trip {
  const sourceTrip = getTrips()[0];

  assert.ok(sourceTrip);

  return {
    ...sourceTrip,
    id,
    status,
    participantIds: [...sourceTrip.participantIds],
    categories: { ...sourceTrip.categories }
  };
}

test('allows two ready trips for one chat', () => {
  assert.doesNotThrow(() => validateMockTrips([
    createTrip('trip-ready-1', 'ready'),
    createTrip('trip-ready-2', 'ready')
  ]));
});

test('allows a ready trip and a planning trip for one chat', () => {
  assert.doesNotThrow(() => validateMockTrips([
    createTrip('trip-ready', 'ready'),
    createTrip('trip-planning', 'planning')
  ]));
});

test('allows a ready trip and a draft trip for one chat', () => {
  assert.doesNotThrow(() => validateMockTrips([
    createTrip('trip-ready', 'ready'),
    createTrip('trip-draft', 'draft')
  ]));
});

test('rejects a draft trip and a planning trip for one chat', () => {
  assert.throws(
    () => validateMockTrips([
      createTrip('trip-draft', 'draft'),
      createTrip('trip-planning', 'planning')
    ]),
    /more than one active mock trip/
  );
});

test('rejects two planning trips for one chat', () => {
  assert.throws(
    () => validateMockTrips([
      createTrip('trip-planning-1', 'planning'),
      createTrip('trip-planning-2', 'planning')
    ]),
    /more than one active mock trip/
  );
});

test('rejects two draft trips for one chat', () => {
  assert.throws(
    () => validateMockTrips([
      createTrip('trip-draft-1', 'draft'),
      createTrip('trip-draft-2', 'draft')
    ]),
    /more than one active mock trip/
  );
});

test('returns all trips linked to a chat', () => {
  const firstTrip = createTrip('trip-ready-1', 'ready');
  const secondTrip = createTrip('trip-ready-2', 'ready');

  assert.deepEqual(
    getTripsByChatId(firstTrip.chatId, [firstTrip, secondTrip]).map((trip) => trip.id),
    ['trip-ready-1', 'trip-ready-2']
  );
});

test('returns a planning trip as the active trip', () => {
  const planningTrip = createTrip('trip-planning', 'planning');

  assert.equal(getActiveTripByChatId(planningTrip.chatId, [planningTrip]), planningTrip);
});

test('returns a draft trip as the active trip', () => {
  const draftTrip = createTrip('trip-draft', 'draft');

  assert.equal(getActiveTripByChatId(draftTrip.chatId, [draftTrip]), draftTrip);
});

test('does not return a ready trip as the active trip', () => {
  const readyTrip = createTrip('trip-ready', 'ready');

  assert.equal(getActiveTripByChatId(readyTrip.chatId, [readyTrip]), undefined);
});

test('does not silently choose an active trip when the invariant is broken', () => {
  const draftTrip = createTrip('trip-draft', 'draft');
  const planningTrip = createTrip('trip-planning', 'planning');

  assert.throws(
    () => getActiveTripByChatId(draftTrip.chatId, [draftTrip, planningTrip]),
    /more than one active trip/
  );
});

test('keeps Maria chat linked to its active trip', () => {
  assert.equal(getActiveTripByChatId('chat-amina-tbilisi')?.id, 'trip-maria-georgia');
});

test('keeps Timur chat linked to its active trip', () => {
  assert.equal(getActiveTripByChatId('chat-sonya-yerevan')?.id, 'trip-timur-yerevan');
});

test('keeps Egor chat without an active trip', () => {
  assert.equal(getActiveTripByChatId('chat-ilya-istanbul'), undefined);
});
