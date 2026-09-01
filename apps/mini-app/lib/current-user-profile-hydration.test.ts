import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ProfileResponse } from './backend-api-client';
import type * as CurrentUserProfileHydrationModule from './current-user-profile-hydration';

const currentUserProfileHydrationModule: typeof CurrentUserProfileHydrationModule = await import(
  new URL('./current-user-profile-hydration.ts', import.meta.url).href
);

const { calculateAgeFromBirthDate, hydrateServerProfile } = currentUserProfileHydrationModule;

const backendProfile: ProfileResponse = {
  id: 'profile-id',
  user_id: 'user-id',
  display_name: 'Алина Морозова',
  birth_date: '1996-09-01',
  gender: null,
  city: 'Санкт-Петербург',
  bio: null,
  travel_style: ['city-break'],
  interests: ['music'],
  budget_level: 'medium',
  comfort_level: 'high',
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-31T00:00:00Z'
};

test('calculates the UI-only age from birth_date without persisting it', () => {
  assert.equal(calculateAgeFromBirthDate('1996-09-01', new Date('2026-08-31T12:00:00Z')), 29);
  assert.equal(calculateAgeFromBirthDate('1996-09-01', new Date('2026-09-01T12:00:00Z')), 30);
});

test('keeps an existing backend profile as a separate server resource', async () => {
  let requestedToken: string | null = null;

  const result = await hydrateServerProfile({
    getProfile: async (token) => {
      requestedToken = token;
      return backendProfile;
    },
    token: 'runtime-token'
  });

  assert.deepEqual(result, { status: 'loaded', profile: backendProfile });
  assert.equal(requestedToken, 'runtime-token');
});

test('represents a missing server profile explicitly without a mock fallback', async () => {
  const result = await hydrateServerProfile({
    getProfile: async () => null,
    token: 'runtime-token'
  });

  assert.deepEqual(result, { status: 'loaded', profile: null });
});

test('represents a profile request error separately from profile data', async () => {
  const result = await hydrateServerProfile({
    getProfile: async () => {
      throw new Error('network error');
    },
    token: 'runtime-token'
  });

  assert.deepEqual(result, { status: 'error' });
});
