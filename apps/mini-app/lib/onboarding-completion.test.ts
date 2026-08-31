import assert from 'node:assert/strict';
import { test } from 'node:test';

import type * as OnboardingCompletionModule from './onboarding-completion';

const onboardingCompletionModule: typeof OnboardingCompletionModule = await import(
  new URL('./onboarding-completion.ts', import.meta.url).href
);

const { completeOnboarding } = onboardingCompletionModule;

test('sends the exact completed PATCH payload and applies the runtime transition only after success', async () => {
  const calls: unknown[] = [];
  let transitionCalls = 0;

  const result = await completeOnboarding({
    token: 'runtime-token',
    patchOnboarding: async (token, payload) => {
      calls.push({ token, payload });
      assert.equal(transitionCalls, 0);
      return { status: 'completed' };
    },
    applyCompletedState: () => {
      transitionCalls += 1;
    }
  });

  assert.deepEqual(calls, [{ token: 'runtime-token', payload: { status: 'completed' } }]);
  assert.equal(transitionCalls, 1);
  assert.deepEqual(result, { status: 'completed' });
});

test('keeps onboarding active after an API error and allows a retry', async () => {
  let attempts = 0;
  let transitionCalls = 0;
  const input = {
    token: 'runtime-token',
    patchOnboarding: async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('Сервис временно недоступен');
      }
      return { status: 'completed' as const };
    },
    applyCompletedState: () => {
      transitionCalls += 1;
    }
  };

  const failedResult = await completeOnboarding(input);
  assert.deepEqual(failedResult, { status: 'api_error', message: 'Сервис временно недоступен' });
  assert.equal(transitionCalls, 0);

  const retryResult = await completeOnboarding(input);
  assert.deepEqual(retryResult, { status: 'completed' });
  assert.equal(attempts, 2);
  assert.equal(transitionCalls, 1);
});
