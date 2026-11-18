import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createElement, useState } from 'react';
import { JSDOM } from 'jsdom';

import { TripProposalPanel } from '../components/TripProposalPanel';
import { ApiError } from './backend-api-client';
import type { TripProposalResponse, TripProposalSummaryResponse } from './backend-api-client';

const pending: TripProposalSummaryResponse = {
  id: 'budget-proposal', trip_id: 'trip', creator_user_id: 'author', title: 'Изменение бюджета',
  status: 'pending', draft_version: 4, deadline: null, blocked_reason: null, created_at: '2026-11-19', decided_at: null,
  own_vote: null, scopes: ['budget'], prerequisite_proposal_ids: [], voters: [
    { user_id: 'author', vote: 'accept', voted_at: '2026-11-19' }, { user_id: 'me', vote: null, voted_at: null }
  ]
};
const pendingDetail: TripProposalResponse = {
  ...pending, operations: [{ scope: 'budget', expected_version: 2, old_value: { min: 100 }, proposed_value: { min: 200, max: 300, currency: 'RUB', scope: 'per_person' } }]
};
const other = { ...pending, id: 'date-proposal', title: 'Изменение дат', scopes: ['dates'] };
const otherDetail = { ...other, operations: [{ scope: 'dates', expected_version: 1, old_value: null, proposed_value: '2026-12-01' }] };

test('proposal opens from history, preserves the vote on 409 and transitions only on server acceptance', async () => {
  const dom = new JSDOM('<main></main>', { url: 'http://localhost' });
  const globals = ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Event', 'MouseEvent'] as const;
  const previous = new Map(globals.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const key of globals) {
    Object.defineProperty(globalThis, key, { configurable: true, value: (dom.window as unknown as Record<string, unknown>)[key] });
  }
  const previousActEnvironment = Reflect.get(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
  const { createRoot } = await import('react-dom/client');
  const container = dom.window.document.querySelector('main');
  assert.ok(container);
  const root = createRoot(container);

  let reads = 0;
  let votes = 0;
  let refreshes = 0;
  let historyVisits = 0;
  let dateProposalAccepted = false;
  const api = {
    getTripProposals: async () => [pending, dateProposalAccepted ? { ...other, status: 'accepted' as const } : other],
    getTripProposal: async (_token: string, _trip: string, id: string) => {
      reads++;
      return id === pending.id ? pendingDetail : dateProposalAccepted ? { ...otherDetail, status: 'accepted' as const } : otherDetail;
    },
    voteTripProposal: async (_token: string, _trip: string, id: string) => {
      votes++;
      if (id === other.id) {
        dateProposalAccepted = true;
        throw new ApiError(409, { detail: 'conflict' });
      }
      if (votes === 1) throw new ApiError(409, { detail: 'conflict' });
      return { ...pendingDetail, status: 'accepted' as const, own_vote: 'accept' as const,
        voters: pending.voters.map((voter) => voter.user_id === 'me' ? { ...voter, vote: 'accept' as const } : voter) };
    },
    cancelTripProposal: async () => { throw new Error('Unexpected cancellation'); }
  };

  function Harness() {
    const [focusedProposalId, setFocusedProposalId] = useState<string | null>(null);
    // eslint-disable-next-line react/no-children-prop -- This child is a render function, not a ReactNode.
    return createElement(TripProposalPanel, {
      token: 'preview-token', userId: 'me', tripId: 'trip', api, participantLabel: (id: string) => id,
      onAccepted: () => { refreshes++; }, focusedProposalId, onOpenProposal: setFocusedProposalId,
      onCloseProposal: () => setFocusedProposalId(null),
      onOpenHistory: () => { historyVisits++; setFocusedProposalId(null); },
      confirmedContext: () => createElement('aside', null, 'Согласованный бюджет: 100'),
      children: (_renderAtScope, history) => history
    });
  }

  function findButton(text: string, occurrence = 0): HTMLButtonElement {
    const element = [...container!.querySelectorAll('button')].filter((button) => button.textContent === text)[occurrence];
    assert.ok(element, text);
    return element;
  }

  try {
    await act(async () => root.render(createElement(Harness)));
    assert.equal(reads, 0);
    await act(async () => findButton('Открыть предложение').click());
    assert.equal(reads, 1);
    assert.match(container.textContent ?? '', /Согласованный бюджет: 100/);
    assert.match(container.querySelector('.trip-proposal-card__diff')?.textContent ?? '', /200–300 RUB · на человека/);
    const radio = container.querySelector<HTMLInputElement>('input[type="radio"]');
    assert.ok(radio);
    await act(async () => radio.click());
    await act(async () => findButton('Проголосовать').click());
    assert.equal(votes, 1);
    assert.equal(refreshes, 0);
    assert.equal(container.querySelector('input[type="radio"]'), null, 'voting controls are hidden until reload');
    assert.match(container.textContent ?? '', /Выбранное решение: Принять/);
    await act(async () => findButton('Назад').click());
    await act(async () => findButton('Открыть предложение', 1).click());
    assert.equal(reads, 2);
    assert.ok(!container.querySelector('[role="alert"]'), '409 belongs only to the first proposal');
    await act(async () => findButton('Назад').click());
    await act(async () => findButton('Открыть предложение').click());
    await act(async () => findButton('Обновить предложение').click());
    assert.equal(reads, 3);
    assert.ok(container.querySelector<HTMLInputElement>('input[type="radio"]')?.checked);
    await act(async () => findButton('Проголосовать').click());
    assert.equal(votes, 2);
    assert.equal(refreshes, 1);
    assert.match(container.textContent ?? '', /Все участники приняли/);
    assert.equal(container.querySelector('input[type="radio"]'), null);
    await act(async () => findButton('История предложений').click());
    assert.equal(historyVisits, 1);
    assert.equal(container.querySelector('.trip-vote-screen'), null);
    assert.match(container.textContent ?? '', /Завершённые · 1/);

    await act(async () => findButton('Открыть предложение').click());
    await act(async () => container.querySelector<HTMLInputElement>('input[type="radio"]')?.click());
    await act(async () => findButton('Проголосовать').click());
    assert.equal(refreshes, 1, 'do not refresh confirmed on the 409 response');
    await act(async () => findButton('Обновить предложение').click());
    assert.match(container.querySelector('.trip-vote-screen')?.textContent ?? '', /Все участники приняли/);
    assert.equal(refreshes, 2, 'refresh confirmed after reload discovers server acceptance');
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    if (previousActEnvironment === undefined) Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
    else Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousActEnvironment);
  }
});
