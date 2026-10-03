import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { TravelIntentResponse } from './backend-api-client';
import { hydrateServerTravelIntent, requireActiveTravelIntent } from './current-user-travel-intent-hydration';
import type * as ProfileTravelIntentModule from './profile-travel-intent';

const profileTravelIntentModule: typeof ProfileTravelIntentModule = await import(
  new URL('./profile-travel-intent.ts', import.meta.url).href
);

const { createProfileTravelIntentDraft, saveProfileTravelIntent } = profileTravelIntentModule;

const persistedTravelIntent: TravelIntentResponse = {
  id: 'intent-id', user_id: 'user-id', destination: 'Тбилиси', date_from: '2026-09-10', date_to: '2026-09-16',
  status: 'active', created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-31T00:00:00Z', archived_at: null
};

test('creates the initial persisted TravelIntent view model', () => {
  assert.deepEqual(createProfileTravelIntentDraft(persistedTravelIntent), {
    destination: 'Тбилиси', dateFrom: '2026-09-10', dateTo: '2026-09-16'
  });
});

test('rejects blank and overlong destinations before saving', async () => {
  for (const destination of ['  ', 'a'.repeat(201)]) {
    const result = await saveProfileTravelIntent({
      draft: { destination, dateFrom: '', dateTo: '' }, token: 'runtime-token',
      putTravelIntent: async () => { throw new Error('request must not be sent'); }
    });
    assert.equal(result.status, 'validation_error');
  }
});

test('rejects an invalid date range before saving', async () => {
  const result = await saveProfileTravelIntent({
    draft: { destination: 'Тбилиси', dateFrom: '2026-09-16', dateTo: '2026-09-10' }, token: 'runtime-token',
    putTravelIntent: async () => { throw new Error('request must not be sent'); }
  });
  assert.deepEqual(result, { status: 'validation_error', errors: { dateTo: 'Дата окончания не может быть раньше даты начала' } });
});

test('uses the resource returned by a successful save and reload reads it again', async () => {
  const persistedAfterSave = { ...persistedTravelIntent, destination: 'Ереван', date_from: null, date_to: null, updated_at: '2026-09-01T00:00:00Z' };
  const result = await saveProfileTravelIntent({
    draft: { destination: '  Ереван ', dateFrom: '', dateTo: '' }, token: 'runtime-token',
    putTravelIntent: async (_token, payload) => {
      assert.deepEqual(payload, { destination: 'Ереван', date_from: null, date_to: null });
      return persistedAfterSave;
    }
  });
  assert.deepEqual(result, { status: 'saved', travelIntent: persistedAfterSave });
  const reloaded = requireActiveTravelIntent(await hydrateServerTravelIntent({
    token: 'runtime-token',
    getTravelIntent: async (token) => {
      assert.equal(token, 'runtime-token');
      return persistedAfterSave;
    }
  }));
  assert.deepEqual(reloaded, { status: 'loaded', travelIntent: persistedAfterSave });
  if (reloaded.status === 'loaded') {
    assert.deepEqual(createProfileTravelIntentDraft(reloaded.travelIntent), { destination: 'Ереван', dateFrom: '', dateTo: '' });
  }
});

test('preserves a failed-save draft and retries it with the backend returned resource', async () => {
  const draft = { destination: 'Ереван', dateFrom: '', dateTo: '' };
  const persistedAfterRetry = { ...persistedTravelIntent, destination: 'Ереван', date_from: null, date_to: null };
  let requestCount = 0;
  const putTravelIntent = async (token: string, payload: unknown) => {
    requestCount += 1;
    assert.equal(token, 'runtime-token');
    assert.deepEqual(payload, { destination: 'Ереван', date_from: null, date_to: null });
    if (requestCount === 1) throw new Error('Сервис временно недоступен');
    return persistedAfterRetry;
  };
  const failed = await saveProfileTravelIntent({ draft, token: 'runtime-token', putTravelIntent });
  assert.deepEqual(failed, { status: 'api_error', message: 'Сервис временно недоступен' });
  assert.deepEqual(draft, { destination: 'Ереван', dateFrom: '', dateTo: '' });
  const retried = await saveProfileTravelIntent({ draft, token: 'runtime-token', putTravelIntent });
  assert.deepEqual(retried, { status: 'saved', travelIntent: persistedAfterRetry });
  assert.equal(requestCount, 2);
});

test('cancelling local edits restores values from the persisted resource', () => {
  const editedDraft = { ...createProfileTravelIntentDraft(persistedTravelIntent), destination: 'Ереван' };
  assert.notDeepEqual(editedDraft, createProfileTravelIntentDraft(persistedTravelIntent));
  assert.deepEqual(createProfileTravelIntentDraft(persistedTravelIntent), {
    destination: 'Тбилиси', dateFrom: '2026-09-10', dateTo: '2026-09-16'
  });
});
