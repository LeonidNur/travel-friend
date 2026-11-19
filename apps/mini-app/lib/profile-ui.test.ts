import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { act, createElement } from 'react';
import { JSDOM } from 'jsdom';
import type { ProfileResponse } from './backend-api-client';

const require = createRequire(import.meta.url);
const imageModule = require('next/image') as { default?: object } & Record<string, unknown>;
if (imageModule.default) Object.assign(imageModule, imageModule.default);
const { ProfileContent } = await import('../components/ProfileScreen');

test('profile edit validates, preserves draft on failure, and returns to saved view after retry', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  const keys = ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Event', 'MouseEvent'] as const;
  const previous = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const key of keys) Object.defineProperty(globalThis, key, { configurable: true, value: (dom.window as unknown as Record<string, unknown>)[key] });
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
  const { createRoot } = await import('react-dom/client');
  const container = dom.window.document.getElementById('root'); assert.ok(container);
  const root = createRoot(container);
  const profile: ProfileResponse = { id: 'p', user_id: 'u', display_name: 'Алексей', birth_date: null, gender: null, city: 'Москва', bio: 'Текст', interests: [], travel_style: [], budget_level: '2', comfort_level: '3', created_at: '', updated_at: '' };
  let fail = true; let calls = 0; let saved: ProfileResponse | null = null; let rejectSave: ((error: Error) => void) | undefined;
  const props = { serverProfile: { status: 'loaded' as const, profile }, serverTravelIntent: { status: 'loaded' as const, travelIntent: { id: 'i', user_id: 'u', destination: 'Алтай', date_from: null, date_to: null, status: 'active' as const, created_at: '', updated_at: '', archived_at: null } }, token: 'test', setServerProfile: (value: ProfileResponse) => { saved = value; }, reloadServerProfile: () => undefined, setServerTravelIntent: () => undefined, reloadServerTravelIntent: () => undefined, patchProfile: async (_token: string, payload: Parameters<NonNullable<Parameters<typeof ProfileContent>[0]['patchProfile']>>[1]) => { calls += 1; if (fail) return await new Promise<ProfileResponse>((_resolve, reject) => { rejectSave = reject; }); return { ...profile, ...payload, display_name: payload.display_name ?? profile.display_name }; } };
  const button = (label: string) => { const found = [...container.querySelectorAll('button')].find((el) => el.textContent?.trim() === label); assert.ok(found); return found; };
  const setName = async (value: string) => { const input = container.querySelector<HTMLInputElement>('input[placeholder="Как вас зовут"]'); assert.ok(input); await act(async () => { Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set?.call(input, value); input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); input.dispatchEvent(new dom.window.Event('change', { bubbles: true })); }); };
  try {
    await act(async () => root.render(createElement(ProfileContent, props)));
    assert.equal(button('Изменить').getAttribute('aria-label'), 'Изменить планы поездок');
    await act(async () => button('Изменить').click());
    const plan = container.querySelector('form');
    assert.ok(plan);
    const destination = plan.querySelector<HTMLInputElement>('input[type="text"]');
    assert.ok(destination);
    const setDestination = async (value: string) => {
      await act(async () => {
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(destination), 'value')?.set?.call(destination, value);
        destination.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      });
    };
    await setDestination('');
    await act(async () => plan.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));
    assert.equal(destination.getAttribute('aria-invalid'), 'true');
    const destinationErrorId = destination.getAttribute('aria-describedby');
    assert.ok(destinationErrorId);
    const destinationError = dom.window.document.getElementById(destinationErrorId);
    assert.equal(destinationError?.textContent, 'Укажите направление');
    assert.equal(destinationError?.previousElementSibling, destination.closest('label'));
    await setDestination('Байкал');
    assert.equal(destination.hasAttribute('aria-invalid'), false);
    await act(async () => button('Редактировать').click());
    assert.ok(container.querySelector('.profile-design__view[hidden]'));
    await setName(''); await act(async () => button('Сохранить').click());
    assert.equal(calls, 0); assert.ok(container.querySelector('input[aria-invalid="true"]'));
    await setName('Марина'); await act(async () => button('Сохранить').click());
    assert.equal(button('Сохраняем…').disabled, true);
    await act(async () => { assert.ok(rejectSave); rejectSave(new Error('Нет сети')); });
    assert.match(container.textContent ?? '', /Не удалось сохранить/);
    assert.equal(container.querySelector<HTMLInputElement>('input[placeholder="Как вас зовут"]')?.value, 'Марина');
    fail = false; await act(async () => button('Сохранить').click());
    assert.equal(calls, 2); assert.equal((saved as ProfileResponse | null)?.display_name, 'Марина');
    assert.equal(container.querySelector('.profile-page__identity .profile-header [role="status"]')?.textContent, 'Профиль сохранён');
    assert.ok(button('Редактировать'));
    assert.equal(destination.value, 'Байкал');
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const key of keys) { const descriptor = previous.get(key); if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
    Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  }
});
