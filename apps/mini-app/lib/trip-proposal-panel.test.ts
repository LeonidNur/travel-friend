import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createElement, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';

import { TripProposalPanel, TripProposalView } from '../components/TripProposalPanel';
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
  let listReads = 0;
  let votes = 0;
  let refreshes = 0;
  let historyVisits = 0;
  let dateProposalAccepted = false;
  const rejected = { ...other, id: 'rejected-route', title: 'Изменение маршрута', scopes: ['route'], status: 'rejected' as const,
    voters: other.voters.map((voter) => voter.user_id === 'me' ? { ...voter, vote: 'reject' as const } : voter)
  };
  const api = {
    getTripProposals: async () => {
      listReads++;
      if (listReads === 1) throw new Error('Temporary request failure');
      return [pending, dateProposalAccepted ? { ...other, status: 'accepted' as const } : other, rejected];
    },
    getTripProposal: async (_token: string, _trip: string, id: string) => {
      reads++;
      if (id === rejected.id) return { ...rejected, operations: [{ scope: 'route', expected_version: 1, old_value: null, proposed_value: [] }] };
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
    assert.match(container.querySelector('[role="alert"]')?.textContent ?? '', /Не удалось загрузить предложения/);
    assert.doesNotMatch(container.textContent ?? '', /Предложений пока нет/);
    const retryHistory = container.querySelector<HTMLButtonElement>('header button[aria-label="Обновить предложения"]');
    assert.ok(retryHistory);
    await act(async () => retryHistory.click());
    assert.equal(listReads, 2);
    assert.equal(container.querySelector('[role="alert"]'), null);
    assert.equal(reads, 0);
    const compact = container.querySelector<HTMLButtonElement>('.trip-vote-link--compact');
    assert.ok(compact);
    assert.match(compact.textContent ?? '', /Маршрут · отклонено/);
    assert.match(compact.textContent ?? '', /me · голос против/);
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
    assert.match(container.textContent ?? '', /Завершённые · 2/);
    assert.match(container.textContent ?? '', /author · все участники приняли/);
    await act(async () => findButton('Открыть сравнение бюджета').click());
    assert.match(container.querySelector('.trip-vote-screen')?.textContent ?? '', /Все участники приняли/);
    assert.equal(votes, 2, 'opening accepted history never submits a vote');
    await act(async () => findButton('Назад').click());

    await act(async () => findButton('Открыть предложение').click());
    await act(async () => container.querySelector<HTMLInputElement>('input[type="radio"]')?.click());
    await act(async () => findButton('Проголосовать').click());
    assert.equal(refreshes, 1, 'do not refresh confirmed on the 409 response');
    await act(async () => findButton('Обновить предложение').click());
    assert.match(container.querySelector('.trip-vote-screen')?.textContent ?? '', /Все участники приняли/);
    assert.equal(refreshes, 2, 'refresh confirmed after reload discovers server acceptance');
    await act(async () => findButton('Назад').click());
    const rejectedRow = container.querySelector<HTMLButtonElement>('.trip-vote-link--compact');
    assert.ok(rejectedRow);
    await act(async () => rejectedRow.click());
    assert.match(container.querySelector('.trip-vote-screen')?.textContent ?? '', /Маршрут · предложение/);
    assert.equal(container.querySelector('input[type="radio"]'), null);
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

test('focused blocked proposal explains the prerequisite after the comparison and voter list', () => {
  const detail: TripProposalResponse = {
    ...pendingDetail, status: 'blocked', blocked_reason: 'prerequisite_pending'
  };
  const markup = renderToStaticMarkup(createElement(TripProposalView, {
    detail, proposal: { ...detail, scopes: ['budget'] }, userId: 'author', participantLabel: (id) => id
  }));
  const explanation = markup.indexOf('Ожидает принятия связанного предложения');
  assert.ok(explanation > markup.indexOf('ожидается голос'));
  assert.ok(explanation > markup.indexOf('Предлагается'));
  assert.doesNotMatch(markup, /Проголосовать/);
});

test('cancel in progress never masquerades as sending the selected vote', () => {
  const props = {
    detail: pendingDetail, proposal: pending, userId: 'author', participantLabel: (id: string) => id,
    saving: true, voteChoice: 'reject' as const, onCancel: () => undefined
  };
  const cancelling = renderToStaticMarkup(createElement(TripProposalView, props));
  assert.doesNotMatch(cancelling, /Отправляем голос/);
  assert.match(cancelling, /Отменить предложение/);
  const voting = renderToStaticMarkup(createElement(TripProposalView, { ...props, submittingVote: true }));
  assert.match(voting, /Отправляем голос/);
  assert.doesNotMatch(voting, /Отменить предложение/);
});

test('a failed vote has one alert and retains the selection, retry and contextual Back', () => {
  const markup = renderToStaticMarkup(createElement(TripProposalView, {
    detail: pendingDetail, proposal: pending, userId: 'me', participantLabel: (id) => id,
    error: 'Не удалось сохранить голос. Выбор остался на экране; можно повторить.',
    voteError: true, voteChoice: 'accept', onVote: () => undefined, onClose: () => undefined
  }));
  assert.equal(markup.match(/Не удалось сохранить голос/g)?.length, 1);
  assert.match(markup, /role="alert"/);
  assert.match(markup, /type="radio"[^>]*checked/);
  assert.match(markup, /type="button">Проголосовать/);
  assert.match(markup, /<header[^>]*>.*Назад<\/button><\/header>/);
});
