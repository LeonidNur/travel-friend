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
  TripDraftSaveRequest
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

function renderStatic(alternatives = detail.alternatives): string {
  const api = createApi();
  return renderToStaticMarkup(createElement(TripDraftEditor, {
    token: 'session-token', draft, alternatives, api, authorLabel: () => 'Участник'
  }));
}

function createApi(overrides: Partial<Pick<BackendApiClient, 'getTripDraft' | 'getTripDraftAlternative' | 'saveTripDraft' | 'saveTripDraftAlternative'>> = {}) {
  return {
    getTripDraft: async (): Promise<TripDraftDetailResponse> => detail,
    getTripDraftAlternative: async (): Promise<TripDraftAlternativeResponse> => alternative,
    saveTripDraft: async (_token: string, _tripId: string, request: TripDraftSaveRequest): Promise<TripDraftResponse> => ({
      ...draft, version: 2, content: request.content
    }),
    saveTripDraftAlternative: async (): Promise<TripDraftAlternativeMetadataResponse> => alternativeMetadata,
    ...overrides
  };
}

async function mountEditor(api = createApi()) {
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
    token: 'session-token', draft, alternatives: detail.alternatives, api, authorLabel: () => 'Участник'
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
