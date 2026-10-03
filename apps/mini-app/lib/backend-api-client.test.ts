import assert from 'node:assert/strict';
import { test } from 'node:test';

import type * as BackendApiClientModule from './backend-api-client';

const { ApiError, createBackendApiClient }: typeof BackendApiClientModule = await import(
  new URL('./backend-api-client.ts', import.meta.url).href
);

type FetchCall = Readonly<{
  input: RequestInfo | URL;
  init?: RequestInit;
}>;

function createFetchStub(response: Response) {
  const calls: FetchCall[] = [];
  const fetchStub: typeof fetch = async (input, init) => {
    calls.push({ input, init });
    return response;
  };

  return { calls, fetchStub };
}

function assertReadRequest(call: FetchCall | undefined, input: string) {
  assert.equal(call?.input, input);
  assert.equal(call?.init?.method, 'GET');
  assert.deepEqual(call?.init?.headers, {
    Accept: 'application/json',
    Authorization: 'Bearer session-token'
  });
  assert.ok(call?.init?.signal instanceof AbortSignal);
}

test('uses the same-origin backend prefix and serializes a Telegram auth request', async () => {
  const { calls, fetchStub } = createFetchStub(
    new Response(
      JSON.stringify({
        access_token: 'session-token',
        token_type: 'bearer',
        expires_at: '2026-09-01T00:00:00Z',
        user: { id: 'd2b7c15c-2f99-4e29-b24e-0d7bbc1f7c43' },
        onboarding: { status: 'not_started' },
        profile_exists: false,
        travel_intent_exists: false
      })
    )
  );
  const client = createBackendApiClient(fetchStub);

  const response = await client.authenticateWithTelegram('raw-init-data');

  assert.equal(response.access_token, 'session-token');
  assert.deepEqual(calls, [
    {
      input: '/api/backend/auth/telegram',
      init: {
        body: JSON.stringify({ init_data: 'raw-init-data' }),
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        method: 'POST'
      }
    }
  ]);
});

test('adds a Bearer token to authenticated JSON requests', async () => {
  const { calls, fetchStub } = createFetchStub(
    new Response(JSON.stringify({ id: 'profile-id', display_name: 'Алина' }))
  );
  const client = createBackendApiClient(fetchStub);

  await client.patchProfile('session-token', { display_name: 'Алина' });

  assert.equal(calls[0]?.input, '/api/backend/me/profile');
  assert.deepEqual(calls[0]?.init, {
    body: JSON.stringify({ display_name: 'Алина' }),
    headers: {
      Accept: 'application/json',
      Authorization: 'Bearer session-token',
      'Content-Type': 'application/json'
    },
    method: 'PATCH'
  });
});

test('maps GET /chats through the authenticated backend client', async () => {
  const chats = [
    {
      chat_id: 'chat-uuid',
      type: 'direct',
      companion: {
        user_id: 'companion-uuid',
        display_name: 'Мария',
        age: 31,
        city: 'Тбилиси'
      },
      created_at: '2026-09-01T10:00:00Z'
    }
  ];
  const { calls, fetchStub } = createFetchStub(new Response(JSON.stringify(chats)));
  const client = createBackendApiClient(fetchStub);

  const response = await client.getChats('session-token');

  assert.deepEqual(response, chats);
  assertReadRequest(calls[0], '/api/backend/chats');
});

test('maps a group Chat from GET /chats through the authenticated backend client', async () => {
  const groupChat = {
    chat_id: 'group-chat-uuid',
    type: 'group',
    participants: [
      { user_id: 'user-one', display_name: 'Мария' },
      { user_id: 'user-two', display_name: 'Илья' },
      { user_id: 'user-three', display_name: 'Анна' }
    ],
    participant_count: 3,
    created_at: '2026-09-01T10:00:00Z'
  };
  const { calls, fetchStub } = createFetchStub(new Response(JSON.stringify([groupChat])));
  const client = createBackendApiClient(fetchStub);

  assert.deepEqual(await client.getChats('session-token'), [groupChat]);
  assertReadRequest(calls[0], '/api/backend/chats');
});

test('maps POST /chats/groups through the authenticated backend client', async () => {
  const createdGroupChat = {
    chat_id: 'group-chat-uuid',
    type: 'group',
    participant_user_ids: ['user-one', 'user-two', 'user-three'],
    created_at: '2026-09-01T10:00:00Z'
  };
  const { calls, fetchStub } = createFetchStub(new Response(JSON.stringify(createdGroupChat)));
  const client = createBackendApiClient(fetchStub);

  assert.deepEqual(
    await client.createGroupChat('session-token', { user_ids: ['user-one', 'user-two'] }),
    createdGroupChat
  );
  assert.deepEqual(calls[0], {
    input: '/api/backend/chats/groups',
    init: {
      body: JSON.stringify({ user_ids: ['user-one', 'user-two'] }),
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer session-token',
        'Content-Type': 'application/json'
      },
      method: 'POST'
    }
  });
});

test('maps GET /trips through the authenticated backend client', async () => {
  const trips = [{
    trip_id: 'trip-uuid',
    chat_id: 'chat-uuid',
    status: 'forming',
    created_at: '2026-09-01T10:00:00Z',
    date_from: null,
    date_to: null,
    destination_status: 'empty',
    dates_status: 'empty',
    budget_status: 'empty',
    transport_status: 'empty',
    route_place_labels: []
  }];
  const { calls, fetchStub } = createFetchStub(new Response(JSON.stringify(trips)));
  const client = createBackendApiClient(fetchStub);

  assert.deepEqual(await client.getTrips('session-token'), trips);
  assertReadRequest(calls[0], '/api/backend/trips');
});

test('maps POST /chats/{chat_id}/trips through the authenticated backend client', async () => {
  const trip = {
    trip_id: 'trip-uuid',
    chat_id: 'chat-uuid',
    created_by_user_id: 'user-uuid',
    status: 'forming',
    created_at: '2026-09-01T10:00:00Z'
  };
  const { calls, fetchStub } = createFetchStub(new Response(JSON.stringify(trip), { status: 201 }));
  const client = createBackendApiClient(fetchStub);

  assert.deepEqual(await client.createTrip('session-token', 'chat-uuid'), trip);
  assert.deepEqual(calls[0], {
    input: '/api/backend/chats/chat-uuid/trips',
    init: {
      headers: { Accept: 'application/json', Authorization: 'Bearer session-token' },
      method: 'POST'
    }
  });
});

test('maps GET /trips/{trip_id} through the authenticated backend client', async () => {
  const tripDetail = {
    trip: {
      trip_id: 'trip-uuid',
      chat_id: 'chat-uuid',
      created_by_user_id: 'creator-uuid',
      status: 'active',
      membership_version: 1,
      state_version: 1,
      destination_version: 1,
      dates_version: 1,
      budget_version: 1,
      transport_version: 1,
      destination_status: 'confirmed',
      dates_status: 'confirmed',
      budget_status: 'confirmed',
      transport_status: 'empty',
      date_from: '2026-10-01',
      date_to: '2026-10-10',
      budget_min: '1200.00',
      budget_max: '1500.00',
      budget_currency: 'RUB',
      budget_scope: 'per_person',
      started_at: null,
      completed_at: null,
      cancelled_at: null,
      created_at: '2026-09-01T10:00:00Z',
      updated_at: '2026-09-01T11:00:00Z'
    },
    route_stops: [{
      id: 'stop-uuid', position: 1, place_label: 'Tokyo', country_code: 'JP', place_ref: null,
      stay_from: null, stay_to: null, notes: null, created_at: '2026-09-01T10:00:00Z', updated_at: '2026-09-01T10:00:00Z'
    }],
    participants: [{ user_id: 'user-uuid', display_name: 'Алина', age: 30, city: 'Москва' }]
  };
  const { calls, fetchStub } = createFetchStub(new Response(JSON.stringify(tripDetail)));
  const client = createBackendApiClient(fetchStub);

  assert.deepEqual(await client.getTrip('session-token', 'trip-uuid'), tripDetail);
  assertReadRequest(calls[0], '/api/backend/trips/trip-uuid');
});

test('loads Discover candidates with the runtime Bearer token', async () => {
  const candidates = [{
    user_id: 'candidate-uuid',
    display_name: 'Алина',
    age: 29,
    city: 'Москва',
    bio: null,
    travel_style: ['Городской'],
    interests: ['Архитектура'],
    budget_level: '3',
    comfort_level: '4',
    travel_intent: { destination: 'Тбилиси', date_from: null, date_to: null }
  }];
  const { calls, fetchStub } = createFetchStub(new Response(JSON.stringify(candidates)));
  const client = createBackendApiClient(fetchStub);

  assert.deepEqual(await client.getDiscoverCandidates('session-token'), candidates);
  assertReadRequest(calls[0], '/api/backend/discover/candidates');
});

test('sends both interested and rejected Discover decisions to the selected candidate', async () => {
  for (const decision of ['interested', 'rejected'] as const) {
    const { calls, fetchStub } = createFetchStub(
      new Response(JSON.stringify({ decision, match_created: decision === 'interested', match_id: null }))
    );
    const client = createBackendApiClient(fetchStub);

    const response = await client.putDiscoverDecision('session-token', 'candidate-uuid', { decision });

    assert.equal(response.decision, decision);
    assert.deepEqual(calls[0], {
      input: '/api/backend/discover/decisions/candidate-uuid',
      init: {
        body: JSON.stringify({ decision }),
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer session-token',
          'Content-Type': 'application/json'
        },
        method: 'PUT'
      }
    });
  }
});

test('sends only content_text when creating a chat message', async () => {
  const { calls, fetchStub } = createFetchStub(
    new Response(JSON.stringify({ message_id: 'message-uuid', sequence_number: 3 }))
  );
  const client = createBackendApiClient(fetchStub);

  await client.createChatMessage('session-token', 'chat-uuid', { content_text: 'Привет' });

  assert.deepEqual(calls[0], {
    input: '/api/backend/chats/chat-uuid/messages',
    init: {
      body: JSON.stringify({ content_text: 'Привет' }),
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer session-token',
        'Content-Type': 'application/json'
      },
      method: 'POST'
    }
  });
});

test('loads a chat message history through the authenticated backend client', async () => {
  const { calls, fetchStub } = createFetchStub(new Response(JSON.stringify([])));
  const client = createBackendApiClient(fetchStub);

  await client.getChatMessages('session-token', 'chat-uuid');

  assertReadRequest(calls[0], '/api/backend/chats/chat-uuid/messages');
});

test('loads a persisted chat participant profile through the authenticated backend client', async () => {
  const profile = {
    user_id: 'participant-uuid', display_name: 'Алина', age: 29, city: 'Москва', bio: null,
    travel_style: [], interests: [], budget_level: null, comfort_level: null,
    travel_intent: { destination: 'Тбилиси', date_from: null, date_to: null }
  };
  const { calls, fetchStub } = createFetchStub(new Response(JSON.stringify(profile)));
  const client = createBackendApiClient(fetchStub);

  assert.deepEqual(await client.getChatParticipantProfile('session-token', 'chat-uuid', 'participant-uuid'), profile);
  assertReadRequest(calls[0], '/api/backend/chats/chat-uuid/participants/participant-uuid/profile');
});

test('aborts a read request when its timeout expires', async () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  let timeoutCallback: (() => void) | null = null;

  globalThis.setTimeout = ((callback: () => void) => {
    timeoutCallback = callback;
    return 1 as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  globalThis.clearTimeout = (() => undefined) as typeof clearTimeout;

  try {
    const client = createBackendApiClient(((input, init) => new Promise((_, reject) => {
      assert.equal(input, '/api/backend/chats');
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      timeoutCallback?.();
    })) as typeof fetch);

    await assert.rejects(() => client.getChats('session-token'), { name: 'AbortError' });
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test('keeps mutable requests free of read timeout signals', async () => {
  const { calls, fetchStub } = createFetchStub(new Response(JSON.stringify({ status: 'completed' })));
  const client = createBackendApiClient(fetchStub);

  await client.patchOnboarding('session-token', { status: 'completed' });

  assert.equal(calls[0]?.init?.signal, undefined);
});

test('allows a fresh read request after a recoverable failure', async () => {
  let requestCount = 0;
  const client = createBackendApiClient((async () => {
    requestCount += 1;

    if (requestCount === 1) {
      throw new Error('network error');
    }

    return new Response(JSON.stringify([]));
  }) as typeof fetch);

  await assert.rejects(() => client.getChats('session-token'));
  assert.deepEqual(await client.getChats('session-token'), []);
  assert.equal(requestCount, 2);
});

test('returns parsed JSON from an authenticated request', async () => {
  const { fetchStub } = createFetchStub(
    new Response(JSON.stringify({ status: 'completed' }))
  );
  const client = createBackendApiClient(fetchStub);

  const response = await client.patchOnboarding('session-token', { status: 'completed' });

  assert.deepEqual(response, { status: 'completed' });
});

test('returns undefined for a 204 response', async () => {
  const { calls, fetchStub } = createFetchStub(new Response(null, { status: 204 }));
  const client = createBackendApiClient(fetchStub);

  const response = await client.deleteTravelIntent('session-token');

  assert.equal(response, undefined);
  assert.deepEqual(calls[0]?.init, {
    headers: {
      Accept: 'application/json',
      Authorization: 'Bearer session-token'
    },
    method: 'DELETE'
  });
});

test('turns a backend error response into an ApiError with the backend message', async () => {
  const { fetchStub } = createFetchStub(
    new Response(JSON.stringify({ detail: 'Authentication required' }), { status: 401 })
  );
  const client = createBackendApiClient(fetchStub);

  await assert.rejects(
    () => client.getProfile('expired-token'),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 401);
      assert.equal(error.message, 'Authentication required');
      assert.deepEqual(error.body, { detail: 'Authentication required' });
      return true;
    }
  );
});
