import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

import type * as ChatLifecycleModule from './chat-lifecycle';
import type * as MockBuddiesModule from './mock-buddies';
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
const { getBuddyById }: typeof MockBuddiesModule = await import(
  new URL('./mock-buddies.ts', import.meta.url).href
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

test('keeps Maria profile, chat, and trip on the same canonical date window', () => {
  const canonicalDateWindow = 'Конец августа, 7–8 дней';
  const mariaProfile = getBuddyById('maria-ivanova');
  const mariaChat = getChatById('chat-amina-tbilisi');
  const mariaTrip = getActiveTripByChatId('chat-amina-tbilisi');

  assert.ok(mariaProfile);
  assert.ok(mariaChat);
  assert.ok(mariaTrip);
  assert.equal(mariaProfile.dates, canonicalDateWindow);
  assert.equal(
    mariaChat.messages.find((message) => message.id === 'message-amina-1')?.text,
    'Привет. Я как раз смотрю даты на конец августа, 7–8 дней и район ближе к старому городу.'
  );
  assert.equal(mariaTrip.categories.dates.summary, `${canonicalDateWindow}; даты ещё уточняем.`);
});

test('keeps Timur matched chat linked to its historical ready trip', () => {
  const timurChat = getChatById('chat-sonya-yerevan');
  const timurTrips = getTripsByChatId('chat-sonya-yerevan');

  assert.ok(timurChat);
  assert.equal(timurChat.status, 'match');
  assert.equal(timurChat.previewText, 'План готов: даты, жильё и спокойный маршрут по Еревану согласованы.');
  assert.deepEqual(
    timurTrips.map(({ id, status }) => ({ id, status })),
    [{ id: 'trip-timur-yerevan', status: 'ready' }]
  );
  assert.equal(getActiveTripByChatId(timurChat.id), undefined);
  const timurFirstMessage = timurChat.messages.find((message) => message.id === 'message-sonya-1');

  assert.ok(timurFirstMessage);
  assert.equal(timurFirstMessage.kind, 'participant');
  assert.equal(timurFirstMessage.authorId, 'timur-safonov');
  assert.equal(
    timurFirstMessage.text,
    'Я бы начал с темпа поездки: хочется больше прогулок по городу или насыщенную программу?'
  );
});

test('keeps Egor chat pending until a mutual interest', () => {
  const chat = getChatById('chat-ilya-istanbul');

  assert.ok(chat);
  assert.equal(chat.status, 'interest_sent');
  assert.equal(canSendMessagesForChatStatus(chat.status), false);
  assert.equal(getTripsByChatId(chat.id).length, 0);
  assert.deepEqual(chat.messages, [
    {
      id: 'message-system-interest-sent',
      kind: 'system',
      text: 'Интерес отправлен. Переписка станет доступна после взаимного интереса.',
      sentAtLabel: 'сегодня'
    }
  ]);
});

test('does not expose the removed group mock chat', () => {
  assert.equal(getChatById('chat-timur-baku'), undefined);
});

test('keeps all current mock chats direct', () => {
  assert.equal(mockChats.every(isDirectChat), true);
});
