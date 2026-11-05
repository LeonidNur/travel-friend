import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { DiscoverCandidateResponse } from './backend-api-client';
import { findDiscoverCandidateById, getDiscoverPublicProfileState } from './discover-public-profile-runtime';

const candidate: DiscoverCandidateResponse = {
  user_id: '57a27fd5-5c0f-4a2c-b2c7-1909813b3370',
  display_name: 'Мария',
  age: 31,
  city: 'Казань',
  bio: 'Люблю горы.',
  travel_style: ['Активный'],
  interests: ['Походы'],
  budget_level: '2',
  comfort_level: '3',
  travel_intent: { destination: 'Алтай', date_from: '2026-08-12', date_to: null }
};

test('resolves the requested profile only from authenticated Discover candidates', () => {
  assert.equal(findDiscoverCandidateById([candidate], candidate.user_id), candidate);
  assert.equal(findDiscoverCandidateById([candidate], 'not-an-eligible-candidate'), null);
});

test('distinguishes loading, retryable error, unavailable candidate, and loaded profile states', () => {
  assert.equal(getDiscoverPublicProfileState({ isLoading: true, hasError: false, candidate: null }), 'loading');
  assert.equal(getDiscoverPublicProfileState({ isLoading: false, hasError: true, candidate: null }), 'error');
  assert.equal(getDiscoverPublicProfileState({ isLoading: false, hasError: false, candidate: null }), 'unavailable');
  assert.equal(getDiscoverPublicProfileState({ isLoading: false, hasError: false, candidate }), 'loaded');
});
