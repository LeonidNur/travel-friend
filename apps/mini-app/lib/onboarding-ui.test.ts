import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { act, createElement, useState, type ComponentType } from 'react';
import type { Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import test from 'node:test';

import type { OnboardingStatus, ProfileResponse, TravelIntentResponse } from './backend-api-client';

type FetchHandler = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type FetchCall = Readonly<{ input: RequestInfo | URL; init?: RequestInit }>;

const originalFetch = globalThis.fetch;
const fetchCalls: FetchCall[] = [];
let fetchHandler: FetchHandler = async () => new Response('{}');
const stableFetch: typeof fetch = async (input, init) => {
  fetchCalls.push({ input, init });
  return fetchHandler(input, init);
};
globalThis.fetch = stableFetch;

const require = createRequire(import.meta.url);
const nextImageCommonJs = require('next/image') as { default?: object } & Record<string, unknown>;
if (nextImageCommonJs.default) Object.assign(nextImageCommonJs, nextImageCommonJs.default);

type OnboardingProfileFormProps = Readonly<{
  profile: ProfileResponse | null;
  step: 'profile' | 'travel_style';
  onboardingStatus: Exclude<OnboardingStatus, 'completed'> | null;
  token: string | null;
  onProfileSaved: (profile: ProfileResponse) => void;
  onOnboardingStarted: () => void;
  onBack: () => void;
  onContinue: () => void;
}>;

type OnboardingTravelIntentFormProps = Readonly<{
  travelIntent: TravelIntentResponse | null;
  profile: ProfileResponse;
  onboardingStatus: OnboardingStatus | null;
  token: string | null;
  onProfileSaved: (profile: ProfileResponse) => void;
  onTravelIntentSaved: (travelIntent: TravelIntentResponse) => void;
  onOnboardingCompleted: () => void;
}>;

const profileModule = await import('../components/OnboardingProfileScreen');
const tripModule = await import('../components/OnboardingTravelIntentScreen');
const profileForm = Reflect.get(profileModule, 'OnboardingProfileForm') as
  ComponentType<OnboardingProfileFormProps> | undefined;
const tripForm = Reflect.get(tripModule, 'OnboardingTravelIntentForm') as
  ComponentType<OnboardingTravelIntentFormProps> | undefined;

const profile: ProfileResponse = {
  id: 'profile-1', user_id: 'user-1', display_name: 'Алексей', birth_date: '1998-01-02',
  gender: null, city: 'Москва', bio: 'Люблю путешествовать', travel_style: ['Городской'], interests: ['Музыка'],
  budget_level: '2', comfort_level: '3', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z'
};

const travelIntent: TravelIntentResponse = {
  id: 'intent-1', user_id: 'user-1', destination: 'Алтай', date_from: null, date_to: null,
  status: 'active', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', archived_at: null
};

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

function setFetchHandler(handler: FetchHandler) {
  fetchCalls.length = 0;
  fetchHandler = handler;
}

async function mount<TProps extends object>(
  component: ComponentType<TProps> | undefined,
  props: TProps
) {
  if (!component) throw new Error('onboarding form is exported for interaction tests');
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', {
    url: 'http://localhost'
  });
  const style = dom.window.document.createElement('style');
  style.textContent = await readFile(new URL('../app/globals.css', import.meta.url), 'utf8');
  dom.window.document.head.append(style);

  const globals = ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Event', 'MouseEvent'] as const;
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const key of globals) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value: (dom.window as unknown as Record<string, unknown>)[key]
    });
  }
  const previousActEnvironment = Reflect.get(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
  const { createRoot } = await import('react-dom/client');
  const container = dom.window.document.getElementById('root');
  assert.ok(container);
  const root: Root = createRoot(container);
  await act(async () => root.render(createElement(component, props)));

  return {
    container,
    dom,
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

function findButton(container: HTMLElement, text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll<HTMLButtonElement>('.profile-actions button, .onboarding-status button')]
    .find((button) => button.textContent?.trim() === text);
  assert.ok(found, `button "${text}" exists`);
  return found;
}

async function setField(container: HTMLElement, label: string, value: string) {
  const field = [...container.querySelectorAll('.profile-form__field')]
    .find((element) => element.querySelector('.profile-form__label')?.textContent?.trim() === label);
  assert.ok(field, `field "${label}" exists`);
  const control = field.querySelector('input, textarea');
  assert.ok(control, `control for "${label}" exists`);
  const prototype = Object.getPrototypeOf(control);
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  await act(async () => {
    setter?.call(control, value);
    control.dispatchEvent(new window.Event('input', { bubbles: true }));
    control.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
}

test('onboarding progresses through profile, travel style and first trip with retry', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let failProfile = true;
  let savedProfile = profile;
  setFetchHandler(async (input, init) => {
    if (String(input).endsWith('/me/profile')) {
      if (failProfile) throw new Error('Ошибка сохранения');
      savedProfile = { ...savedProfile, ...JSON.parse(String(init?.body)) };
      return jsonResponse(savedProfile);
    }
    throw new Error(`Unexpected request ${String(input)}`);
  });

  function Flow() {
    const [step, setStep] = useState<'profile' | 'travel_style' | 'first_trip'>('profile');
    const [currentProfile, setCurrentProfile] = useState(profile);
    if (step === 'first_trip') {
      assert.ok(tripForm);
      return createElement(tripForm, {
        travelIntent: null, profile: currentProfile, onboardingStatus: 'in_progress', token: 'session-token',
        onProfileSaved: setCurrentProfile, onTravelIntentSaved: () => undefined,
        onOnboardingCompleted: () => undefined
      });
    }
    assert.ok(profileForm);
    return createElement(profileForm, {
      profile: currentProfile, step, onboardingStatus: 'in_progress', token: 'session-token',
      onProfileSaved: setCurrentProfile, onOnboardingStarted: () => undefined,
      onBack: () => setStep('profile'),
      onContinue: () => setStep(step === 'profile' ? 'travel_style' : 'first_trip')
    });
  }

  const ui = await mount(Flow, {});
  try {
    await setField(ui.container, 'Имя *', 'Марина');
    await act(async () => findButton(ui.container, 'Сохранить').click());
    assert.match(ui.container.textContent ?? '', /Ошибка сохранения/);
    assert.equal(ui.container.querySelector<HTMLInputElement>('input')?.value, 'Марина');
    await act(async () => { context.mock.timers.tick(1000); });
    assert.match(ui.container.textContent ?? '', /Шаг 1 из 3/);

    failProfile = false;
    await act(async () => findButton(ui.container, 'Сохранить').click());
    assert.match(ui.container.textContent ?? '', /Профиль сохранён/);
    await act(async () => { context.mock.timers.tick(999); });
    assert.match(ui.container.textContent ?? '', /Шаг 1 из 3/);
    await act(async () => { context.mock.timers.tick(1); });
    assert.match(ui.container.textContent ?? '', /Шаг 2 из 3/);
    assert.equal(findButton(ui.container, 'Сохранить').disabled, false);
    const choice = ui.container.querySelector<HTMLButtonElement>('.selectable-chip');
    assert.ok(choice);
    assert.equal(choice.disabled, false);
    await act(async () => choice.click());
    const selectedStyle = choice.textContent?.trim();
    await act(async () => findButton(ui.container, 'Сохранить').click());
    assert.equal(savedProfile.display_name, 'Марина');
    assert.ok(selectedStyle && savedProfile.travel_style.includes(selectedStyle));
    assert.match(ui.container.textContent ?? '', /Стиль поездки сохранён/);
    await act(async () => { context.mock.timers.tick(999); });
    assert.match(ui.container.textContent ?? '', /Шаг 2 из 3/);
    await act(async () => { context.mock.timers.tick(1); });
    assert.match(ui.container.textContent ?? '', /Первая поездка/);
    assert.equal(findButton(ui.container, 'Завершить настройку').disabled, false);
  } finally {
    await ui.cleanup();
  }
});

test('Profile and Travel Style use Save, show backend success, and advance after one second', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  setFetchHandler(async () => jsonResponse(profile));

  for (const [step, successText, nextStep] of [
    ['profile', 'Профиль сохранён', 'выбор стиля поездки'],
    ['travel_style', 'Стиль поездки сохранён', 'план первой поездки']
  ] as const) {
    let advances = 0;
    const ui = await mount(profileForm, {
      profile,
      step,
      onboardingStatus: 'in_progress',
      token: 'session-token',
      onProfileSaved: () => undefined,
      onOnboardingStarted: () => undefined,
      onBack: () => undefined,
      onContinue: () => { advances += 1; }
    } satisfies OnboardingProfileFormProps);

    try {
      assert.equal(findButton(ui.container, 'Сохранить').textContent?.trim(), 'Сохранить');
      await act(async () => findButton(ui.container, 'Сохранить').click());

      assert.match(ui.container.textContent ?? '', new RegExp(successText));
      assert.match(ui.container.textContent ?? '', new RegExp(`Через секунду откроется ${nextStep}`));
      assert.equal(findButton(ui.container, 'Сохранено').textContent?.trim(), 'Сохранено');
      assert.equal(advances, 0);

      await act(async () => { context.mock.timers.tick(999); });
      assert.equal(advances, 0);
      await act(async () => { context.mock.timers.tick(1); });
      assert.equal(advances, 1);
    } finally {
      await ui.cleanup();
    }
  }
});

test('Profile validation colors the visible field and a save error keeps the draft without advancing', async () => {
  setFetchHandler(async () => { throw new Error('Сеть недоступна'); });
  let advances = 0;
  const ui = await mount(profileForm, {
    profile: null,
    step: 'profile',
    onboardingStatus: 'in_progress',
    token: 'session-token',
    onProfileSaved: () => undefined,
    onOnboardingStarted: () => undefined,
    onBack: () => undefined,
    onContinue: () => { advances += 1; }
  } satisfies OnboardingProfileFormProps);

  try {
    await act(async () => findButton(ui.container, 'Сохранить').click());
    const nameInput = ui.container.querySelector<HTMLInputElement>('input[aria-invalid="true"]');
    assert.ok(nameInput);
    const field = nameInput.closest('.profile-form__field');
    assert.ok(field);
    assert.equal(ui.dom.window.getComputedStyle(field).borderColor, 'rgb(199, 51, 51)');

    await setField(ui.container, 'Имя *', 'Марина');
    const bio = ui.container.querySelector<HTMLTextAreaElement>('textarea[aria-label="О себе"]');
    assert.ok(bio);
    const bioStyles = ui.dom.window.getComputedStyle(bio);
    const aboutCard = bio.closest('.onboarding-section');
    assert.ok(aboutCard);
    assert.equal(bioStyles.borderTopWidth, '0px');
    assert.equal(bioStyles.backgroundColor, 'rgba(0, 0, 0, 0)');
    assert.equal(bioStyles.textAlign, 'left');
    assert.equal(bioStyles.fontSize, '15px');
    assert.equal(ui.dom.window.getComputedStyle(aboutCard).backgroundColor, 'rgb(217, 217, 217)');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(bio), 'value')?.set;
      setter?.call(bio, 'Ищу компанию в поездку');
      bio.dispatchEvent(new window.Event('input', { bubbles: true }));
      bio.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    await act(async () => findButton(ui.container, 'Сохранить').click());

    assert.match(ui.container.textContent ?? '', /Сеть недоступна/);
    assert.equal(ui.container.querySelector<HTMLInputElement>('input')?.value, 'Марина');
    assert.equal(ui.container.querySelector<HTMLTextAreaElement>('textarea')?.value, 'Ищу компанию в поездку');
    assert.equal(advances, 0);
  } finally {
    await ui.cleanup();
  }
});

test('First Trip has one completion CTA and transitions only one second after all backend saves succeed', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  setFetchHandler(async (input, init) => {
    const path = String(input);
    if (path.endsWith('/me/profile')) return jsonResponse(profile);
    if (path.endsWith('/me/travel-intent')) return jsonResponse(travelIntent);
    if (path.endsWith('/me/onboarding') && init?.method === 'PATCH') return jsonResponse({ status: 'completed' });
    throw new Error(`Unexpected request ${init?.method ?? 'GET'} ${path}`);
  });
  let completed = 0;
  const ui = await mount(tripForm, {
    travelIntent: null,
    profile,
    onboardingStatus: 'in_progress',
    token: 'session-token',
    onProfileSaved: () => undefined,
    onTravelIntentSaved: () => undefined,
    onOnboardingCompleted: () => { completed += 1; }
  } satisfies OnboardingTravelIntentFormProps);

  try {
    assert.equal(ui.container.querySelectorAll('.profile-actions button, .onboarding-status button').length, 1);
    assert.equal(findButton(ui.container, 'Завершить настройку').textContent?.trim(), 'Завершить настройку');
    await setField(ui.container, 'Направление *', 'Алтай');
    await act(async () => findButton(ui.container, 'Завершить настройку').click());

    assert.deepEqual(fetchCalls.map(({ input, init }) => [String(input), init?.method]), [
      ['/api/backend/me/profile', 'PATCH'],
      ['/api/backend/me/travel-intent', 'PUT'],
      ['/api/backend/me/onboarding', 'PATCH']
    ]);
    assert.match(ui.container.textContent ?? '', /Настройка завершена/);
    assert.match(ui.container.textContent ?? '', /Через секунду откроется Discover \/ Matching/);
    assert.equal(findButton(ui.container, 'Завершено').textContent?.trim(), 'Завершено');
    assert.equal(completed, 0);

    await act(async () => { context.mock.timers.tick(999); });
    assert.equal(completed, 0);
    await act(async () => { context.mock.timers.tick(1); });
    assert.equal(completed, 1);
  } finally {
    await ui.cleanup();
  }
});

test('First Trip save and completion errors preserve draft and retry completion only', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let failAt: 'travel-intent' | 'completion' | 'none' = 'travel-intent';
  setFetchHandler(async (input, init) => {
    const path = String(input);
    if (path.endsWith('/me/profile')) return jsonResponse(profile);
    if (path.endsWith('/me/travel-intent')) {
      if (failAt === 'travel-intent') throw new Error('Не удалось сохранить поездку');
      return jsonResponse(travelIntent);
    }
    if (path.endsWith('/me/onboarding') && init?.method === 'PATCH') {
      if (failAt === 'completion') throw new Error('Не удалось завершить onboarding');
      return jsonResponse({ status: 'completed' });
    }
    throw new Error(`Unexpected request ${init?.method ?? 'GET'} ${path}`);
  });
  let completed = 0;
  const ui = await mount(tripForm, {
    travelIntent: null,
    profile,
    onboardingStatus: 'in_progress',
    token: 'session-token',
    onProfileSaved: () => undefined,
    onTravelIntentSaved: () => undefined,
    onOnboardingCompleted: () => { completed += 1; }
  } satisfies OnboardingTravelIntentFormProps);

  try {
    await act(async () => findButton(ui.container, 'Завершить настройку').click());
    const destinationInput = ui.container.querySelector<HTMLInputElement>('input[aria-invalid="true"]');
    assert.ok(destinationInput);
    const destinationField = destinationInput.closest('.profile-form__field');
    assert.ok(destinationField);
    assert.equal(ui.dom.window.getComputedStyle(destinationField).borderColor, 'rgb(199, 51, 51)');
    assert.equal(completed, 0);

    await setField(ui.container, 'Направление *', 'Байкал');
    await act(async () => findButton(ui.container, 'Завершить настройку').click());
    assert.match(ui.container.textContent ?? '', /Не удалось сохранить поездку/);
    assert.equal(ui.container.querySelector<HTMLInputElement>('input')?.value, 'Байкал');
    assert.equal(completed, 0);

    failAt = 'completion';
    await act(async () => findButton(ui.container, 'Завершить настройку').click());
    assert.match(ui.container.textContent ?? '', /Не удалось завершить настройку/);
    assert.match(ui.container.textContent ?? '', /Данные сохранены/);
    assert.equal(ui.container.querySelector<HTMLInputElement>('input')?.value, 'Байкал');
    assert.equal(completed, 0);

    const requestCount = fetchCalls.length;
    failAt = 'none';
    await act(async () => findButton(ui.container, 'Повторить завершение').click());
    assert.deepEqual(fetchCalls.slice(requestCount).map(({ input, init }) => [String(input), init?.method]), [
      ['/api/backend/me/onboarding', 'PATCH']
    ]);
    assert.match(ui.container.textContent ?? '', /Настройка завершена/);
    assert.equal(ui.container.querySelector<HTMLInputElement>('input')?.value, 'Алтай');
    await act(async () => { context.mock.timers.tick(999); });
    assert.equal(completed, 0);
    await act(async () => { context.mock.timers.tick(1); });
    assert.equal(completed, 1);
  } finally {
    await ui.cleanup();
  }
});

test.after(() => {
  globalThis.fetch = originalFetch;
});


test('travel style shows its validation card and does not save an empty selection', async () => {
  setFetchHandler(async () => { throw new Error('Unexpected request'); });
  const ui = await mount(profileForm, {
    profile: { ...profile, travel_style: [] }, step: 'travel_style', onboardingStatus: 'in_progress', token: 'session',
    onProfileSaved: () => undefined, onOnboardingStarted: () => undefined, onBack: () => undefined,
    onContinue: () => assert.fail('Must stay on travel style')
  });
  try {
    await act(async () => findButton(ui.container, 'Сохранить').click());
    assert.match(ui.container.querySelector('[role="alert"]')?.textContent ?? '', /Нужен хотя бы один вариант/);
    assert.equal(fetchCalls.length, 0);
    const choice = ui.container.querySelector<HTMLButtonElement>('button[aria-pressed="false"]');
    assert.ok(choice);
    await act(async () => choice.click());
    assert.equal(choice.getAttribute('aria-pressed'), 'true');
    assert.equal(ui.container.querySelector('[role="alert"]'), null);
  } finally {
    await ui.cleanup();
  }
});
