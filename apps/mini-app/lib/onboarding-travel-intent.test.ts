import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { TravelIntentResponse } from './backend-api-client';
import type * as OnboardingTravelIntentModule from './onboarding-travel-intent';

const onboardingTravelIntentModule: typeof OnboardingTravelIntentModule = await import(
  new URL('./onboarding-travel-intent.ts', import.meta.url).href
);

const {
  createOnboardingTravelIntentDraft,
  saveOnboardingTravelIntent,
  toTravelIntentPutRequest,
  validateOnboardingTravelIntent
} = onboardingTravelIntentModule;

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

test('creates an onboarding draft from the separate server TravelIntent for resume', () => {
  assert.deepEqual(createOnboardingTravelIntentDraft(travelIntent), {
    destination: 'Тбилиси',
    dateFrom: '2026-09-10',
    dateTo: '2026-09-16'
  });
});

test('creates an empty draft when the server TravelIntent is null', () => {
  assert.deepEqual(createOnboardingTravelIntentDraft(null), {
    destination: '',
    dateFrom: '',
    dateTo: ''
  });
});

test('requires destination and validates optional dates and their order', () => {
  assert.equal(validateOnboardingTravelIntent(createOnboardingTravelIntentDraft(null)).errors.destination, 'Укажите направление');
  assert.equal(
    validateOnboardingTravelIntent({ destination: 'Тбилиси', dateFrom: '2026-15-01', dateTo: '' }).errors.dateFrom,
    'Укажите корректную дату'
  );
  assert.equal(
    validateOnboardingTravelIntent({ destination: 'Тбилиси', dateFrom: '', dateTo: '2026-02-30' }).errors.dateTo,
    'Укажите корректную дату'
  );
  assert.equal(
    validateOnboardingTravelIntent({ destination: 'Тбилиси', dateFrom: '2026-09-16', dateTo: '2026-09-10' }).errors.dateTo,
    'Дата окончания не может быть раньше даты начала'
  );
});

test('maps a draft to a PUT payload with nullable optional dates', () => {
  assert.deepEqual(
    toTravelIntentPutRequest({ destination: '  Тбилиси ', dateFrom: '', dateTo: '  ' }),
    { destination: 'Тбилиси', date_from: null, date_to: null }
  );
});

test('saves the TravelIntent and returns the backend resource', async () => {
  let call: unknown = null;
  const result = await saveOnboardingTravelIntent({
    draft: { destination: 'Тбилиси', dateFrom: '2026-09-10', dateTo: '2026-09-16' },
    token: 'runtime-token',
    putTravelIntent: async (token, payload) => {
      call = { token, payload };
      return travelIntent;
    }
  });

  assert.deepEqual(call, {
    token: 'runtime-token',
    payload: { destination: 'Тбилиси', date_from: '2026-09-10', date_to: '2026-09-16' }
  });
  assert.deepEqual(result, { status: 'saved', travelIntent });
});

test('returns a representative API error without reporting a TravelIntent save', async () => {
  const result = await saveOnboardingTravelIntent({
    draft: { destination: 'Тбилиси', dateFrom: '', dateTo: '' },
    token: 'runtime-token',
    putTravelIntent: async () => {
      throw new Error('Сервис временно недоступен');
    }
  });

  assert.deepEqual(result, { status: 'api_error', message: 'Сервис временно недоступен' });
});
