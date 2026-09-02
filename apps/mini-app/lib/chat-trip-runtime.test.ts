import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ApiError, type TripCreateResponse, type TripListItemResponse } from './backend-api-client';
import { createChatTrip, getCreateTripButtonState } from './chat-trip-runtime';

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

test('disables the Trip CTA while creation is in progress', () => {
  assert.deepEqual(getCreateTripButtonState(false), { disabled: false, label: 'Создать поездку' });
  assert.deepEqual(getCreateTripButtonState(true), { disabled: true, label: 'Создаём поездку…' });
});
