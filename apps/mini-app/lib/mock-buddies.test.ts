import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createCurrentUserProfileSession,
  getCurrentUserProfile,
  saveCurrentUserProfile
} from './current-user-profile-session';
import { CURRENT_USER_ID, currentUserProfile } from './mock-current-user';
import {
  assertDiscoverCandidateFixtures,
  getBuddyById,
  getBuddyMatchSignals,
  getDiscoverCandidates,
  mockBuddies
} from './mock-buddies';
import type { UserProfile } from './types';

test('keeps the current user fixture separate from Discover candidates', () => {
  assert.equal(currentUserProfile.id, CURRENT_USER_ID);
  assert.ok(mockBuddies.every((buddy) => buddy.id !== CURRENT_USER_ID));
  assert.ok(getDiscoverCandidates().length > 0);
});

test('excludes the current user by id regardless of candidate order', () => {
  const selfCandidate = {
    ...mockBuddies[0],
    id: CURRENT_USER_ID
  };
  const shuffledCandidates = [mockBuddies[1], selfCandidate, mockBuddies[0]];

  const discoverCandidates = getDiscoverCandidates(shuffledCandidates);

  assert.deepEqual(
    discoverCandidates.map((buddy) => buddy.id),
    [mockBuddies[1].id, mockBuddies[0].id]
  );
});

test('rejects duplicate buddy ids in Discover fixtures', () => {
  assert.throws(
    () => assertDiscoverCandidateFixtures([...mockBuddies, mockBuddies[0]]),
    /Duplicate buddy id/
  );
});

test('rejects the current user in Discover fixtures', () => {
  const selfCandidate = {
    ...mockBuddies[0],
    id: CURRENT_USER_ID
  };

  assert.throws(
    () => assertDiscoverCandidateFixtures([...mockBuddies, selfCandidate]),
    /Current user id/
  );
});

test('keeps every Discover candidate available as a public buddy profile', () => {
  for (const candidate of getDiscoverCandidates()) {
    assert.equal(getBuddyById(candidate.id)?.id, candidate.id);
  }
});

test('uses updated current-user interests and budget for Discover match signals', () => {
  const savedSession = saveCurrentUserProfile(createCurrentUserProfileSession(), {
    ...currentUserProfile,
    interests: ['Вечеринки'],
    budgetLevel: 3
  } satisfies UserProfile);

  const matchSignals = getBuddyMatchSignals(mockBuddies[0], getCurrentUserProfile(savedSession));

  assert.deepEqual(matchSignals.matchedInterests, ['Вечеринки']);
  assert.equal(matchSignals.isBudgetMatch, true);
});
