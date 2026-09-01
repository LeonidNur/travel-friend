import type { OnboardingStatus, TelegramAuthResponse } from '@/lib/backend-api-client';

export type RuntimeTelegramSession = Readonly<{
  accessToken: string;
  userId: string;
}>;

export type TelegramAuthBootstrapState =
  | Readonly<{ status: 'loading' }>
  | Readonly<{ status: 'authenticated'; session: RuntimeTelegramSession }>
  | Readonly<{
      status: 'onboarding_required';
      onboardingStatus: Exclude<OnboardingStatus, 'completed'>;
      session: RuntimeTelegramSession;
    }>
  | Readonly<{ status: 'auth_error'; message: string }>;

export type TelegramAuthBootstrapInput = Readonly<{
  getInitData: () => string | null;
  authenticateWithTelegram: (initData: string) => Promise<TelegramAuthResponse>;
}>;

const MISSING_INIT_DATA_MESSAGE = 'Telegram initData недоступны. Откройте приложение внутри Telegram.';
const AUTHENTICATION_FAILED_MESSAGE =
  'Не удалось подтвердить сессию Telegram. Попробуйте открыть приложение ещё раз.';

export function createInitialTelegramAuthBootstrapState(): TelegramAuthBootstrapState {
  return { status: 'loading' };
}

export function completeTelegramOnboardingState(
  state: TelegramAuthBootstrapState
): TelegramAuthBootstrapState {
  return state.status === 'onboarding_required'
    ? { status: 'authenticated', session: state.session }
    : state;
}

function createRuntimeTelegramSession(accessToken: string, userId: string): RuntimeTelegramSession | null {
  return accessToken.trim().length > 0 && userId.trim().length > 0 ? { accessToken, userId } : null;
}

export async function runTelegramAuthBootstrap(
  input: TelegramAuthBootstrapInput
): Promise<TelegramAuthBootstrapState> {
  const initData = input.getInitData();

  if (initData === null || initData.trim().length === 0) {
    return { status: 'auth_error', message: MISSING_INIT_DATA_MESSAGE };
  }

  try {
    const response = await input.authenticateWithTelegram(initData);
    const session = createRuntimeTelegramSession(response.access_token, response.user.id);

    if (!session) {
      return { status: 'auth_error', message: AUTHENTICATION_FAILED_MESSAGE };
    }

    if (response.onboarding.status === 'completed') {
      return { status: 'authenticated', session };
    }

    return {
      status: 'onboarding_required',
      onboardingStatus: response.onboarding.status,
      session
    };
  } catch {
    return { status: 'auth_error', message: AUTHENTICATION_FAILED_MESSAGE };
  }
}
