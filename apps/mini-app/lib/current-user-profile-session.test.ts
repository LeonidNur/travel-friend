import assert from 'node:assert/strict';
import { test } from 'node:test';

import { currentUserProfile } from './mock-current-user';
import type * as CurrentUserProfileSessionModule from './current-user-profile-session';

const currentUserProfileSessionModule: typeof CurrentUserProfileSessionModule = await import(
  new URL('./current-user-profile-session.ts', import.meta.url).href
);

const {
  createCurrentUserProfileSession,
  createProfileDraft,
  getCurrentUserProfile,
  saveCurrentUserProfile,
  toUserProfile
} = currentUserProfileSessionModule;

test('starts a profile session from an independent current-user mock snapshot', () => {
  const session = createCurrentUserProfileSession();
  const profile = getCurrentUserProfile(session);

  assert.deepEqual(profile, currentUserProfile);
  assert.notEqual(profile, currentUserProfile);
  assert.notEqual(profile.interests, currentUserProfile.interests);
  assert.notEqual(profile.destinations, currentUserProfile.destinations);
});

test('returns saved profile values on repeated session reads', () => {
  const initialSession = createCurrentUserProfileSession();
  const savedSession = saveCurrentUserProfile(initialSession, {
    ...currentUserProfile,
    name: 'Алина Петрова',
    interests: ['Вечеринки'],
    budgetLevel: 3
  });

  assert.equal(getCurrentUserProfile(savedSession).name, 'Алина Петрова');
  assert.deepEqual(getCurrentUserProfile(savedSession).interests, ['Вечеринки']);
  assert.equal(getCurrentUserProfile(savedSession).budgetLevel, 3);
  assert.deepEqual(getCurrentUserProfile(initialSession), currentUserProfile);
});

test('does not change the saved session profile when a draft is cancelled without saving', () => {
  const savedSession = saveCurrentUserProfile(createCurrentUserProfileSession(), {
    ...currentUserProfile,
    city: 'Москва'
  });
  const cancelledDraft = {
    ...createProfileDraft(getCurrentUserProfile(savedSession)),
    city: 'Казань',
    interests: ['Технологии'] as const
  };

  assert.notDeepEqual(cancelledDraft, getCurrentUserProfile(savedSession));
  assert.equal(getCurrentUserProfile(savedSession).city, 'Москва');
  assert.deepEqual(getCurrentUserProfile(savedSession).interests, currentUserProfile.interests);
});

test('converts a profile draft into a trimmed matching profile', () => {
  const profile = toUserProfile({
    ...createProfileDraft(currentUserProfile),
    name: '  Алина  ',
    city: '  Москва  ',
    destinations: ' Тбилиси, , Стамбул , '
  });

  assert.equal(profile.name, 'Алина');
  assert.equal(profile.city, 'Москва');
  assert.deepEqual(profile.destinations, ['Тбилиси', 'Стамбул']);
});
