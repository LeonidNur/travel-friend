import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  getChatParticipantProfilePath,
  getChatParticipantProfileScreenState,
  getGroupParticipantProfilePath
} from './chat-participant-profile-runtime';

test('builds the nested profile route for a direct companion', () => {
  assert.equal(getChatParticipantProfilePath('chat-uuid', 'companion-uuid'), '/chats/chat-uuid/participants/companion-uuid');
});

test('opens another Group member through the nested profile route and self through /profile', () => {
  assert.equal(getGroupParticipantProfilePath('group-uuid', 'other-uuid', 'current-uuid'), '/chats/group-uuid/participants/other-uuid');
  assert.equal(getGroupParticipantProfilePath('group-uuid', 'current-uuid', 'current-uuid'), '/profile');
});

test('models persisted participant profile loading, success, error, and not-found states', () => {
  assert.equal(getChatParticipantProfileScreenState({ isLoading: true, errorStatus: null, profile: null }), 'loading');
  assert.equal(getChatParticipantProfileScreenState({ isLoading: false, errorStatus: 404, profile: null }), 'not_found');
  assert.equal(getChatParticipantProfileScreenState({ isLoading: false, errorStatus: 500, profile: null }), 'error');
  assert.equal(getChatParticipantProfileScreenState({ isLoading: false, errorStatus: null, profile: { user_id: 'user' } }), 'success');
});
