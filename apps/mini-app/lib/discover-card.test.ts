import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { act, createElement } from 'react';
import { JSDOM } from 'jsdom';

const require = createRequire(import.meta.url);
const imageModule = require('next/image') as { default?: object } & Record<string, unknown>;
if (imageModule.default) Object.assign(imageModule, imageModule.default);
const { BuddyCard } = await import('../components/BuddyCard');

test('card expands and collapses in place, preserves candidate and calls decisions', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  const keys = ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Event', 'MouseEvent'] as const;
  const previous = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const key of keys) Object.defineProperty(globalThis, key, { configurable: true, value: (dom.window as unknown as Record<string, unknown>)[key] });
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
  const { createRoot } = await import('react-dom/client');
  const container = dom.window.document.getElementById('root');
  assert.ok(container);
  const root = createRoot(container);
  const buddy = { userId: '1', displayName: 'Марина', age: 25, city: 'Москва', bio: 'Полный текст', interests: ['1', '2', '3', '4', '5'], travelStyle: ['Городской'], budgetLevel: '2', comfortLevel: '3', travelIntent: { destination: 'Алтай', dateFrom: null, dateTo: null } };
  let interested = 0; let dismissed = 0;
  const render = (disabled = false, id = buddy.userId) => root.render(createElement(BuddyCard, { key: id, buddy: { ...buddy, userId: id }, disabled, onInterested: () => { interested += 1; }, onDismiss: () => { dismissed += 1; } }));
  const button = (label: string) => { const found = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`); assert.ok(found); return found; };
  try {
    await act(async () => render());
    assert.equal(container.textContent?.includes('Полный текст'), false);
    await act(async () => button('Раскрыть анкету').click());
    assert.equal(button('Свернуть анкету').getAttribute('aria-expanded'), 'true');
    assert.match(container.textContent ?? '', /Марина/);
    assert.match(container.textContent ?? '', /Полный текст/);
    assert.ok([...container.querySelectorAll('.chip')].some((chip) => chip.textContent === '5'));
    await act(async () => button('Подходит').click());
    await act(async () => button('Не подходит').click());
    assert.equal(interested, 1); assert.equal(dismissed, 1);
    await act(async () => render(true));
    await act(async () => button('Подходит').click());
    assert.equal(interested, 1);
    await act(async () => render(false));
    await act(async () => button('Свернуть анкету').click());
    assert.ok(button('Раскрыть анкету'));
    await act(async () => button('Раскрыть анкету').click());
    await act(async () => render(false, '2'));
    assert.ok(button('Раскрыть анкету'));
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const key of keys) { const descriptor = previous.get(key); if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
    Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  }
});
