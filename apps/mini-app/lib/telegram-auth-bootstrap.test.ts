import assert from 'node:assert/strict';
import { test } from 'node:test';

import type * as TelegramAuthBootstrapModule from './telegram-auth-bootstrap';

const { completeTelegramOnboardingState, createInitialTelegramAuthBootstrapState, runTelegramAuthBootstrap }: typeof TelegramAuthBootstrapModule =
  await import(new URL('./telegram-auth-bootstrap.ts', import.meta.url).href);

const completedAuthResponse = {
  access_token: 'runtime-session-token',
  token_type: 'bearer',
  expires_at: '2026-09-01T00:00:00Z',
  user: { id: 'user-id' },
  onboarding: { status: 'completed' as const },
  profile_exists: true,
  travel_intent_exists: true
};

function createBootstrapInput(
  overrides: Partial<Parameters<typeof runTelegramAuthBootstrap>[0]> = {}
) {
  return {
    getInitData: () => 'raw-telegram-init-data',
    authenticateWithTelegram: async () => completedAuthResponse,
    ...overrides
  };
}

test('starts in loading and authenticates a completed onboarding session', async () => {
  assert.deepEqual(createInitialTelegramAuthBootstrapState(), { status: 'loading' });

  const state = await runTelegramAuthBootstrap(createBootstrapInput());

  assert.equal(state.status, 'authenticated');
  assert.equal(state.session.accessToken, 'runtime-session-token');
});

test('transitions runtime onboarding state to authenticated only from onboarding_required', () => {
  const onboardingState = {
    status: 'onboarding_required' as const,
    onboardingStatus: 'in_progress' as const,
    session: { accessToken: 'runtime-session-token' }
  };

  assert.deepEqual(completeTelegramOnboardingState(onboardingState), {
    status: 'authenticated',
    session: { accessToken: 'runtime-session-token' }
  });
  assert.deepEqual(completeTelegramOnboardingState({ status: 'auth_error', message: 'Ошибка' }), {
    status: 'auth_error',
    message: 'Ошибка'
  });
});

test('requires onboarding when the backend returns not_started', async () => {
  const state = await runTelegramAuthBootstrap(
    createBootstrapInput({
      authenticateWithTelegram: async () => ({
        ...completedAuthResponse,
        onboarding: { status: 'not_started' }
      })
    })
  );

  assert.equal(state.status, 'onboarding_required');
  assert.equal(state.onboardingStatus, 'not_started');
});

test('requires onboarding when the backend returns in_progress', async () => {
  const state = await runTelegramAuthBootstrap(
    createBootstrapInput({
      authenticateWithTelegram: async () => ({
        ...completedAuthResponse,
        onboarding: { status: 'in_progress' }
      })
    })
  );

  assert.equal(state.status, 'onboarding_required');
  assert.equal(state.onboardingStatus, 'in_progress');
});

test('returns an auth error when Telegram authentication fails', async () => {
  const state = await runTelegramAuthBootstrap(
    createBootstrapInput({
      authenticateWithTelegram: async () => {
        throw new Error('backend rejected initData');
      }
    })
  );

  assert.deepEqual(state, {
    status: 'auth_error',
    message: 'Не удалось подтвердить сессию Telegram. Попробуйте открыть приложение ещё раз.'
  });
});

test('returns an auth error for missing or empty initData without calling the backend', async () => {
  let authenticateCalls = 0;
  const authenticateWithTelegram = async () => {
    authenticateCalls += 1;
    return completedAuthResponse;
  };

  for (const initData of [null, '', '   ']) {
    const state = await runTelegramAuthBootstrap({
      getInitData: () => initData,
      authenticateWithTelegram
    });

    assert.deepEqual(state, {
      status: 'auth_error',
      message: 'Telegram initData недоступны. Откройте приложение внутри Telegram.'
    });
  }

  assert.equal(authenticateCalls, 0);
});

test('keeps the access token in runtime state without writing browser storage', async () => {
  const storageCalls: string[] = [];
  const originalLocalStorage = globalThis.localStorage;
  const originalSessionStorage = globalThis.sessionStorage;
  const storage = {
    clear: () => undefined,
    getItem: () => null,
    key: () => null,
    length: 0,
    removeItem: () => undefined,
    setItem: () => storageCalls.push('setItem')
  };

  Object.defineProperties(globalThis, {
    localStorage: { configurable: true, value: storage },
    sessionStorage: { configurable: true, value: storage }
  });

  try {
    const state = await runTelegramAuthBootstrap(createBootstrapInput());

    assert.equal(state.status, 'authenticated');
    assert.equal(storageCalls.length, 0);
  } finally {
    Object.defineProperties(globalThis, {
      localStorage: { configurable: true, value: originalLocalStorage },
      sessionStorage: { configurable: true, value: originalSessionStorage }
    });
  }
});
