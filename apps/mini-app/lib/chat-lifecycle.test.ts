import assert from 'node:assert/strict';
import { test } from 'node:test';

import type * as ChatLifecycleModule from './chat-lifecycle';

const { canSendMessagesForChatStatus, getChatMessageAccessNotice }: typeof ChatLifecycleModule = await import(
  new URL('./chat-lifecycle.ts', import.meta.url).href
);

test('allows messages only for matched chats', () => {
  assert.equal(canSendMessagesForChatStatus('match'), true);
  assert.equal(canSendMessagesForChatStatus('interest_sent'), false);
  assert.equal(canSendMessagesForChatStatus('draft'), false);
});

test('returns notices only for chats without message access', () => {
  assert.equal(getChatMessageAccessNotice('match'), null);
  assert.ok(getChatMessageAccessNotice('interest_sent'));
  assert.ok(getChatMessageAccessNotice('draft'));
});
