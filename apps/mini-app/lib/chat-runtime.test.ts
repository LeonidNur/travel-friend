import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ChatMessageResponse } from './backend-api-client';
import {
  appendServerMessage,
  findChatById,
  getChatsScreenState,
  mapChatMessages,
  submitChatMessage
} from './chat-runtime';

const ownUserId = 'own-user-uuid';

const messages: ChatMessageResponse[] = [
  {
    message_id: 'third',
    chat_id: 'chat-uuid',
    sequence_number: 3,
    type: 'user',
    sender_user_id: ownUserId,
    content_text: 'Моё сообщение',
    created_at: '2026-09-01T10:03:00Z'
  },
  {
    message_id: 'first',
    chat_id: 'chat-uuid',
    sequence_number: 1,
    type: 'system',
    sender_user_id: null,
    content_text: 'Чат создан',
    created_at: '2026-09-01T10:01:00Z'
  },
  {
    message_id: 'second',
    chat_id: 'chat-uuid',
    sequence_number: 2,
    type: 'user',
    sender_user_id: 'companion-uuid',
    content_text: 'Привет',
    created_at: '2026-09-01T10:02:00Z'
  }
];

test('returns loading, error, empty, and success Chats screen states', () => {
  assert.equal(getChatsScreenState({ isLoading: true, error: null, chats: [] }), 'loading');
  assert.equal(getChatsScreenState({ isLoading: false, error: 'Ошибка', chats: [] }), 'error');
  assert.equal(getChatsScreenState({ isLoading: false, error: null, chats: [] }), 'empty');
  assert.equal(
    getChatsScreenState({
      isLoading: false,
      error: null,
      chats: [
        {
          chat_id: 'chat-uuid',
          type: 'direct',
          companion: { user_id: 'companion-uuid', display_name: 'Мария', age: 31, city: 'Тбилиси' },
          created_at: '2026-09-01T10:00:00Z'
        }
      ]
    }),
    'success'
  );
});

test('maps ordered message history as own, companion, and system messages', () => {
  assert.deepEqual(
    mapChatMessages(messages, ownUserId).map((message) => [message.messageId, message.kind, message.isOwn]),
    [
      ['first', 'system', false],
      ['second', 'participant', false],
      ['third', 'participant', true]
    ]
  );
});

test('appends the server-returned message in sequence order only after a successful send', async () => {
  const sentMessage = { ...messages[2], message_id: 'fourth', sequence_number: 4, content_text: 'Отправлено' };
  const result = await submitChatMessage({
    draft: '  Отправлено  ',
    isSending: false,
    messages: messages.slice(0, 2),
    sendMessage: async (contentText) => {
      assert.equal(contentText, 'Отправлено');
      return sentMessage;
    }
  });

  assert.equal(result.draft, '');
  assert.equal(result.error, null);
  assert.deepEqual(result.messages.map((message) => message.message_id), ['first', 'third', 'fourth']);
});

test('preserves the draft when sending fails', async () => {
  const result = await submitChatMessage({
    draft: 'Не потерять текст',
    isSending: false,
    messages: [],
    sendMessage: async () => {
      throw new Error('network failed');
    }
  });

  assert.equal(result.draft, 'Не потерять текст');
  assert.equal(result.error, 'Не удалось отправить сообщение. Попробуйте ещё раз.');
  assert.deepEqual(result.messages, []);
});

test('prevents duplicate and whitespace-only submissions', async () => {
  let calls = 0;
  const sendMessage = async () => {
    calls += 1;
    return messages[0];
  };

  const duplicateResult = await submitChatMessage({ draft: 'Привет', isSending: true, messages: [], sendMessage });
  const whitespaceResult = await submitChatMessage({ draft: ' \n\t ', isSending: false, messages: [], sendMessage });

  assert.equal(calls, 0);
  assert.equal(duplicateResult.draft, 'Привет');
  assert.equal(whitespaceResult.draft, ' \n\t ');
});

test('does not duplicate a server message that is already present in runtime history', () => {
  assert.deepEqual(appendServerMessage([messages[0]], messages[0]), [messages[0]]);
});

test('treats an unavailable chat id as absent without accessing mock data', () => {
  assert.equal(findChatById([], 'unknown-chat-uuid'), undefined);
});
