import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ProfileResponse } from './backend-api-client';
import type * as ProfileEditingModule from './profile-editing';

const profileEditingModule: typeof ProfileEditingModule = await import(
  new URL('./profile-editing.ts', import.meta.url).href
);

const { createProfileEditingDraft, saveProfileEditing } = profileEditingModule;

const serverProfile: ProfileResponse = {
  id: 'profile-id',
  user_id: 'user-id',
  display_name: 'Алина Морозова',
  birth_date: '1996-09-01',
  gender: null,
  city: 'Санкт-Петербург',
  bio: 'Люблю короткие поездки',
  travel_style: ['Городской'],
  interests: ['Музыка'],
  budget_level: '2',
  comfort_level: '3',
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-31T00:00:00Z'
};

test('creates a Profile edit draft from the server Profile without guessing unknown levels', () => {
  assert.deepEqual(createProfileEditingDraft(serverProfile), {
    displayName: 'Алина Морозова',
    birthDate: '1996-09-01',
    city: 'Санкт-Петербург',
    bio: 'Люблю короткие поездки',
    interests: ['Музыка'],
    travelStyle: ['Городской'],
    budgetLevel: 2,
    comfortLevel: 3
  });

  assert.deepEqual(createProfileEditingDraft({ ...serverProfile, budget_level: 'medium', comfort_level: 'high' }), {
    ...createProfileEditingDraft(serverProfile),
    budgetLevel: null,
    comfortLevel: null
  });
});

test('saves the Profile API payload with birth_date and without UI-only age', async () => {
  const calls: Array<unknown> = [];
  const draft = {
    ...createProfileEditingDraft(serverProfile),
    displayName: '  Алина  ',
    city: '  Москва  ',
    budgetLevel: 4 as const,
    comfortLevel: 1 as const
  };

  const result = await saveProfileEditing({
    draft,
    sourceProfile: serverProfile,
    token: 'runtime-token',
    patchProfile: async (token, payload) => {
      calls.push({ token, payload });
      return { ...serverProfile, display_name: 'Алина', city: 'Москва' };
    }
  });

  assert.deepEqual(calls, [{
    token: 'runtime-token',
    payload: {
      display_name: 'Алина',
      birth_date: '1996-09-01',
      city: 'Москва',
      bio: 'Люблю короткие поездки',
      interests: ['Музыка'],
      travel_style: ['Городской'],
      budget_level: '4',
      comfort_level: '1'
    }
  }]);
  assert.equal(result.status, 'saved');
  const [{ payload }] = calls as Array<{ payload: Record<string, unknown> }>;
  assert.ok(!('age' in payload));
});

test('reports an API error rather than a successful Profile save', async () => {
  const result = await saveProfileEditing({
    draft: createProfileEditingDraft(serverProfile),
    sourceProfile: serverProfile,
    token: 'runtime-token',
    patchProfile: async () => {
      throw new Error('Сервис временно недоступен');
    }
  });

  assert.deepEqual(result, { status: 'api_error', message: 'Сервис временно недоступен' });
});

test('does not overwrite unknown server levels with null while saving other Profile fields', async () => {
  const sourceProfile = { ...serverProfile, budget_level: 'medium', comfort_level: 'high' };
  let payload: Record<string, unknown> | null = null;

  await saveProfileEditing({
    draft: { ...createProfileEditingDraft(sourceProfile), city: 'Москва' },
    sourceProfile,
    token: 'runtime-token',
    patchProfile: async (_token, request) => {
      payload = request;
      return { ...sourceProfile, city: 'Москва' };
    }
  });

  assert.ok(payload !== null);
  assert.ok(!('budget_level' in payload));
  assert.ok(!('comfort_level' in payload));
});

test('sends null when a user clears canonical budget and comfort levels', async () => {
  let payload: Record<string, unknown> | null = null;

  await saveProfileEditing({
    draft: { ...createProfileEditingDraft(serverProfile), budgetLevel: null, comfortLevel: null },
    sourceProfile: serverProfile,
    token: 'runtime-token',
    patchProfile: async (_token, request) => {
      payload = request;
      return { ...serverProfile, budget_level: null, comfort_level: null };
    }
  });

  assert.ok(payload !== null);
  const savedPayload = payload as Record<string, unknown>;
  assert.equal(savedPayload.budget_level, null);
  assert.equal(savedPayload.comfort_level, null);
});

test('sends a selected canonical level when replacing an unknown server level', async () => {
  const sourceProfile = { ...serverProfile, budget_level: 'medium', comfort_level: 'high' };
  let payload: Record<string, unknown> | null = null;

  await saveProfileEditing({
    draft: { ...createProfileEditingDraft(sourceProfile), budgetLevel: 4, comfortLevel: 1 },
    sourceProfile,
    token: 'runtime-token',
    patchProfile: async (_token, request) => {
      payload = request;
      return { ...sourceProfile, budget_level: '4', comfort_level: '1' };
    }
  });

  assert.ok(payload !== null);
  const savedPayload = payload as Record<string, unknown>;
  assert.equal(savedPayload.budget_level, '4');
  assert.equal(savedPayload.comfort_level, '1');
});
