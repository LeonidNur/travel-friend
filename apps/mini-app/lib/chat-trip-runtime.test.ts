import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ApiError, type TripCreateResponse, type TripListItemResponse } from './backend-api-client';
import {
  createChatTrip,
  findUnfinishedTripForChat,
  loadChatTripNavigationState,
  getTripNavigationDescription,
  getTripNavigationButtonState
} from './chat-trip-runtime';

const createdTrip: TripCreateResponse = {
  trip_id: 'trip-created',
  chat_id: 'chat-uuid',
  created_by_user_id: 'user-uuid',
  status: 'forming',
  created_at: '2026-09-01T10:00:00Z'
};

function tripListItem(chatId: string, status: TripListItemResponse['status']): TripListItemResponse {
  return {
    trip_id: 'trip-existing',
    chat_id: chatId,
    status,
    created_at: '2026-09-01T10:00:00Z',
    date_from: null,
    date_to: null,
    destination_status: 'empty',
    dates_status: 'empty',
    budget_status: 'empty',
    transport_status: 'empty',
    route_place_labels: []
  };
}

test('creates a Trip from a direct Chat and returns its detail route', async () => {
  const result = await createChatTrip({
    chatId: 'direct-chat-uuid',
    createTrip: async () => ({ ...createdTrip, chat_id: 'direct-chat-uuid' }),
    getTrips: async () => []
  });

  assert.deepEqual(result, { tripPath: '/trips/trip-created', error: null });
});

test('creates a Trip from a group Chat and returns its detail route', async () => {
  const result = await createChatTrip({
    chatId: 'group-chat-uuid',
    createTrip: async () => ({ ...createdTrip, chat_id: 'group-chat-uuid' }),
    getTrips: async () => []
  });

  assert.deepEqual(result, { tripPath: '/trips/trip-created', error: null });
});

test('opens the existing unfinished Trip after a 409 response', async () => {
  const result = await createChatTrip({
    chatId: 'chat-uuid',
    createTrip: async () => { throw new ApiError(409, { detail: 'Unfinished Trip already exists' }); },
    getTrips: async () => [tripListItem('other-chat-uuid', 'forming'), tripListItem('chat-uuid', 'active')]
  });

  assert.deepEqual(result, { tripPath: '/trips/trip-existing', error: null });
});

test('reports API errors and does not claim a Trip was created', async () => {
  const result = await createChatTrip({
    chatId: 'chat-uuid',
    createTrip: async () => { throw new ApiError(500, { detail: 'Unexpected error' }); },
    getTrips: async () => []
  });

  assert.deepEqual(result, { tripPath: null, error: 'Не удалось создать поездку. Попробуйте ещё раз.' });
});

test('reports a 409 without an available unfinished Trip honestly', async () => {
  const result = await createChatTrip({
    chatId: 'chat-uuid',
    createTrip: async () => { throw new ApiError(409, { detail: 'Unfinished Trip already exists' }); },
    getTrips: async () => [tripListItem('chat-uuid', 'completed')]
  });

  assert.deepEqual(result, {
    tripPath: null,
    error: 'Незавершённая поездка уже существует, но её не удалось открыть. Попробуйте ещё раз.'
  });
});

test('finds forming or active Trip for the current direct or group Chat only', () => {
  const trips = [tripListItem('other-chat-uuid', 'forming'), tripListItem('chat-uuid', 'active')];

  assert.equal(findUnfinishedTripForChat(trips, 'chat-uuid')?.trip_id, 'trip-existing');
  assert.equal(findUnfinishedTripForChat(trips, 'another-chat-uuid'), null);
});

test('ignores completed and cancelled Trips when choosing the Chat CTA', () => {
  assert.equal(findUnfinishedTripForChat([tripListItem('chat-uuid', 'completed')], 'chat-uuid'), null);
  assert.equal(findUnfinishedTripForChat([tripListItem('chat-uuid', 'cancelled')], 'chat-uuid'), null);
});

test('loads an existing Trip from the read endpoint for direct and group Chats', async () => {
  for (const chatId of ['direct-chat-uuid', 'group-chat-uuid']) {
    let reads = 0;
    const state = await loadChatTripNavigationState(chatId, async () => {
      reads += 1;
      return [tripListItem(chatId, 'forming')];
    });

    assert.deepEqual(state, { status: 'loaded', tripId: 'trip-existing' });
    assert.equal(reads, 1);
  }
});

test('returns an explicit retryable state when the Trip list cannot be read', async () => {
  const state = await loadChatTripNavigationState('chat-uuid', async () => {
    throw new Error('temporary read failure');
  });

  assert.deepEqual(state, { status: 'error' });
});

test('chooses loading, retry, create, and open states without creating a Trip for lookup', () => {
  assert.deepEqual(getTripNavigationButtonState({ status: 'loading' }, false), {
    disabled: true,
    label: 'Проверяем поездку…',
    showRetry: false
  });
  assert.deepEqual(getTripNavigationButtonState({ status: 'error' }, false), {
    disabled: true,
    label: 'Поездка недоступна',
    showRetry: true
  });
  assert.deepEqual(getTripNavigationButtonState({ status: 'loaded', tripId: null }, false), {
    disabled: false,
    label: 'Создать поездку',
    showRetry: false
  });
  assert.deepEqual(getTripNavigationButtonState({ status: 'loaded', tripId: 'trip-existing' }, false), {
    disabled: false,
    label: 'Открыть поездку',
    showRetry: false
  });
  assert.deepEqual(getTripNavigationButtonState({ status: 'loaded', tripId: null }, true), {
    disabled: true,
    label: 'Создаём поездку…',
    showRetry: false
  });
});

test('describes Trip navigation according to lookup state', () => {
  assert.equal(getTripNavigationDescription({ status: 'loading' }), 'Проверяем, есть ли поездка для этого чата.');
  assert.equal(getTripNavigationDescription({ status: 'error' }), 'Повторите проверку, чтобы узнать, доступна ли поездка.');
  assert.equal(getTripNavigationDescription({ status: 'loaded', tripId: null }), 'Создайте поездку для участников этого чата.');
  assert.equal(getTripNavigationDescription({ status: 'loaded', tripId: 'trip-existing' }), 'Откройте поездку участников этого чата.');
});
