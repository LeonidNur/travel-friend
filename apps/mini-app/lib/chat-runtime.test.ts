import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ChatMessageResponse, ChatResponse } from './backend-api-client';
import {
  appendServerMessage,
  findChatById,
  getChatMessageHistoryState,
  getMessageAuthorLabel,
  getChatsScreenState,
  formatChatListTimestamp,
  mapChatMessages,
  submitChatMessage
} from './chat-runtime';
import { getProposalEventLabel, getProposalStatusLabel } from './trip-proposal-runtime';

const ownUserId = 'own-user-uuid';

const groupChat: ChatResponse = {
  chat_id: 'group-chat-uuid',
  type: 'group',
  title: null,
  participants: [
    { user_id: ownUserId, display_name: 'Анна' },
    { user_id: 'companion-uuid', display_name: 'Мария' },
    { user_id: 'third-user-uuid', display_name: 'Илья' }
  ],
  participant_count: 3,
  created_at: '2026-09-01T10:00:00Z',
  last_message: null,
  unread_count: 0
};

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
          created_at: '2026-09-01T10:00:00Z',
          last_message: null,
          unread_count: 0
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

test('maps current Proposal status from the server without inferring it from proposal_created', () => {
  const proposalMessage: ChatMessageResponse = {
    message_id: 'proposal-message', chat_id: 'chat-uuid', sequence_number: 4, type: 'system',
    sender_user_id: null, content_text: null, created_at: '2026-11-10T10:00:00Z',
    system_event: 'proposal_created', proposal_id: 'proposal-1', proposal_trip_id: 'trip-1',
    proposal_status: 'blocked', proposal_blocked_reason: 'prerequisite_pending'
  };
  const [mapped] = mapChatMessages([proposalMessage], ownUserId);
  assert.equal(mapped.text, 'Создано предложение по поездке.');
  assert.equal(mapped.proposalId, 'proposal-1');
  assert.equal(mapped.proposalStatus, 'blocked');
  assert.equal(mapped.proposalBlockedReason, 'prerequisite_pending');
  assert.equal(getProposalStatusLabel(mapped.proposalStatus!), 'Ожидает условия');
  assert.equal(getProposalEventLabel('proposal_needs_revision'), 'Предложение требует пересмотра.');
});

test('distinguishes a successfully loaded empty message history', () => {
  assert.equal(getChatMessageHistoryState([]), 'empty');
  assert.equal(getChatMessageHistoryState(messages), 'success');
});

test('finds a group Chat and resolves message authors from persisted participant data', () => {
  assert.equal(findChatById([groupChat], groupChat.chat_id), groupChat);
  assert.equal(getMessageAuthorLabel(groupChat, messages[2], ownUserId), 'Мария');
  assert.equal(getMessageAuthorLabel(groupChat, messages[1], ownUserId), null);
  assert.equal(
    getMessageAuthorLabel(groupChat, { ...messages[2], sender_user_id: 'unknown-user-uuid' }, ownUserId),
    'Участник'
  );
});

test('appends the server-returned message in sequence order only after a successful send', async () => {
  const sentMessage = { ...messages[2], message_id: 'fourth', sequence_number: 4, content_text: 'Отправлено' };
  const result = await submitChatMessage({
    draft: '  Отправлено  ',
    isSending: false,
    messages: messages.slice(0, 2),
    requestId: 'stable-request-id',
    sendMessage: async (contentText, requestId) => {
      assert.equal(contentText, 'Отправлено');
      assert.equal(requestId, 'stable-request-id');
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
    requestId: 'stable-request-id',
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

  const duplicateResult = await submitChatMessage({ draft: 'Привет', isSending: true, messages: [], requestId: 'stable-request-id', sendMessage });
  const whitespaceResult = await submitChatMessage({ draft: ' \n\t ', isSending: false, messages: [], requestId: 'stable-request-id', sendMessage });

  assert.equal(calls, 0);
  assert.equal(duplicateResult.draft, 'Привет');
  assert.equal(whitespaceResult.draft, ' \n\t ');
});

test('does not duplicate a server message that is already present in runtime history', () => {
  assert.deepEqual(appendServerMessage([messages[0]], messages[0]), [messages[0]]);
});

test('merges polling messages by persisted id and sorts by sequence', async () => {
  const { mergeServerMessages } = await import('./chat-runtime');
  const merged = mergeServerMessages([messages[1]], [messages[2], messages[1]]);
  assert.deepEqual(merged.map((message) => message.message_id), ['first', 'second']);
});

test('formats chat preview timestamps in the local timezone around midnight', () => {
  const sameLocalDayMessage = new Date(2026, 10, 5, 12, 15);
  const sameLocalDayNow = new Date(2026, 10, 5, 13, 0);
  assert.equal(formatChatListTimestamp(sameLocalDayMessage.toISOString(), sameLocalDayNow), '12:15');

  const justBeforeLocalMidnight = new Date(2026, 10, 4, 23, 55);
  const justAfterLocalMidnight = new Date(2026, 10, 5, 0, 5);
  assert.match(
    formatChatListTimestamp(justBeforeLocalMidnight.toISOString(), justAfterLocalMidnight),
    /4 нояб\./
  );

  const justAfterMidnightMessage = new Date(2026, 10, 5, 0, 2);
  const sameLocalDayLateNow = new Date(2026, 10, 5, 23, 58);
  assert.equal(formatChatListTimestamp(justAfterMidnightMessage.toISOString(), sameLocalDayLateNow), '00:02');
});

test('formats message timestamps in the local timezone', () => {
  const localMessageTime = new Date(2026, 10, 5, 12, 15);
  const [message] = mapChatMessages(
    [{ ...messages[2], created_at: localMessageTime.toISOString() }],
    ownUserId
  );

  assert.equal(message.sentAtLabel, '12:15');
});

test('treats an unavailable chat id as absent without accessing mock data', () => {
  assert.equal(findChatById([], 'unknown-chat-uuid'), undefined);
});
