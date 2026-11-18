import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ONBOARDING_VISUAL_STEPS,
  getNextOnboardingVisualStep,
  getOnboardingStepLabel,
  getPreviousOnboardingVisualStep
} from './onboarding-visual-steps';

test('exposes the three approved visual onboarding steps in order', () => {
  assert.deepEqual(ONBOARDING_VISUAL_STEPS, ['profile', 'travel_style', 'first_trip']);
  assert.deepEqual(
    ONBOARDING_VISUAL_STEPS.map(getOnboardingStepLabel),
    ['Шаг 1 из 3', 'Шаг 2 из 3', 'Шаг 3 из 3']
  );
});

test('moves forward and back without crossing onboarding boundaries', () => {
  assert.equal(getNextOnboardingVisualStep('profile'), 'travel_style');
  assert.equal(getNextOnboardingVisualStep('travel_style'), 'first_trip');
  assert.equal(getNextOnboardingVisualStep('first_trip'), null);
  assert.equal(getPreviousOnboardingVisualStep('first_trip'), 'travel_style');
  assert.equal(getPreviousOnboardingVisualStep('travel_style'), 'profile');
  assert.equal(getPreviousOnboardingVisualStep('profile'), null);
});
