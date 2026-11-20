export const ONBOARDING_VISUAL_STEPS = ['profile', 'travel_style', 'first_trip'] as const;
export const ONBOARDING_SUCCESS_DELAY_MS = 1000;

export type OnboardingVisualStep = typeof ONBOARDING_VISUAL_STEPS[number];

export function getOnboardingStepLabel(step: OnboardingVisualStep) {
  const stepNumber = ONBOARDING_VISUAL_STEPS.indexOf(step) + 1;
  return `Шаг ${stepNumber} из ${ONBOARDING_VISUAL_STEPS.length}`;
}

export function getNextOnboardingVisualStep(step: OnboardingVisualStep) {
  const nextStepIndex = ONBOARDING_VISUAL_STEPS.indexOf(step) + 1;
  return ONBOARDING_VISUAL_STEPS[nextStepIndex] ?? null;
}

export function getPreviousOnboardingVisualStep(step: OnboardingVisualStep) {
  const previousStepIndex = ONBOARDING_VISUAL_STEPS.indexOf(step) - 1;
  return previousStepIndex < 0 ? null : ONBOARDING_VISUAL_STEPS[previousStepIndex] ?? null;
}
