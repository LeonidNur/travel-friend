import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ChatResponse } from './backend-api-client';
import {
  getAvailableGroupChatCompanions,
  normalizeGroupChatTitle,
  validateGroupChatCompanionIds
} from './group-chat-runtime';

const chats: ChatResponse[] = [
  {
    chat_id: 'direct-one',
    type: 'direct',
    companion: { user_id: 'user-one', display_name: 'Мария', age: 30, city: 'Казань' },
    created_at: '2026-09-01T10:00:00Z', last_message: null, unread_count: 0
  },
  {
    chat_id: 'group-one',
    type: 'group',
    title: null,
    participants: [{ user_id: 'user-one', display_name: 'Мария' }],
    participant_count: 1,
    created_at: '2026-09-01T10:01:00Z', last_message: null, unread_count: 0
  },
  {
    chat_id: 'direct-two',
    type: 'direct',
    companion: { user_id: 'user-two', display_name: 'Илья', age: null, city: null },
    created_at: '2026-09-01T10:02:00Z', last_message: null, unread_count: 0
  }
];

test('offers only existing direct Chat companions for a new group Chat', () => {
  assert.deepEqual(
    getAvailableGroupChatCompanions(chats),
    [
      { user_id: 'user-one', display_name: 'Мария' },
      { user_id: 'user-two', display_name: 'Илья' }
    ]
  );
});

test('requires two unique companions before creating a group Chat', () => {
  assert.equal(validateGroupChatCompanionIds([]), 'Выберите минимум двух собеседников.');
  assert.equal(validateGroupChatCompanionIds(['user-one']), 'Выберите минимум двух собеседников.');
  assert.equal(validateGroupChatCompanionIds(['user-one', 'user-one']), 'Выберите разных собеседников.');
  assert.equal(validateGroupChatCompanionIds(['user-one', 'user-two']), null);
});

test('normalizes optional group titles using an 80 code point limit', () => {
  assert.deepEqual(normalizeGroupChatTitle('  Поездка  '), { title: 'Поездка', error: null });
  assert.deepEqual(normalizeGroupChatTitle(' \t '), { title: null, error: null });
  assert.notEqual(normalizeGroupChatTitle('я'.repeat(81)).error, null);
  assert.equal(normalizeGroupChatTitle('🚂'.repeat(80)).error, null);
});
