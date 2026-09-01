import type { BackendApiClient } from './backend-api-client';

export type OnboardingCompletionResult =
  | Readonly<{ status: 'completed' }>
  | Readonly<{ status: 'api_error'; message: string }>;

type CompleteOnboardingInput = Readonly<{
  token: string;
  patchOnboarding: BackendApiClient['patchOnboarding'];
  applyCompletedState: () => void;
}>;

export async function completeOnboarding(
  input: CompleteOnboardingInput
): Promise<OnboardingCompletionResult> {
  try {
    const response = await input.patchOnboarding(input.token, { status: 'completed' });

    if (response.status !== 'completed') {
      return { status: 'api_error', message: 'Не удалось завершить настройку. Попробуйте ещё раз.' };
    }

    input.applyCompletedState();
    return { status: 'completed' };
  } catch (error) {
    return {
      status: 'api_error',
      message: error instanceof Error ? error.message : 'Не удалось завершить настройку. Попробуйте ещё раз.'
    };
  }
}
