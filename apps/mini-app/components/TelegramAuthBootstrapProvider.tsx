'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';

import { createBackendApiClient } from '@/lib/backend-api-client';
import {
  createInitialTelegramAuthBootstrapState,
  runTelegramAuthBootstrap,
  type RuntimeTelegramSession,
  type TelegramAuthBootstrapState
} from '@/lib/telegram-auth-bootstrap';
import { getTelegramInitData, useTelegram } from '@/lib/telegram';

type TelegramAuthContextValue = Readonly<{
  status: TelegramAuthBootstrapState['status'];
  session: RuntimeTelegramSession | null;
  onboardingStatus: 'not_started' | 'in_progress' | null;
  markOnboardingInProgress: () => void;
}>;

const TelegramAuthContext = createContext<TelegramAuthContextValue | undefined>(undefined);

const backendApiClient = createBackendApiClient();

export function TelegramAuthBootstrapProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const telegram = useTelegram();
  const [bootstrapState, setBootstrapState] = useState(createInitialTelegramAuthBootstrapState);
  const isDevelopmentDebugRoute = process.env.NODE_ENV === 'development' && pathname === '/debug-telegram';

  const markOnboardingInProgress = useCallback(() => {
    setBootstrapState((currentState) =>
      currentState.status === 'onboarding_required'
        ? { ...currentState, onboardingStatus: 'in_progress' }
        : currentState
    );
  }, []);

  useEffect(() => {
    if (isDevelopmentDebugRoute || !telegram.isReady) {
      return;
    }

    let isCurrent = true;

    void runTelegramAuthBootstrap({
      getInitData: getTelegramInitData,
      authenticateWithTelegram: backendApiClient.authenticateWithTelegram
    }).then((nextState) => {
      if (isCurrent) {
        setBootstrapState(nextState);
      }
    });

    return () => {
      isCurrent = false;
    };
  }, [isDevelopmentDebugRoute, telegram.isReady]);

  const value = useMemo<TelegramAuthContextValue>(() => {
    const session =
      bootstrapState.status === 'authenticated' || bootstrapState.status === 'onboarding_required'
        ? bootstrapState.session
        : null;
    const onboardingStatus =
      bootstrapState.status === 'onboarding_required' ? bootstrapState.onboardingStatus : null;

    return { status: bootstrapState.status, session, onboardingStatus, markOnboardingInProgress };
  }, [bootstrapState, markOnboardingInProgress]);

  return (
    <TelegramAuthContext.Provider value={value}>
      {isDevelopmentDebugRoute ? children : <TelegramAuthGate state={bootstrapState}>{children}</TelegramAuthGate>}
    </TelegramAuthContext.Provider>
  );
}

function TelegramAuthGate({
  children,
  state
}: {
  children: React.ReactNode;
  state: TelegramAuthBootstrapState;
}) {
  if (state.status === 'authenticated' || state.status === 'onboarding_required') {
    return children;
  }

  if (state.status === 'loading') {
    return <TelegramAuthGateMessage title="Подключаем Telegram" message="Проверяем сессию приложения." />;
  }

  return <TelegramAuthGateMessage title="Не удалось войти" message={state.message} />;
}

function TelegramAuthGateMessage({ title, message }: Readonly<{ title: string; message: string }>) {
  return (
    <main className="auth-gate" aria-live="polite">
      <section className="surface-card auth-gate__card">
        <p className="section-kicker">Travel Friend</p>
        <h1 className="auth-gate__title">{title}</h1>
        <p className="surface-card__copy">{message}</p>
      </section>
    </main>
  );
}

export function useTelegramAuthSession(): TelegramAuthContextValue {
  const context = useContext(TelegramAuthContext);

  if (!context) {
    throw new Error('useTelegramAuthSession must be used within TelegramAuthBootstrapProvider.');
  }

  return context;
}
