import assert from 'node:assert/strict';
import { test } from 'node:test';

import type * as TelegramModule from './telegram-viewport';

const { getTelegramViewport, subscribeTelegramViewport }: typeof TelegramModule = await import(
  new URL('./telegram-viewport.ts', import.meta.url).href
);

type EventName = 'viewportChanged' | 'safeAreaChanged' | 'contentSafeAreaChanged' | 'activated';

function createWebApp(overrides: Record<string, unknown> = {}) {
  const handlers = new Map<EventName, Set<() => void>>();
  const webApp = {
    viewportHeight: 360,
    viewportStableHeight: 360,
    safeAreaInset: { top: 0, right: 0, bottom: 0, left: 0 },
    contentSafeAreaInset: { top: 0, right: 0, bottom: 0, left: 0 },
    onEvent(event: EventName, handler: () => void) {
      const eventHandlers = handlers.get(event) ?? new Set();
      eventHandlers.add(handler);
      handlers.set(event, eventHandlers);
    },
    offEvent(event: EventName, handler: () => void) {
      handlers.get(event)?.delete(handler);
    },
    emit(event: EventName) {
      handlers.get(event)?.forEach((handler) => handler());
    },
    ...overrides
  };

  return webApp;
}

test('uses stable viewport height while the Mini App is resizing', () => {
  const webApp = createWebApp({ viewportHeight: 260, viewportStableHeight: 360 });

  assert.deepEqual(getTelegramViewport(webApp, 800), {
    viewportHeight: 260,
    viewportStableHeight: 360,
    safeAreaInset: { top: 0, right: 0, bottom: 0, left: 0 },
    contentSafeAreaInset: { top: 0, right: 0, bottom: 0, left: 0 }
  });
});

test('refreshes viewport and both inset sets after Telegram events, including reactivation', () => {
  const webApp = createWebApp();
  const states: ReturnType<typeof getTelegramViewport>[] = [];
  const unsubscribe = subscribeTelegramViewport(webApp, 800, (state) => states.push(state));

  Object.assign(webApp, { viewportHeight: 260 });
  webApp.emit('viewportChanged');
  Object.assign(webApp, { viewportHeight: 500, viewportStableHeight: 500 });
  webApp.emit('viewportChanged');
  Object.assign(webApp, { viewportHeight: 260, viewportStableHeight: 260 });
  webApp.emit('viewportChanged');
  Object.assign(webApp, { safeAreaInset: { top: 44, right: 0, bottom: 34, left: 0 } });
  webApp.emit('safeAreaChanged');
  Object.assign(webApp, { contentSafeAreaInset: { top: 52, right: 0, bottom: 40, left: 0 } });
  webApp.emit('contentSafeAreaChanged');
  Object.assign(webApp, { viewportHeight: 480 });
  webApp.emit('activated');

  assert.equal(states.length, 7);
  assert.equal(states[1]?.viewportHeight, 260);
  assert.equal(states[1]?.viewportStableHeight, 360);
  assert.equal(states[2]?.viewportStableHeight, 500);
  assert.equal(states[3]?.viewportStableHeight, 260);
  assert.deepEqual(states[4]?.safeAreaInset, { top: 44, right: 0, bottom: 34, left: 0 });
  assert.deepEqual(states[5]?.contentSafeAreaInset, { top: 52, right: 0, bottom: 40, left: 0 });
  assert.equal(states[6]?.viewportHeight, 480);

  unsubscribe();
  webApp.emit('viewportChanged');
  assert.equal(states.length, 7);
});

test('falls back to browser height and zero insets for old Telegram clients', () => {
  const oldWebApp = {
    viewportHeight: undefined,
    viewportStableHeight: undefined,
    safeAreaInset: undefined,
    contentSafeAreaInset: undefined
  };

  assert.deepEqual(getTelegramViewport(oldWebApp, 740), {
    viewportHeight: 740,
    viewportStableHeight: 740,
    safeAreaInset: { top: 0, right: 0, bottom: 0, left: 0 },
    contentSafeAreaInset: { top: 0, right: 0, bottom: 0, left: 0 }
  });

  const states: ReturnType<typeof getTelegramViewport>[] = [];
  assert.doesNotThrow(() => subscribeTelegramViewport(oldWebApp, 740, (state) => states.push(state)));
  assert.equal(states.length, 1);
});

test('uses browser viewport and zero insets when no Telegram SDK exists', () => {
  assert.deepEqual(getTelegramViewport(undefined, 820), {
    viewportHeight: 820,
    viewportStableHeight: 820,
    safeAreaInset: { top: 0, right: 0, bottom: 0, left: 0 },
    contentSafeAreaInset: { top: 0, right: 0, bottom: 0, left: 0 }
  });
});

test('ignores invalid and negative inset values', () => {
  const webApp = createWebApp({
    safeAreaInset: { top: -10, right: Number.NaN, bottom: '20', left: 12 },
    contentSafeAreaInset: { top: 4, right: 5, bottom: -1, left: undefined }
  });

  assert.deepEqual(getTelegramViewport(webApp, 740).safeAreaInset, {
    top: 0,
    right: 0,
    bottom: 0,
    left: 12
  });
  assert.deepEqual(getTelegramViewport(webApp, 740).contentSafeAreaInset, {
    top: 4,
    right: 5,
    bottom: 0,
    left: 0
  });
});
