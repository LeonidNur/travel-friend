import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ProfileResponse } from './backend-api-client';
import type * as TravelPreferencesModule from './travel-preferences';
import type * as OnboardingProfileModule from './onboarding-profile';

const onboardingProfileModule: typeof OnboardingProfileModule = await import(
  new URL('./onboarding-profile.ts', import.meta.url).href
);

const { createOnboardingProfileDraft, saveOnboardingProfile, validateOnboardingProfile } = onboardingProfileModule;

const travelPreferencesModule: typeof TravelPreferencesModule = await import(
  new URL('./travel-preferences.ts', import.meta.url).href
);

const { fromCanonicalProfileLevel, toCanonicalProfileLevel } = travelPreferencesModule;

const serverProfile: ProfileResponse = {
  id: 'profile-id',
  user_id: 'user-id',
  display_name: 'Алина Морозова',
  birth_date: '1996-09-01',
  gender: null,
  city: 'Санкт-Петербург',
  bio: 'Люблю короткие поездки',
  travel_style: ['Городской'],
  interests: ['Музыка'],
  budget_level: 'medium',
  comfort_level: 'high',
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-31T00:00:00Z'
};

test('creates form initial values from the separate server Profile resource', () => {
  assert.deepEqual(createOnboardingProfileDraft(serverProfile), {
    displayName: 'Алина Морозова',
    birthDate: '1996-09-01',
    city: 'Санкт-Петербург',
    bio: 'Люблю короткие поездки',
    interests: ['Музыка'],
    travelStyle: ['Городской'],
    budgetLevel: null,
    comfortLevel: null
  });
});

test('maps legacy selector levels to canonical string values for the backend', () => {
  const levels = [1, 2, 3, 4] as const;

  assert.deepEqual(
    levels.map((level) => toCanonicalProfileLevel(level)),
    ['1', '2', '3', '4']
  );
});

test('restores canonical server levels and leaves null or unknown values unselected', () => {
  assert.equal(fromCanonicalProfileLevel('1'), 1);
  assert.equal(fromCanonicalProfileLevel('4'), 4);
  assert.equal(fromCanonicalProfileLevel(null), null);
  assert.equal(fromCanonicalProfileLevel('medium'), null);
});

test('creates an empty form when the server Profile is null', () => {
  assert.deepEqual(createOnboardingProfileDraft(null), {
    displayName: '',
    birthDate: '',
    city: '',
    bio: '',
    interests: [],
    travelStyle: [],
    budgetLevel: null,
    comfortLevel: null
  });
});

test('requires display_name and rejects an invalid or future birth_date', () => {
  assert.deepEqual(validateOnboardingProfile(createOnboardingProfileDraft(null)).errors, {
    displayName: 'Укажите имя'
  });
  assert.equal(
    validateOnboardingProfile({ ...createOnboardingProfileDraft(null), displayName: 'Алина', birthDate: '2026-14-01' })
      .errors.birthDate,
    'Укажите корректную дату рождения'
  );
  assert.equal(
    validateOnboardingProfile({ ...createOnboardingProfileDraft(null), displayName: 'Алина', birthDate: '2999-01-01' })
      .errors.birthDate,
    'Дата рождения не может быть в будущем'
  );
});

test('starts not_started onboarding and sends the expected Profile PATCH payload', async () => {
  const calls: Array<unknown> = [];
  const draft = {
    ...createOnboardingProfileDraft(null),
    displayName: '  Алина  ',
    birthDate: '1996-09-01',
    city: '  Москва  ',
    interests: ['Музыка'],
    travelStyle: ['Городской'],
    budgetLevel: 2 as const,
    comfortLevel: 3 as const
  };

  const result = await saveOnboardingProfile({
    draft,
    onboardingStatus: 'not_started',
    token: 'runtime-token',
    patchOnboarding: async (token, payload) => {
      calls.push({ token, payload });
      return { status: 'in_progress' };
    },
    patchProfile: async (token, payload) => {
      calls.push({ token, payload });
      return { ...serverProfile, display_name: 'Алина', city: 'Москва' };
    }
  });

  assert.deepEqual(calls, [
    { token: 'runtime-token', payload: { status: 'in_progress' } },
    {
      token: 'runtime-token',
      payload: {
        display_name: 'Алина',
        birth_date: '1996-09-01',
        city: 'Москва',
        bio: null,
        interests: ['Музыка'],
        travel_style: ['Городской'],
        budget_level: '2',
        comfort_level: '3'
      }
    }
  ]);
  assert.equal(result.status, 'saved');
});

test('saves an in_progress Profile without changing onboarding status', async () => {
  let onboardingCalls = 0;

  const result = await saveOnboardingProfile({
    draft: { ...createOnboardingProfileDraft(null), displayName: 'Алина' },
    onboardingStatus: 'in_progress',
    token: 'runtime-token',
    patchOnboarding: async () => {
      onboardingCalls += 1;
      return { status: 'in_progress' };
    },
    patchProfile: async () => serverProfile
  });

  assert.equal(onboardingCalls, 0);
  assert.deepEqual(result, { status: 'saved', profile: serverProfile });
});

test('returns a representative API error without reporting a save', async () => {
  const result = await saveOnboardingProfile({
    draft: { ...createOnboardingProfileDraft(null), displayName: 'Алина' },
    onboardingStatus: 'in_progress',
    token: 'runtime-token',
    patchOnboarding: async () => ({ status: 'in_progress' }),
    patchProfile: async () => {
      throw new Error('Сервис временно недоступен');
    }
  });

  assert.deepEqual(result, { status: 'api_error', message: 'Сервис временно недоступен' });
});
