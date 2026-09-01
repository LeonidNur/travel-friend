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
