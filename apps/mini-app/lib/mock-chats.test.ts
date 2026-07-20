import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

import type * as ChatLifecycleModule from './chat-lifecycle';
import type * as MockChatsModule from './mock-chats';
import type * as MockTripsModule from './mock-trips';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) {
      return nextResolve(new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, context);
    }

    if (specifier.startsWith('./') && !specifier.endsWith('.ts')) {
      return nextResolve(new URL(`${specifier}.ts`, context.parentURL).href, context);
    }

    return nextResolve(specifier, context);
  }
});

const { canSendMessagesForChatStatus }: typeof ChatLifecycleModule = await import(
  new URL('./chat-lifecycle.ts', import.meta.url).href
);
const { getChatById }: typeof MockChatsModule = await import(new URL('./mock-chats.ts', import.meta.url).href);
const { getActiveTripByChatId, getTripsByChatId }: typeof MockTripsModule = await import(
  new URL('./mock-trips.ts', import.meta.url).href
);

test('keeps the chat linked to Timur trip send-enabled', () => {
  const trip = getActiveTripByChatId('chat-sonya-yerevan');

  assert.ok(trip);

  const chat = getChatById(trip.chatId);

  assert.ok(chat);
  assert.equal(canSendMessagesForChatStatus(chat.status), true);
});

test('keeps the interest-sent chat without a trip', () => {
  const chat = getChatById('chat-ilya-istanbul');

  assert.ok(chat);
  assert.equal(chat.status, 'interest_sent');
  assert.equal(getTripsByChatId(chat.id).length, 0);
});

test('keeps the group mock chat in a non-sendable draft state', () => {
  const chat = getChatById('chat-timur-baku');

  assert.ok(chat);
  assert.equal(chat.status, 'draft');
  assert.equal(canSendMessagesForChatStatus(chat.status), false);
  assert.equal(getTripsByChatId(chat.id).length, 0);
});
