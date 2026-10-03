import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { TravelIntentResponse } from './backend-api-client';
import type * as TravelIntentHydrationModule from './current-user-travel-intent-hydration';

const travelIntentHydrationModule: typeof TravelIntentHydrationModule = await import(
  new URL('./current-user-travel-intent-hydration.ts', import.meta.url).href
);

const { getTravelIntentHydrationToken, hydrateServerTravelIntent, requireActiveTravelIntent } = travelIntentHydrationModule;

const travelIntent: TravelIntentResponse = {
  id: 'intent-id',
  user_id: 'user-id',
  destination: 'Тбилиси',
  date_from: '2026-09-10',
  date_to: '2026-09-16',
  status: 'active',
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-31T00:00:00Z',
  archived_at: null
};

test('keeps an existing TravelIntent as a separate server resource for onboarding resume', async () => {
  const result = await hydrateServerTravelIntent({
    getTravelIntent: async () => travelIntent,
    token: 'runtime-token'
  });

  assert.deepEqual(result, { status: 'loaded', travelIntent });
});

test('represents a missing TravelIntent without a legacy profile fallback', async () => {
  const result = await hydrateServerTravelIntent({
    getTravelIntent: async () => null,
    token: 'runtime-token'
  });

  assert.deepEqual(result, { status: 'loaded', travelIntent: null });
});

test('represents a TravelIntent request error separately from resource data', async () => {
  const result = await hydrateServerTravelIntent({
    getTravelIntent: async () => {
      throw new Error('network error');
    },
    token: 'runtime-token'
  });

  assert.deepEqual(result, { status: 'error' });
});

test('keeps a completed user TravelIntent as an active resource', () => {
  assert.deepEqual(requireActiveTravelIntent({ status: 'loaded', travelIntent }), {
    status: 'loaded',
    travelIntent
  });
});

test('treats a missing completed user TravelIntent as an invariant error', () => {
  assert.deepEqual(requireActiveTravelIntent({ status: 'loaded', travelIntent: null }), {
    status: 'invariant_error'
  });
});

test('hydrates an authenticated TravelIntent and retries after a recoverable failure', async () => {
  const firstRequestToken = getTravelIntentHydrationToken({
    authStatus: 'authenticated', accessToken: 'runtime-token', hydratedAccessToken: null
  });
  assert.equal(firstRequestToken, 'runtime-token');

  let requestCount = 0;
  const getTravelIntent = async () => {
    requestCount += 1;
    if (requestCount === 1) throw new Error('network error');
    return travelIntent;
  };
  assert.deepEqual(await hydrateServerTravelIntent({ getTravelIntent, token: firstRequestToken }), { status: 'error' });
  assert.equal(getTravelIntentHydrationToken({
    authStatus: 'authenticated', accessToken: 'runtime-token', hydratedAccessToken: 'runtime-token'
  }), null);

  const retryToken = getTravelIntentHydrationToken({
    authStatus: 'authenticated', accessToken: 'runtime-token', hydratedAccessToken: null
  });
  assert.equal(retryToken, 'runtime-token');
  assert.deepEqual(await hydrateServerTravelIntent({ getTravelIntent, token: retryToken }), { status: 'loaded', travelIntent });
  assert.equal(requestCount, 2);
});
