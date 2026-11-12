import assert from 'node:assert/strict';
import test from 'node:test';

import { getProposalDisplayScope, proposalScopesOverlap, shouldRenderProposalAtScope } from './trip-proposal-placement';

test('places each itinerary proposal at one matching context', () => {
  const scopes = [
    ['itinerary:all'],
    ['itinerary:day:day-1'],
    ['itinerary:event:day-1:event-1']
  ];
  const contexts = ['itinerary:all', 'itinerary:day:day-1', 'itinerary:event:day-1:event-1'];

  for (const proposalScopes of scopes) {
    const displayScope = getProposalDisplayScope(proposalScopes);
    assert.ok(displayScope);
    assert.deepEqual(contexts.filter((scope) => shouldRenderProposalAtScope(proposalScopes, scope)), [displayScope]);
  }
});

test('places multiple itinerary changes at their closest common context', () => {
  assert.equal(getProposalDisplayScope(['itinerary:event:day-1:event-1', 'itinerary:event:day-1:event-2']), 'itinerary:day:day-1');
  assert.equal(getProposalDisplayScope(['itinerary:day:day-1', 'itinerary:day:day-2']), 'itinerary:all');
  assert.equal(getProposalDisplayScope(['budget', 'itinerary:event:day-1:event-1']), 'budget');
});

test('keeps itinerary scope overlap rules for conflicting proposals', () => {
  assert.equal(proposalScopesOverlap('itinerary:all', 'itinerary:day:day-1'), true);
  assert.equal(proposalScopesOverlap('itinerary:all', 'itinerary:event:day-1:event-1'), true);
  assert.equal(proposalScopesOverlap('itinerary:day:day-1', 'itinerary:event:day-1:event-1'), true);
  assert.equal(proposalScopesOverlap('itinerary:event:day-1:event-1', 'itinerary:event:day-1:event-2'), true);
  assert.equal(proposalScopesOverlap('itinerary:day:day-1', 'itinerary:day:day-2'), false);
  assert.equal(proposalScopesOverlap('budget', 'itinerary:all'), false);
});
