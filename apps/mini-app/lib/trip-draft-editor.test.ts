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

function renderStatic(alternatives = detail.alternatives): string {
  const api = createApi();
  return renderToStaticMarkup(createElement(TripDraftEditor, {
    token: 'session-token', userId: 'member-1', draft, alternatives, confirmedDays: [], api,
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
                           confirmedDays: readonly TripItineraryDayResponse[] = []) {
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
    token: 'session-token', userId: 'member-1', draft: draftOverride, alternatives: detail.alternatives, confirmedDays,
    api, authorLabel: () => 'Участник', onProposalAccepted
  })));
  return {
    api,
    container,
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

async function changeNotes(container: HTMLElement, value: string) {
  const textarea = [...container.querySelectorAll('label')]
    .find((label) => label.textContent?.includes('Заметки'))?.querySelector('textarea');
  assert.ok(textarea, 'Draft notes textarea exists');
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(textarea), 'value')?.set;
    setter?.call(textarea, value);
    textarea.dispatchEvent(new window.Event('input', { bubbles: true }));
    textarea.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
}

function notesValue(container: HTMLElement): string {
  const textarea = [...container.querySelectorAll('label')]
    .find((label) => label.textContent?.includes('Заметки'))?.querySelector('textarea');
  assert.ok(textarea);
  return textarea.value;
}

test('renders shared Draft sections and a bounded alternatives metadata list in Russian', () => {
  const markup = renderStatic();
  assert.match(markup, /Общий рабочий черновик/);
  assert.match(markup, /Маршрут и даты/);
  assert.match(markup, /Проживание/);
  assert.match(markup, /Транспорт/);
  assert.match(markup, /Программа по дням/);
  assert.match(markup, /Сохранить черновик/);
  assert.match(markup, /Маршрут у моря/);
  assert.match(markup, /Открыть в редакторе/);
});

test('renders an explicit empty state when no alternatives have been saved', () => {
  assert.match(renderStatic([]), /Сохранённых вариантов пока нет/);
});

test('edits and saves only the working Draft, then shows success', async () => {
  let submitted: TripDraftSaveRequest | undefined;
  const api = createApi({
    saveTripDraft: async (_token, _tripId, request) => {
      submitted = request;
      return { ...draft, version: 2, content: request.content };
    }
  });
  const ui = await mountEditor(api);
  try {
    await changeNotes(ui.container, 'Ручная правка');
    await act(async () => button(ui.container, 'Сохранить черновик').click());
    assert.equal(submitted?.base_version, 1);
    assert.equal(submitted?.content.notes, 'Ручная правка');
    assert.equal('updateTrip' in api, false);
    assert.match(ui.container.textContent ?? '', /Черновик сохранён/);
  } finally {
    await ui.cleanup();
  }
});

test('server error preserves edited input and offers a retry', async () => {
  const api = createApi({ saveTripDraft: async () => { throw new ApiError(503, { detail: 'unavailable' }); } });
  const ui = await mountEditor(api);
  try {
    await changeNotes(ui.container, 'Оставить на экране');
    await act(async () => button(ui.container, 'Сохранить черновик').click());
    assert.match(ui.container.textContent ?? '', /попробуйте ещё раз/);
    assert.equal(notesValue(ui.container), 'Оставить на экране');
  } finally {
    await ui.cleanup();
  }
});

test('409 keeps local edits and reloads the current Draft on request', async () => {
  let current = true;
  const api = createApi({
    saveTripDraft: async () => { throw new ApiError(409, { detail: 'conflict' }); },
    getTripDraft: async () => ({
      draft: { ...draft, version: 2, content: { ...content, notes: 'Правка второго участника' } },
      alternatives: detail.alternatives
    })
  });
  const ui = await mountEditor(api);
  try {
    await changeNotes(ui.container, 'Моя несохранённая правка');
    await act(async () => button(ui.container, 'Сохранить черновик').click());
    assert.match(ui.container.textContent ?? '', /изменился у другого участника/);
    assert.equal(notesValue(ui.container), 'Моя несохранённая правка');
    await act(async () => button(ui.container, 'Загрузить актуальную версию').click());
    current = notesValue(ui.container) === 'Правка второго участника';
    assert.equal(current, true);
    assert.match(ui.container.textContent ?? '', /версия 2/);
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
    await changeNotes(ui.container, 'Несохранённые правки');
    window.confirm = () => false;
    await act(async () => button(ui.container, 'Открыть в редакторе').click());
    assert.equal(fetchCalls, 0);
    assert.equal(notesValue(ui.container), 'Несохранённые правки');

    window.confirm = () => true;
    await act(async () => button(ui.container, 'Открыть в редакторе').click());
    assert.equal(fetchCalls, 1);
    assert.equal(notesValue(ui.container), 'Море');
    assert.match(ui.container.textContent ?? '', /Сохраните черновик/);
  } finally {
    window.confirm = originalConfirm;
    await ui.cleanup();
  }
});

test('creates a Proposal only for explicitly selected saved Draft scope and does not change Confirmed Trip', async () => {
  let submittedScopes: readonly string[] = [];
  const api = createApi({
    createTripProposal: async (_token, _tripId, request) => {
      submittedScopes = request.scopes;
      return proposal;
    }
  });
  const ui = await mountEditor(api);
  try {
    const scopeLabel = [...ui.container.querySelectorAll('label.trip-draft-proposal-scope')]
      .find((item) => item.textContent?.includes('Бюджет'));
    assert.ok(scopeLabel);
    await act(async () => (scopeLabel.querySelector('input') as HTMLInputElement).click());
    const titleInput = [...ui.container.querySelectorAll('label')]
      .find((item) => item.textContent?.includes('Краткое название'))?.querySelector('input');
    assert.ok(titleInput);
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(titleInput), 'value')?.set;
      setter?.call(titleInput, 'Согласовать бюджет');
      titleInput.dispatchEvent(new window.Event('input', { bubbles: true }));
      titleInput.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    await act(async () => button(ui.container, 'Предложить участникам').click());
    assert.deepEqual(submittedScopes, ['budget']);
    assert.match(ui.container.textContent ?? '', /отдельный снимок/);
    assert.equal(notesValue(ui.container), '');
    assert.equal('updateTrip' in api, false);
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

test('loads immutable old-to-proposed values only when opening proposal details', async () => {
  let detailReads = 0;
  const api = createApi({
    getTripProposals: async () => [proposalSummary],
    getTripProposal: async () => { detailReads += 1; return proposal; }
  });
  const ui = await mountEditor(api);
  try {
    assert.equal(detailReads, 0);
    assert.equal(ui.container.querySelector('.trip-proposal-diff'), null);
    await act(async () => button(ui.container, 'Показать изменения').click());
    assert.equal(detailReads, 1);
    assert.ok(ui.container.querySelector('.trip-proposal-diff'));
    assert.match(ui.container.textContent ?? '', /было → предлагается/);
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

test('creates an event-level Proposal for only the selected event from the Draft', async () => {
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
    const eventLabel = [...ui.container.querySelectorAll('label.trip-draft-proposal-scope')]
      .find((item) => item.textContent?.includes('Музей'));
    assert.ok(eventLabel);
    await act(async () => (eventLabel.querySelector('input') as HTMLInputElement).click());
    await act(async () => {
      const titleInput = [...ui.container.querySelectorAll('label')]
        .find((item) => item.textContent?.includes('Краткое название'))?.querySelector('input');
      assert.ok(titleInput);
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(titleInput), 'value')?.set;
      setter?.call(titleInput, 'Изменить музей');
      titleInput.dispatchEvent(new window.Event('input', { bubbles: true }));
      titleInput.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    await act(async () => button(ui.container, 'Предложить участникам').click());
    assert.deepEqual(submittedScopes, [`itinerary:event:${dayId}:${eventId}`]);
    assert.match(ui.container.textContent ?? '', /Событие: Музей: было → предлагается/);
    assert.match(ui.container.textContent ?? '', /Музей/);
    assert.match(ui.container.textContent ?? '', /Обед/);
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
    const eventLabel = [...ui.container.querySelectorAll('label.trip-draft-proposal-scope')]
      .find((item) => item.textContent?.includes('Новое событие'));
    assert.ok(eventLabel);
    assert.equal((eventLabel.querySelector('input') as HTMLInputElement).disabled, true);
    assert.match(ui.container.textContent ?? '', /Сначала согласуйте день/);
  } finally {
    await ui.cleanup();
  }
});
