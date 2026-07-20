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
const { getChatById, isDirectChat, mockChats }: typeof MockChatsModule = await import(
  new URL('./mock-chats.ts', import.meta.url).href
);
const { getActiveTripByChatId, getTripsByChatId }: typeof MockTripsModule = await import(
  new URL('./mock-trips.ts', import.meta.url).href
);

test('keeps Maria chat linked to its active trip and both matched chats send-enabled', () => {
  const mariaTrip = getActiveTripByChatId('chat-amina-tbilisi');
  const timurTrip = getActiveTripByChatId('chat-sonya-yerevan');

  assert.ok(mariaTrip);
  assert.equal(timurTrip, undefined);

  const mariaChat = getChatById(mariaTrip.chatId);
  const timurChat = getChatById('chat-sonya-yerevan');

  assert.ok(mariaChat);
  assert.ok(timurChat);
  assert.equal(canSendMessagesForChatStatus(mariaChat.status), true);
  assert.equal(timurChat.status, 'match');
  assert.equal(canSendMessagesForChatStatus(timurChat.status), true);
});

test('keeps Timur matched chat linked to its historical ready trip', () => {
  const timurChat = getChatById('chat-sonya-yerevan');
  const timurTrips = getTripsByChatId('chat-sonya-yerevan');

  assert.ok(timurChat);
  assert.equal(timurChat.status, 'match');
  assert.deepEqual(
    timurTrips.map(({ id, status }) => ({ id, status })),
    [{ id: 'trip-timur-yerevan', status: 'ready' }]
  );
  assert.equal(getActiveTripByChatId(timurChat.id), undefined);
});

test('keeps the interest-sent chat without a trip', () => {
  const chat = getChatById('chat-ilya-istanbul');

  assert.ok(chat);
  assert.equal(chat.status, 'interest_sent');
  assert.equal(getTripsByChatId(chat.id).length, 0);
});

test('does not expose the removed group mock chat', () => {
  assert.equal(getChatById('chat-timur-baku'), undefined);
});

test('keeps all current mock chats direct', () => {
  assert.equal(mockChats.every(isDirectChat), true);
});
