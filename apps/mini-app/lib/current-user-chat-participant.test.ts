import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CURRENT_USER_CHAT_PARTICIPANT_ID, getChatById } from './mock-chats';
import { CURRENT_USER_ID, currentUserProfile } from './mock-current-user';
import type * as CurrentUserChatParticipantModule from './current-user-chat-participant';

const { getDisplayedChatParticipant }: typeof CurrentUserChatParticipantModule = await import(
  new URL('./current-user-chat-participant.ts', import.meta.url).href
);

test('uses one stable identifier for the current chat participant', () => {
  assert.equal(CURRENT_USER_CHAT_PARTICIPANT_ID, CURRENT_USER_ID);
});

test('resolves the current chat participant from updated session profile values without mutating fixtures', () => {
  const chat = getChatById('chat-amina-tbilisi');

  assert.ok(chat);

  const sourceParticipant = chat.participants[0];
  const fixtureSnapshot = structuredClone(sourceParticipant);
  const sessionProfile = {
    ...currentUserProfile,
    name: 'Алина Петрова',
    age: 31,
    city: 'Москва'
  };

  const participant = getDisplayedChatParticipant(sourceParticipant, sessionProfile);

  assert.deepEqual(
    { name: participant.name, age: participant.age, city: participant.city },
    { name: 'Алина Петрова', age: 31, city: 'Москва' }
  );
  assert.notEqual(participant, sourceParticipant);
  assert.deepEqual(sourceParticipant, fixtureSnapshot);
});

test('keeps other chat participants unchanged', () => {
  const chat = getChatById('chat-amina-tbilisi');

  assert.ok(chat);

  const sourceParticipant = chat.participants[1];
  const participant = getDisplayedChatParticipant(sourceParticipant, currentUserProfile);

  assert.equal(participant, sourceParticipant);
});
