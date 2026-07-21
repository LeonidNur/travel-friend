import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getDisplayedChatParticipant } from './current-user-chat-participant';
import { getChatById } from './mock-chats';
import { currentUserProfile } from './mock-current-user';
import type { ChatParticipant } from './types';

import { formatChatParticipantLabel } from './chat-participant-label';

test('formats the current session profile for the current user participant', () => {
  const chat = getChatById('chat-amina-tbilisi');

  assert.ok(chat);

  const sourceParticipant = chat.participants[0];
  const sessionProfile = {
    ...currentUserProfile,
    name: 'Алина Петрова',
    age: 31,
    city: 'Москва'
  };

  const displayedParticipant = getDisplayedChatParticipant(sourceParticipant, sessionProfile);

  assert.equal(formatChatParticipantLabel(displayedParticipant), 'Алина Петрова, 31 · Москва');
});

test('formats a fixture participant using their own fixture data', () => {
  const chat = getChatById('chat-amina-tbilisi');

  assert.ok(chat);

  const sourceParticipant = chat.participants[1];

  assert.equal(formatChatParticipantLabel(sourceParticipant), 'Мария Иванова, 27 · Москва');
});

test('does not mutate the original participant while formatting', () => {
  const sourceParticipant: ChatParticipant = {
    id: 'maria-ivanova',
    name: 'Мария Иванова',
    age: 27,
    city: 'Москва'
  };
  const participantSnapshot = structuredClone(sourceParticipant);

  assert.equal(formatChatParticipantLabel(sourceParticipant), 'Мария Иванова, 27 · Москва');
  assert.deepEqual(sourceParticipant, participantSnapshot);
});
