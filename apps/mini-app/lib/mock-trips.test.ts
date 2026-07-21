import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

import type { MockChat, Trip, TripStatus } from './types';
import type * as MockChatsModule from './mock-chats';
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

const mockTripsModule = (await import(new URL('./mock-trips.ts', import.meta.url).href)) as typeof MockTripsModule & {
  getChatRoomTripActionState: (
    chat: MockChat,
    trips?: readonly Trip[],
    activeTripId?: string
  ) => {
    tripHref?: string;
    tripLabel?: string;
    createButtonLabel?: string;
  };
};

const {
  createDraftTrip,
  getActiveTripByChatId,
  getChatRoomTripActionState,
  getTrips,
  getTripsByChatId,
  validateMockTrips
} = mockTripsModule;

const { getChatById }: typeof MockChatsModule = await import(
  new URL('./mock-chats.ts', import.meta.url).href
);

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

test('creates a draft trip linked to the matched chat with its participants', () => {
  const chat = getChatById('chat-sonya-yerevan');

  assert.ok(chat);

  const trip = createDraftTrip(chat, getTrips(), 'session-trip-chat-sonya-yerevan');

  assert.equal(trip.id, 'session-trip-chat-sonya-yerevan');
  assert.equal(trip.chatId, chat.id);
  assert.equal(trip.status, 'draft');
  assert.deepEqual(trip.participantIds, chat.participants.map((participant) => participant.id));
  assert.ok(
    Object.values(trip.categories).every(
      (category) => category.status === 'empty' || category.status === 'needs_decision'
    )
  );
});

test('rejects creation of a second active trip for the same chat', () => {
  const chat = getChatById('chat-sonya-yerevan');

  assert.ok(chat);

  const firstDraft = createDraftTrip(chat, getTrips(), 'session-trip-chat-sonya-yerevan');

  assert.throws(
    () => createDraftTrip(chat, [...getTrips(), firstDraft], 'session-trip-chat-sonya-yerevan-duplicate'),
    /already has an active trip/
  );
});

test('returns the created draft as the active trip for its chat', () => {
  const chat = getChatById('chat-sonya-yerevan');

  assert.ok(chat);

  const draftTrip = createDraftTrip(chat, getTrips(), 'session-trip-chat-sonya-yerevan');

  assert.equal(getActiveTripByChatId(chat.id, [...getTrips(), draftTrip]), draftTrip);
});

test('keeps Maria chat linked to its active trip', () => {
  assert.equal(getActiveTripByChatId('chat-amina-tbilisi')?.id, 'trip-maria-georgia');
});

test('keeps Timur historical trip while leaving the matched chat without an active trip', () => {
  const [timurTrip] = getTripsByChatId('chat-sonya-yerevan');

  assert.ok(timurTrip);
  assert.equal(timurTrip.id, 'trip-timur-yerevan');
  assert.equal(timurTrip.status, 'ready');
  assert.deepEqual(
    Object.fromEntries(
      ['dates', 'budget', 'transport', 'accommodation', 'activities'].map((category) => [
        category,
        timurTrip.categories[category as keyof typeof timurTrip.categories].status
      ])
    ),
    {
      dates: 'confirmed',
      budget: 'confirmed',
      transport: 'confirmed',
      accommodation: 'confirmed',
      activities: 'confirmed'
    }
  );
  assert.equal(getActiveTripByChatId('chat-sonya-yerevan'), undefined);
});

test('returns the historical ready trip and new-trip CTA for the matched chat without an active trip', () => {
  const chat = getChatById('chat-sonya-yerevan');

  assert.ok(chat);

  assert.deepEqual(getChatRoomTripActionState(chat, getTrips()), {
    tripHref: '/trips/trip-timur-yerevan',
    tripLabel: 'Прошлый план поездки',
    createButtonLabel: 'Начать новую поездку'
  });
});

test('keeps historical ready trip state when historical trip id is passed as activeTripId', () => {
  const chat = getChatById('chat-sonya-yerevan');

  assert.ok(chat);

  const draftTrip = createDraftTrip(chat, getTrips(), 'session-trip-chat-sonya-yerevan');

  assert.deepEqual(getChatRoomTripActionState(chat, [...getTrips(), draftTrip], 'trip-timur-yerevan'), {
    tripHref: '/trips/session-trip-chat-sonya-yerevan',
    tripLabel: 'План поездки'
  });
});

test('prefers an active draft trip over the historical ready trip in chat navigation', () => {
  const chat = getChatById('chat-sonya-yerevan');

  assert.ok(chat);

  const draftTrip = createDraftTrip(chat, getTrips(), 'session-trip-chat-sonya-yerevan');

  assert.deepEqual(getChatRoomTripActionState(chat, [...getTrips(), draftTrip]), {
    tripHref: '/trips/session-trip-chat-sonya-yerevan',
    tripLabel: 'План поездки'
  });
});

test('ignores an activeTripId that belongs to another chat', () => {
  const chat = getChatById('chat-sonya-yerevan');

  assert.ok(chat);

  assert.deepEqual(getChatRoomTripActionState(chat, getTrips(), 'trip-maria-georgia'), {
    tripHref: '/trips/trip-timur-yerevan',
    tripLabel: 'Прошлый план поездки',
    createButtonLabel: 'Начать новую поездку'
  });
});

test('keeps chat without historical trip on the default planning CTA', () => {
  const chat = getChatById('chat-ilya-istanbul');

  assert.ok(chat);

  assert.deepEqual(getChatRoomTripActionState(chat, getTrips()), {
    createButtonLabel: 'Начать планирование'
  });
});

test('keeps Egor chat without an active trip', () => {
  assert.equal(getActiveTripByChatId('chat-ilya-istanbul'), undefined);
});
