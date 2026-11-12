import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import type { Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import test from 'node:test';

import { TripDraftEditor } from '../components/TripDraftEditor';
import { ApiError } from './backend-api-client';
import type {
  BackendApiClient,
  TripDetailResponse,
  TripDraftAlternativeMetadataResponse,
  TripDraftAlternativeResponse,
  TripDraftContent,
  TripDraftDetailResponse,
  TripDraftResponse,
  TripDraftSaveRequest,
  TripProposalResponse,
  TripProposalSummaryResponse,
  TripItineraryDayResponse
} from './backend-api-client';

const content: TripDraftContent = {
  route_stops: [], date_from: null, date_to: null, accommodations: [], transport: [],
  budget: { min: null, max: null, currency: null, scope: null }, days: [], notes: ''
};
const trip: TripDetailResponse = {
  trip: {
    trip_id: 'trip-1', chat_id: 'chat-1', created_by_user_id: 'member-1', status: 'forming',
    membership_version: 1, state_version: 1, destination_version: 0, dates_version: 0,
    budget_version: 0, transport_version: 0, destination_status: 'empty', dates_status: 'empty',
    budget_status: 'empty', transport_status: 'empty', date_from: null, date_to: null,
    budget_min: null, budget_max: null, budget_currency: null, budget_scope: null,
    started_at: null, completed_at: null, cancelled_at: null,
    created_at: '2026-11-09T00:00:00Z', updated_at: '2026-11-09T00:00:00Z'
  }, route_stops: [], participants: [], accommodations: [], transport: []
};
const draft: TripDraftResponse = {
  trip_id: 'trip-1', version: 1, content, updated_by_user_id: 'member-1', updated_at: '2026-11-09T00:00:00Z'
};
const alternativeMetadata: TripDraftAlternativeMetadataResponse = {
  id: 'alternative-1', trip_id: 'trip-1', title: 'Маршрут у моря', created_by_user_id: 'member-2', created_at: '2026-11-09T00:00:00Z'
};
const alternative: TripDraftAlternativeResponse = { ...alternativeMetadata, content: { ...content, notes: 'Море' } };
const detail: TripDraftDetailResponse = { draft, alternatives: [alternativeMetadata] };
const proposal: TripProposalResponse = {
  id: 'proposal-1', trip_id: 'trip-1', creator_user_id: 'member-1', title: 'Согласовать бюджет',
  status: 'pending', draft_version: 1, deadline: null, blocked_reason: null,
  created_at: '2026-11-09T00:00:00Z', decided_at: null, own_vote: null,
  operations: [{ scope: 'budget', expected_version: 0, old_value: { min: null }, proposed_value: { min: '100' } }],
  voters: [
    { user_id: 'member-1', vote: null, voted_at: null },
    { user_id: 'member-2', vote: null, voted_at: null }
  ],
  prerequisite_proposal_ids: []
};
const proposalSummary: TripProposalSummaryResponse = {
  id: proposal.id, trip_id: proposal.trip_id, creator_user_id: proposal.creator_user_id,
  title: proposal.title, status: proposal.status, draft_version: proposal.draft_version,
  deadline: proposal.deadline, blocked_reason: proposal.blocked_reason, created_at: proposal.created_at,
  decided_at: proposal.decided_at, own_vote: proposal.own_vote,
  scopes: proposal.operations.map((operation) => operation.scope), voters: proposal.voters,
  prerequisite_proposal_ids: proposal.prerequisite_proposal_ids
};

function renderStatic(alternatives = detail.alternatives, tripData = trip): string {
  const api = createApi();
  return renderToStaticMarkup(createElement(TripDraftEditor, {
    token: 'session-token', userId: 'member-1', draft, trip: tripData, alternatives, confirmedDays: [], api,
    authorLabel: () => 'Участник', onProposalAccepted: () => undefined
  }));
}

function createApi(overrides: Partial<Pick<BackendApiClient,
  'getTripDraft' | 'getTripDraftAlternative' | 'saveTripDraft' | 'saveTripDraftAlternative' |
  'getTripProposals' | 'getTripProposal' | 'createTripProposal' | 'voteTripProposal' | 'cancelTripProposal'>> = {}) {
  return {
    getTripDraft: async (): Promise<TripDraftDetailResponse> => detail,
    getTripDraftAlternative: async (): Promise<TripDraftAlternativeResponse> => alternative,
    saveTripDraft: async (_token: string, _tripId: string, request: TripDraftSaveRequest): Promise<TripDraftResponse> => ({
      ...draft, version: 2, content: request.content
    }),
    saveTripDraftAlternative: async (): Promise<TripDraftAlternativeMetadataResponse> => alternativeMetadata,
    getTripProposals: async (): Promise<TripProposalSummaryResponse[]> => [],
    getTripProposal: async (): Promise<TripProposalResponse> => proposal,
    createTripProposal: async (): Promise<TripProposalResponse> => proposal,
    voteTripProposal: async (): Promise<TripProposalResponse> => ({ ...proposal, status: 'accepted', own_vote: 'accept' }),
    cancelTripProposal: async (): Promise<TripProposalResponse> => ({ ...proposal, status: 'cancelled' }),
    ...overrides
  };
}

async function mountEditor(api = createApi(), onProposalAccepted: () => void = () => undefined,
                           draftOverride: TripDraftResponse = draft,
                           confirmedDays: readonly TripItineraryDayResponse[] = [], tripOverride: TripDetailResponse = trip) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost' });
  const globals = ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Event', 'MouseEvent'] as const;
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const key of globals) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value: (dom.window as unknown as Record<string, unknown>)[key] });
  }
  const previousActEnvironment = Reflect.get(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
  const { createRoot } = await import('react-dom/client');
  const container = dom.window.document.getElementById('root');
  assert.ok(container);
  const root: Root = createRoot(container);
  await act(async () => root.render(createElement(TripDraftEditor, {
    token: 'session-token', userId: 'member-1', draft: draftOverride, trip: tripOverride, alternatives: detail.alternatives, confirmedDays,
    api, authorLabel: () => 'Участник', onProposalAccepted
  })));
  return {
    api,
    container,
    async updateDraft(nextDraft: TripDraftResponse) {
      await act(async () => root.render(createElement(TripDraftEditor, {
        token: 'session-token', userId: 'member-1', draft: nextDraft, trip: tripOverride, alternatives: detail.alternatives,
        confirmedDays, api, authorLabel: () => 'Участник', onProposalAccepted
      })));
    },
    async cleanup() {
      await act(async () => root.unmount());
      dom.window.close();
      for (const key of globals) {
        const descriptor = previous.get(key);
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
      if (previousActEnvironment === undefined) Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
      else Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousActEnvironment);
    }
  };
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find((item) => item.textContent?.includes(label));
  assert.ok(found, `button containing ${label} exists`);
  return found as HTMLButtonElement;
}

async function addAndEditFirstRouteStop(container: HTMLElement, value: string) {
  await act(async () => button(container, 'Добавить место').click());
  await changeInput(container, 'Место 1', value);
}

async function changeBudgetMin(container: HTMLElement, value: string) {
  const input = [...container.querySelectorAll('label')]
    .find((label) => label.textContent?.trim() === 'От')?.querySelector('input');
  assert.ok(input, 'budget minimum input exists');
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
}

async function changeInput(container: HTMLElement, labelText: string, value: string) {
  const input = [...container.querySelectorAll('label')]
    .find((label) => label.textContent?.trim() === labelText)?.querySelector('input');
  assert.ok(input, `${labelText} input exists`);
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
}

function fieldValue(container: HTMLElement, labelText: string): string {
  const input = [...container.querySelectorAll('label')]
    .find((label) => label.textContent?.trim() === labelText)?.querySelector('input');
  assert.ok(input, `${labelText} input exists`);
  return input.value;
}

test('renders shared Draft sections and a bounded alternatives metadata list in Russian', () => {
  const markup = renderStatic();
  assert.match(markup, /Рабочая версия поездки/);
  assert.match(markup, /Маршрут и даты/);
  assert.match(markup, /Проживание/);
  assert.match(markup, /Транспорт/);
  assert.match(markup, /Программа по дням/);
  assert.match(markup, /Есть изменение|Согласовано/);
  assert.doesNotMatch(markup, /Сохранить черновик/);
  assert.match(markup, /История предложений/);
  assert.match(markup, /Маршрут у моря/);
  assert.match(markup, /Открыть в редакторе/);
});

test('renders an explicit empty state when no alternatives have been saved', () => {
  assert.match(renderStatic([]), /Сохранённых вариантов пока нет/);
});

test('keeps confirmed route, dates, and budget visible in the primary Trip summary', () => {
  const confirmedTrip: TripDetailResponse = {
    ...trip,
    trip: { ...trip.trip, date_from: '2026-08-01', date_to: '2026-08-08', budget_min: '100', budget_max: '250', budget_currency: 'RUB', budget_scope: 'per_person' },
    route_stops: [{ id: 'stop-1', position: 1, place_label: 'Казань', country_code: 'RU', place_ref: null,
      stay_from: null, stay_to: null, notes: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }]
  };
  const markup = renderStatic([], confirmedTrip);
  assert.match(markup, /Казань/);
  assert.match(markup, /2026-08-01/);
  assert.match(markup, /2026-08-08/);
  assert.match(markup, /От: 100 · До: 250 · Валюта: RUB/);
  assert.match(markup, /Согласовано/);
});

test('network error preserves local section edits and explains that no Proposal was created', async () => {
  const api = createApi({ saveTripDraft: async () => { throw new ApiError(503, { detail: 'unavailable' }); } });
  const ui = await mountEditor(api);
  try {
    await changeBudgetMin(ui.container, '125');
    await act(async () => button(ui.container, 'Предложить бюджет').click());
    assert.match(ui.container.textContent ?? '', /Проверьте сеть и повторите/);
    assert.equal(fieldValue(ui.container, 'От'), '125');
    assert.equal(button(ui.container, 'Предложить бюджет').disabled, false);
  } finally {
    await ui.cleanup();
  }
});

test('refresh with a newer Draft preserves local edits and offers explicit conflict recovery', async () => {
  const ui = await mountEditor();
  try {
    await changeBudgetMin(ui.container, '125');
    await ui.updateDraft({ ...draft, version: 2, content: { ...content, budget: { ...content.budget, max: '900' } } });
    assert.equal(fieldValue(ui.container, 'От'), '125');
    assert.match(ui.container.textContent ?? '', /Общий черновик обновился/);
    assert.ok(button(ui.container, 'Загрузить актуальную версию'));
  } finally {
    await ui.cleanup();
  }
});

test('explicitly cleared Draft fields stay empty after refresh while confirmed values remain visible', async () => {
  const confirmedTrip: TripDetailResponse = {
    ...trip,
    trip: { ...trip.trip, date_from: '2026-08-01', date_to: '2026-08-08', budget_min: '100', budget_max: '250', budget_currency: 'RUB', budget_scope: 'per_person' },
    route_stops: [{ id: 'stop-1', position: 1, place_label: 'Казань', country_code: 'RU', place_ref: null,
      stay_from: null, stay_to: null, notes: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }]
  };
  const clearedDraft = { ...draft, version: 2, content };
  const ui = await mountEditor(createApi(), () => undefined, clearedDraft, [], confirmedTrip);
  try {
    assert.equal(fieldValue(ui.container, 'Начало поездки'), '');
    assert.equal(fieldValue(ui.container, 'От'), '');
    assert.match(ui.container.textContent ?? '', /В черновике: не указано/);
    await ui.updateDraft({ ...clearedDraft, version: 3 });
    assert.equal(fieldValue(ui.container, 'Начало поездки'), '');
    assert.equal(fieldValue(ui.container, 'От'), '');
    assert.match(ui.container.textContent ?? '', /Казань/);
  } finally {
    await ui.cleanup();
  }
});

test('invalid local dates do not block a valid budget Proposal and are excluded from its save', async () => {
  const validSavedContent = { ...content, date_from: '2026-08-01', date_to: '2026-08-08' };
  let submitted: TripDraftSaveRequest | undefined;
  let creates = 0;
  const api = createApi({
    saveTripDraft: async (_token, _tripId, request) => { submitted = request; return { ...draft, version: 2, content: request.content }; },
    createTripProposal: async () => { creates += 1; return proposal; }
  });
  const ui = await mountEditor(api, () => undefined, { ...draft, content: validSavedContent });
  try {
    await changeInput(ui.container, 'Начало поездки', '2026-08-12');
    await changeInput(ui.container, 'Окончание поездки', '2026-08-10');
    await changeBudgetMin(ui.container, '125');
    await act(async () => button(ui.container, 'Предложить бюджет').click());
    assert.equal(submitted?.content.date_from, '2026-08-01');
    assert.equal(submitted?.content.date_to, '2026-08-08');
    assert.equal(submitted?.content.budget.min, '125');
    assert.equal(creates, 1);
    await act(async () => button(ui.container, 'Предложить даты').click());
    assert.match(ui.container.textContent ?? '', /Дата окончания должна быть не раньше/);
    assert.equal(creates, 1);
  } finally {
    await ui.cleanup();
  }
});

test('opening an alternative fetches one snapshot and confirms before replacing dirty edits', async () => {
  let fetchCalls = 0;
  const api = createApi({
    getTripDraftAlternative: async () => { fetchCalls += 1; return alternative; }
  });
  const ui = await mountEditor(api);
  const originalConfirm = window.confirm;
  try {
    await addAndEditFirstRouteStop(ui.container, 'Самара');
    window.confirm = () => false;
    await act(async () => button(ui.container, 'Открыть в редакторе').click());
    assert.equal(fetchCalls, 0);
    assert.equal(fieldValue(ui.container, 'Место 1'), 'Самара');

    window.confirm = () => true;
    await act(async () => button(ui.container, 'Открыть в редакторе').click());
    assert.equal(fetchCalls, 1);
    assert.match(ui.container.textContent ?? '', /Море/);
    assert.match(ui.container.textContent ?? '', /предложите его участникам/);
  } finally {
    window.confirm = originalConfirm;
    await ui.cleanup();
  }
});

test('proposal action saves Draft first and creates an automatically scoped, named Proposal without changing Confirmed Trip', async () => {
  const calls: string[] = [];
  let submittedScopes: readonly string[] = [];
  let submittedTitle = '';
  const api = createApi({
    saveTripDraft: async (_token, _tripId, request) => {
      calls.push('save');
      assert.equal(request.content.notes, '');
      assert.equal(request.content.budget.min, null);
      assert.deepEqual(request.content.route_stops, []);
      return { ...draft, version: 2, content: request.content };
    },
    createTripProposal: async (_token, _tripId, request) => {
      calls.push('create');
      submittedScopes = request.scopes;
      submittedTitle = request.title;
      return { ...proposal, title: request.title, operations: [{ ...proposal.operations[0], scope: request.scopes[0] }] };
    }

  });
  const ui = await mountEditor(api);
  try {
    await addAndEditFirstRouteStop(ui.container, 'Самара');
    await act(async () => button(ui.container, 'Предложить бюджет').click());
    assert.deepEqual(calls, ['save', 'create']);
    assert.deepEqual(submittedScopes, ['budget']);
    assert.equal(submittedTitle, 'Изменение бюджета');
    assert.match(ui.container.textContent ?? '', /Предложение отправлено участникам/);
    assert.match(ui.container.textContent ?? '', /версия 2/);
    assert.equal(fieldValue(ui.container, 'Место 1'), 'Самара');
    assert.equal('updateTrip' in api, false);
  } finally {
    await ui.cleanup();
  }
});

test('a Proposal Draft version is not rolled back by the still-stale parent props', async () => {
  const api = createApi({ saveTripDraft: async (_token, _tripId, request) => ({ ...draft, version: 2, content: request.content }) });
  const ui = await mountEditor(api);
  try {
    await act(async () => button(ui.container, 'Предложить бюджет').click());
    assert.match(ui.container.textContent ?? '', /Рабочая версия поездки · версия 2/);
    assert.match(ui.container.textContent ?? '', /Предложение отправлено участникам/);
  } finally {
    await ui.cleanup();
  }
});

test('shows active Proposal status and readable comparison beside its matching Trip section', async () => {
  const api = createApi({ getTripProposals: async () => [proposalSummary] });
  const ui = await mountEditor(api);
  try {
    const card = ui.container.querySelector('.trip-proposal-card');
    assert.ok(card);
    assert.match(card.textContent ?? '', /На голосовании/);
    assert.match(card.textContent ?? '', /Было:/);
    assert.match(card.textContent ?? '', /Предлагается:/);
    assert.doesNotMatch(card.textContent ?? '', /\{"min"/);
    const section = card.closest('details.trip-draft-editor__section');
    assert.ok(section);
    assert.equal((section as HTMLDetailsElement).open, true);
  } finally {
    await ui.cleanup();
  }
});

test('retries uncertain Proposal creation with the same idempotency key without saving Draft or opening another vote', async () => {
  let saveCalls = 0;
  const keys: string[] = [];
  let createCalls = 0;
  const api = createApi({
    saveTripDraft: async (_token, _tripId, request) => {
      saveCalls += 1;
      return { ...draft, version: 2, content: request.content };
    },
    createTripProposal: async (_token, _tripId, request) => {
      createCalls += 1;
      keys.push(request.idempotency_key);
      if (createCalls === 1) throw new Error('connection lost after request');
      return { ...proposal, title: request.title, draft_version: request.draft_version };
    }
  });
  const ui = await mountEditor(api);
  try {
    await act(async () => button(ui.container, 'Предложить бюджет').click());
    assert.match(ui.container.textContent ?? '', /ответ на создание предложения не получен/);
    await act(async () => button(ui.container, 'Предложить бюджет').click());
    assert.equal(saveCalls, 1);
    assert.equal(createCalls, 2);
    assert.equal(keys[0], keys[1]);
  } finally {
    await ui.cleanup();
  }
});

test('422 prevents Draft save and proposal creation when local draft validation fails', async () => {
  const incomplete: TripDraftContent = {
    ...content,
    days: [{ id: 'day-1', date: null, title: null, notes: null, events: [
      { id: 'event-1', kind: 'activity', title: '', start_time: null, duration_minutes: null, address: null, estimated_cost: null, currency: null, notes: null }
    ] }]
  };
  let saves = 0;
  let creates = 0;
  const api = createApi({
    saveTripDraft: async () => { saves += 1; return draft; },
    createTripProposal: async () => { creates += 1; return proposal; }
  });
  const ui = await mountEditor(api, () => undefined, { ...draft, content: incomplete });
  try {
    await act(async () => button(ui.container, 'Предложить изменение дня').click());
    assert.match(ui.container.textContent ?? '', /У каждого события должно быть название/);
    assert.equal(saves, 0);
    assert.equal(creates, 0);
  } finally {
    await ui.cleanup();
  }
});

test('a competing Draft edit prevents Proposal creation and keeps the local value for recovery', async () => {
  let creates = 0;
  const api = createApi({
    saveTripDraft: async () => { throw new ApiError(409, { detail: 'version conflict' }); },
    getTripDraft: async () => ({
      draft: { ...draft, version: 2, content: { ...content, notes: 'Правка другого участника' } },
      alternatives: []
    }),
    createTripProposal: async () => { creates += 1; return proposal; }
  });
  const ui = await mountEditor(api);
  try {
    await addAndEditFirstRouteStop(ui.container, 'Моя правка');
    await act(async () => button(ui.container, 'Предложить бюджет').click());
    assert.match(ui.container.textContent ?? '', /изменился у другого участника/);
    assert.equal(fieldValue(ui.container, 'Место 1'), 'Моя правка');
    assert.equal(creates, 0);
  } finally {
    await ui.cleanup();
  }
});

test('scope-busy 409 displays the existing vote and disables duplicate creation', async () => {
  let listReads = 0;
  const api = createApi({
    getTripProposals: async () => { listReads += 1; return listReads === 1 ? [] : [proposalSummary]; },
    createTripProposal: async () => { throw new ApiError(409, { detail: { code: 'proposal_scope_busy' } }); }
  });
  const ui = await mountEditor(api);
  try {
    await act(async () => button(ui.container, 'Предложить бюджет').click());
    assert.match(ui.container.textContent ?? '', /уже идёт голосование/);
    assert.ok(ui.container.querySelector('.trip-proposal-card'));
    assert.equal((button(ui.container, 'Предложить бюджет') as HTMLButtonElement).disabled, true);
  } finally {
    await ui.cleanup();
  }
});

test('an active whole-day Proposal is shown beside and disables event-level proposals for that day', async () => {
  const dayId = '10000000-0000-4000-8000-000000000001';
  const eventId = '20000000-0000-4000-8000-000000000001';
  const dayContent: TripDraftContent = {
    ...content,
    days: [{ id: dayId, date: null, title: 'Первый день', notes: null, events: [
      { id: eventId, kind: 'activity', title: 'Музей', start_time: null, duration_minutes: null, address: null, estimated_cost: null, currency: null, notes: null }
    ] }]
  };
  const dayProposal = { ...proposalSummary, scopes: [`itinerary:day:${dayId}`] };
  const confirmedDay: TripItineraryDayResponse = {
    id: dayId, position: 1, day_date: null, title: 'Первый день', notes: null,
    events: [{ id: eventId, day_id: dayId, position: 1, kind: 'activity', title: 'Музей', start_time: null, duration_minutes: null, address: null, estimated_cost: null, currency: null, notes: null }]
  };
  const ui = await mountEditor(createApi({ getTripProposals: async () => [dayProposal] }), () => undefined,
    { ...draft, content: dayContent }, [confirmedDay]);
  try {
    assert.equal((button(ui.container, 'Предложить событие') as HTMLButtonElement).disabled, true);
    assert.ok(ui.container.querySelector('.trip-proposal-card'));
  } finally {
    await ui.cleanup();
  }
});

test('stale scope 409 offers current Draft reload instead of retrying an invalid idempotent request', async () => {
  const api = createApi({
    getTripProposals: async () => [],
    createTripProposal: async () => { throw new ApiError(409, { detail: 'scope version changed' }); }
  });
  const ui = await mountEditor(api);
  try {
    await act(async () => button(ui.container, 'Предложить бюджет').click());
    assert.match(ui.container.textContent ?? '', /Версия поездки или согласованные данные изменились/);
    assert.ok(button(ui.container, 'Загрузить актуальную версию'));
  } finally {
    await ui.cleanup();
  }
});

test('vote selection remains available after a recoverable failure and refreshes Confirmed Trip only on acceptance', async () => {
  let attempts = 0;
  let acceptedRefreshes = 0;
  const api = createApi({
    getTripProposals: async () => [proposalSummary],
    voteTripProposal: async () => {
      attempts += 1;
      if (attempts === 1) throw new ApiError(503, { detail: 'unavailable' });
      return { ...proposal, status: 'accepted', own_vote: 'accept' };
    }
  });
  const dom = await mountEditor(api, () => { acceptedRefreshes += 1; });
  try {
    const acceptRadio = [...dom.container.querySelectorAll('label')]
      .find((item) => item.textContent?.includes('Принять'))?.querySelector('input');
    assert.ok(acceptRadio);
    await act(async () => acceptRadio.click());
    await act(async () => button(dom.container, 'Проголосовать').click());
    assert.equal((acceptRadio as HTMLInputElement).checked, true);
    assert.match(dom.container.textContent ?? '', /можно повторить/);
    await act(async () => button(dom.container, 'Проголосовать').click());
    assert.equal(attempts, 2);
    assert.match(dom.container.textContent ?? '', /Подтверждённая поездка обновлена/);
    assert.equal(acceptedRefreshes, 1);
    assert.equal('updateTrip' in api, false);
  } finally {
    await dom.cleanup();
  }
});

test('loads immutable old-to-proposed values inline beside the edited section', async () => {
  let detailReads = 0;
  const api = createApi({
    getTripProposals: async () => [proposalSummary],
    getTripProposal: async () => { detailReads += 1; return proposal; }
  });
  const ui = await mountEditor(api);
  try {
    assert.equal(detailReads, 1);
    assert.ok(ui.container.querySelector('.trip-proposal-card__diff'));
    assert.match(ui.container.textContent ?? '', /Было:/);
    assert.match(ui.container.textContent ?? '', /100/);
  } finally {
    await ui.cleanup();
  }
});

test('409 vote conflict keeps the selected vote and explains that current state must be reloaded', async () => {
  let acceptedRefreshes = 0;
  let listReads = 0;
  const api = createApi({
    getTripProposals: async () => {
      listReads += 1;
      return [listReads === 1 ? proposalSummary : { ...proposalSummary, status: 'accepted' }];
    },
    voteTripProposal: async () => { throw new ApiError(409, { detail: 'conflict' }); }
  });
  const ui = await mountEditor(api, () => { acceptedRefreshes += 1; });
  try {
    const acceptRadio = [...ui.container.querySelectorAll('label')]
      .find((item) => item.textContent?.includes('Принять'))?.querySelector('input');
    assert.ok(acceptRadio);
    await act(async () => acceptRadio.click());
    await act(async () => button(ui.container, 'Проголосовать').click());
    assert.equal((acceptRadio as HTMLInputElement).checked, true);
    assert.match(ui.container.textContent ?? '', /Состояние предложения изменилось/);
    assert.equal(acceptedRefreshes, 0);
    await act(async () => button(ui.container, 'Обновить').click());
    assert.equal(listReads, 2);
    assert.match(ui.container.textContent ?? '', /Принято/);
    assert.equal(ui.container.querySelector('input[type="radio"]'), null);
  } finally {
    await ui.cleanup();
  }
});

test('creates an event-level Proposal for only the event where the action was invoked', async () => {
  const dayId = '10000000-0000-4000-8000-000000000001';
  const eventId = '20000000-0000-4000-8000-000000000001';
  const siblingId = '20000000-0000-4000-8000-000000000002';
  const eventContent: TripDraftContent = {
    ...content,
    days: [{
      id: dayId, date: null, title: 'Первый день', notes: null,
      events: [
        { id: eventId, kind: 'activity', title: 'Музей', start_time: null, duration_minutes: null, address: null, estimated_cost: null, currency: null, notes: null },
        { id: siblingId, kind: 'meal', title: 'Обед', start_time: null, duration_minutes: null, address: null, estimated_cost: null, currency: null, notes: null }
      ]
    }]
  };
  let submittedScopes: readonly string[] = [];
  const api = createApi({ createTripProposal: async (_token, _tripId, request) => {
    submittedScopes = request.scopes;
    return { ...proposal, operations: [{ scope: request.scopes[0], expected_version: 0,
      old_value: { id: eventId, title: 'Музей' }, proposed_value: { id: eventId, title: 'Музей' } }] };
  } });
  const ui = await mountEditor(api, () => undefined, { ...draft, content: eventContent }, [
    { id: dayId, position: 1, day_date: null, title: 'Первый день', notes: null, events: [] }
  ]);
  try {
    await act(async () => button(ui.container, 'Предложить событие').click());
    assert.deepEqual(submittedScopes, [`itinerary:event:${dayId}:${eventId}`]);
    assert.match(ui.container.querySelector('.trip-proposal-card')?.textContent ?? '', /Согласовать бюджет · На голосовании/);
  } finally {
    await ui.cleanup();
  }
});

test('event-level Proposal is disabled until its parent day is confirmed', async () => {
  const dayId = '10000000-0000-4000-8000-000000000001';
  const eventId = '20000000-0000-4000-8000-000000000001';
  const eventContent: TripDraftContent = {
    ...content,
    days: [{ id: dayId, date: null, title: 'Новый день', notes: null,
      events: [{ id: eventId, kind: 'activity', title: 'Новое событие', start_time: null,
        duration_minutes: null, address: null, estimated_cost: null, currency: null, notes: null }] }]
  };
  const ui = await mountEditor(createApi(), () => undefined, { ...draft, content: eventContent });
  try {
    assert.equal((button(ui.container, 'Предложить событие') as HTMLButtonElement).disabled, true);
    assert.match(ui.container.textContent ?? '', /Сначала согласуйте день/);
  } finally {
    await ui.cleanup();
  }
});
