import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CURRENT_USER_ID, currentUserProfile } from './mock-current-user';
import {
  assertDiscoverCandidateFixtures,
  getBuddyById,
  getDiscoverCandidates,
  mockBuddies
} from './mock-buddies';

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
