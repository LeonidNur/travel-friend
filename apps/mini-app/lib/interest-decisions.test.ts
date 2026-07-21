import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getBuddyById } from './mock-buddies';
import type { BuddyProfile, InterestDecision } from './types';
import type { InterestDecisions } from './interest-decisions';
import type * as InterestDecisionsModule from './interest-decisions';

type IsEqual<Actual, Expected> = (
  (<Value>() => Value extends Actual ? 1 : 2) extends
  (<Value>() => Value extends Expected ? 1 : 2) ? true : false
);

const interestDecisionsModule: typeof InterestDecisionsModule = await import(
  new URL('./interest-decisions.ts', import.meta.url).href
);

const {
  getPositiveInterestDecision,
  getRemainingDiscoverCandidates,
  getSelectedDiscoverBuddies,
  getViewedDiscoverCount,
  setInterestDecision
} = interestDecisionsModule;

const discoverCandidates = [
  { id: 'timur-safonov' },
  { id: 'maria-ivanova' },
  { id: 'egor-belyaev' }
] as BuddyProfile[];

test('returns match only when a buddy has already liked the current user', () => {
  assert.equal(getPositiveInterestDecision({ likedYou: true }), 'match');
  assert.equal(getPositiveInterestDecision({ likedYou: false }), 'interest-sent');
});

test('returns match for Timur, consistent with the existing matched chat fixture', () => {
  const timur = getBuddyById('timur-safonov');

  assert.ok(timur);
  assert.equal(getPositiveInterestDecision(timur), 'match');
});

test('keeps the first interest decision for a buddy', () => {
  const firstDecisions = setInterestDecision({}, 'maria-ivanova', 'match');
  const repeatedDecision = setInterestDecision(firstDecisions, 'maria-ivanova', 'rejected');

  assert.equal(repeatedDecision, firstDecisions);
  assert.deepEqual(repeatedDecision, { 'maria-ivanova': 'match' });
});

test('returns no decision for an unknown buddy id', () => {
  const decisions: InterestDecisions = { 'maria-ivanova': 'match' };

  assert.ok(true satisfies IsEqual<InterestDecisions[string], InterestDecision | undefined>);
  assert.equal(decisions['unknown-buddy'], undefined);
});

test('derives remaining, viewed, and selected Discover buddies from decisions', () => {
  const decisions = {
    'timur-safonov': 'interest-sent',
    'maria-ivanova': 'rejected',
    'not-a-discover-candidate': 'match'
  } as const;

  assert.deepEqual(
    getRemainingDiscoverCandidates(discoverCandidates, decisions).map((buddy) => buddy.id),
    ['egor-belyaev']
  );
  assert.equal(getViewedDiscoverCount(discoverCandidates, decisions), 2);
  assert.deepEqual(
    getSelectedDiscoverBuddies(discoverCandidates, decisions).map(({ buddy, decision }) => ({
      buddyId: buddy.id,
      decision
    })),
    [{ buddyId: 'timur-safonov', decision: 'interest-sent' }]
  );
});
