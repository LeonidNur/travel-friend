import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { TravelIntentResponse } from './backend-api-client';
import type * as TravelIntentHydrationModule from './current-user-travel-intent-hydration';

const travelIntentHydrationModule: typeof TravelIntentHydrationModule = await import(
  new URL('./current-user-travel-intent-hydration.ts', import.meta.url).href
);

const { hydrateServerTravelIntent } = travelIntentHydrationModule;

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
