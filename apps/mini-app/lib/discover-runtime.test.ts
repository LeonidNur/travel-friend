import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import type { DiscoverCandidateResponse } from './backend-api-client';
import {
  createInitialDiscoverState,
  discoverReducer,
  getDiscoverLevelLabels,
  getCurrentDiscoverCandidate,
  toDiscoverCardCandidate
} from './discover-runtime';

const candidates: DiscoverCandidateResponse[] = [
  {
    user_id: 'a9fd99bf-cd65-4a2e-a99a-970ea0f54192',
    display_name: 'Алина',
    age: 29,
    city: 'Москва',
    bio: 'Люблю долгие прогулки.',
    travel_style: ['Городской'],
    interests: ['Архитектура'],
    budget_level: '2',
    comfort_level: '3',
    travel_intent: { destination: 'Тбилиси', date_from: '2026-10-03', date_to: '2026-10-10' }
  },
  {
    user_id: 'b6d943c5-432a-454b-8603-742eaa15aef4',
    display_name: 'Илья',
    age: null,
    city: null,
    bio: null,
    travel_style: [],
    interests: [],
    budget_level: null,
    comfort_level: null,
    travel_intent: { destination: 'Алтай', date_from: null, date_to: null }
  }
];

test('maps only fields returned by the Discover backend without mock fallbacks', () => {
  const cardCandidate = toDiscoverCardCandidate(candidates[1]);

  assert.deepEqual(cardCandidate, {
    userId: 'b6d943c5-432a-454b-8603-742eaa15aef4',
    displayName: 'Илья',
    age: null,
    city: null,
    bio: null,
    travelStyle: [],
    interests: [],
    budgetLevel: null,
    comfortLevel: null,
    travelIntent: { destination: 'Алтай', dateFrom: null, dateTo: null }
  });
  assert.equal('tagline' in cardCandidate, false);
  assert.equal('likedYou' in cardCandidate, false);
  assert.equal('destinations' in cardCandidate, false);
});

test('maps canonical Discover budget and comfort levels through Profile labels', () => {
  assert.deepEqual(
    ['1', '2', '3', '4'].map((level) => getDiscoverLevelLabels(level, level)),
    [
      { budget: '$', comfort: 'Максимально просто, хостелы и минимум удобств' },
      { budget: '$$', comfort: 'Базовый комфорт: чисто, безопасно, без люкса' },
      { budget: '$$$', comfort: 'Хороший комфорт: удобное жильё и меньше компромиссов' },
      { budget: '$$$$', comfort: 'Высокий комфорт: отели, приватность, удобная логистика' }
    ]
  );
});

test('does not display null or unknown Discover levels', () => {
  assert.deepEqual(getDiscoverLevelLabels(null, null), { budget: null, comfort: null });
  assert.deepEqual(getDiscoverLevelLabels('unexpected', 'medium'), { budget: null, comfort: null });
});

test('models loading, load error, empty, and loaded Discover states', () => {
  const loadingState = createInitialDiscoverState();
  assert.equal(loadingState.loading, true);

  const errorState = discoverReducer(loadingState, { type: 'load_failed' });
  assert.deepEqual(errorState, { ...loadingState, loading: false, loadError: true });

  const emptyState = discoverReducer(loadingState, { type: 'load_succeeded', candidates: [] });
  assert.equal(emptyState.loading, false);
  assert.equal(getCurrentDiscoverCandidate(emptyState), null);

  const loadedState = discoverReducer(loadingState, { type: 'load_succeeded', candidates });
  assert.equal(getCurrentDiscoverCandidate(loadedState)?.display_name, 'Алина');
});

test('advances the current candidate only after a successful decision response', () => {
  const loadedState = discoverReducer(createInitialDiscoverState(), { type: 'load_succeeded', candidates });
  const submittingState = discoverReducer(loadedState, { type: 'decision_started' });

  assert.equal(getCurrentDiscoverCandidate(submittingState)?.display_name, 'Алина');

  const nextState = discoverReducer(submittingState, { type: 'decision_succeeded' });
  assert.equal(getCurrentDiscoverCandidate(nextState)?.display_name, 'Илья');
});

test('keeps the current candidate after a failed decision and permits retry', () => {
  const loadedState = discoverReducer(createInitialDiscoverState(), { type: 'load_succeeded', candidates });
  const submittingState = discoverReducer(loadedState, { type: 'decision_started' });
  const failedState = discoverReducer(submittingState, { type: 'decision_failed' });

  assert.equal(failedState.decisionError, true);
  assert.equal(failedState.submitting, false);
  assert.equal(getCurrentDiscoverCandidate(failedState)?.display_name, 'Алина');
  assert.equal(discoverReducer(failedState, { type: 'decision_started' }).submitting, true);
});

test('prevents duplicate decision submits while a request is pending', () => {
  const loadedState = discoverReducer(createInitialDiscoverState(), { type: 'load_succeeded', candidates });
  const submittingState = discoverReducer(loadedState, { type: 'decision_started' });

  assert.equal(discoverReducer(submittingState, { type: 'decision_started' }), submittingState);
});

test('a match_created decision response advances the flow without adding match state', () => {
  const loadedState = discoverReducer(createInitialDiscoverState(), { type: 'load_succeeded', candidates });
  const nextState = discoverReducer(
    discoverReducer(loadedState, { type: 'decision_started' }),
    { type: 'decision_succeeded' }
  );

  assert.equal(getCurrentDiscoverCandidate(nextState)?.user_id, candidates[1].user_id);
  assert.equal('matchCreated' in nextState, false);
});

test('keeps real Discover independent from local decisions and removes demo presentation', async () => {
  const pageSource = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');

  assert.equal(pageSource.includes('useInterestDecisions'), false);
  assert.equal(pageSource.includes("from '@/lib/mock-buddies'"), false);
  assert.equal(pageSource.includes('Демо-режим'), false);
  assert.equal(pageSource.includes('Осталось анкет'), false);
  assert.equal(pageSource.includes('Просмотрено'), false);
  assert.equal(pageSource.includes('текущем сеансе'), false);
});
