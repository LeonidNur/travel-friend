'use client';

import { useEffect, useState } from 'react';
import {
  getTelegramViewport,
  subscribeTelegramViewport,
  type TelegramInsets,
  type TelegramViewportApi
} from '@/lib/telegram-viewport';

type TelegramColorScheme = 'dark' | 'light';
type TelegramSource = 'browser' | 'telegram-webapp';

type TelegramWebApp = {
  initData?: string;
  platform?: string;
  version?: string;
  colorScheme?: TelegramColorScheme;
  viewportHeight?: number;
  viewportStableHeight?: number;
  safeAreaInset?: Partial<TelegramInsets>;
  contentSafeAreaInset?: Partial<TelegramInsets>;
  onEvent?: TelegramViewportApi['onEvent'];
  offEvent?: TelegramViewportApi['offEvent'];
  ready?: () => void;
  expand?: () => void;
};

type TelegramWindow = Window &
  typeof globalThis & {
    Telegram?: {
      WebApp?: TelegramWebApp;
    };
  };

export function getTelegramInitData(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const initData = (window as TelegramWindow).Telegram?.WebApp?.initData;

  return typeof initData === 'string' && initData.trim().length > 0 ? initData : null;
}

export interface TelegramState {
  isReady: boolean;
  isTelegram: boolean;
  source: TelegramSource;
  telegramExists: boolean;
  webAppExists: boolean;
  platform: string;
  version: string;
  colorScheme: TelegramColorScheme;
  viewportHeight: number;
  viewportStableHeight: number;
  safeAreaInset: TelegramInsets;
  contentSafeAreaInset: TelegramInsets;
  initDataLength: number;
}

let isTelegramReadyCalled = false;

function getBrowserColorScheme(): TelegramColorScheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'light';
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function getBrowserViewportHeight(): number {
  if (typeof window === 'undefined') {
    return 0;
  }

  return window.innerHeight;
}

function getBrowserFallbackState(telegramExists = false): TelegramState {
  const viewport = getTelegramViewport(undefined, getBrowserViewportHeight());

  return {
    isReady: true,
    isTelegram: false,
    source: 'browser',
    telegramExists,
    webAppExists: false,
    platform: 'browser',
    version: 'n/a',
    colorScheme: getBrowserColorScheme(),
    ...viewport,
    initDataLength: 0
  };
}

function getLoadingState(): TelegramState {
  return {
    isReady: false,
    isTelegram: false,
    source: 'browser',
    telegramExists: false,
    webAppExists: false,
    platform: 'loading',
    version: 'loading',
    colorScheme: 'light',
    viewportHeight: 0,
    viewportStableHeight: 0,
    safeAreaInset: { top: 0, right: 0, bottom: 0, left: 0 },
    contentSafeAreaInset: { top: 0, right: 0, bottom: 0, left: 0 },
    initDataLength: 0
  };
}

function getTelegramState(telegramWindow: TelegramWindow): TelegramState {
  const webApp = telegramWindow.Telegram?.WebApp;

  if (!webApp) {
    return getBrowserFallbackState(Boolean(telegramWindow.Telegram));
  }

  if (!isTelegramReadyCalled) {
    webApp.ready?.();
    webApp.expand?.();
    isTelegramReadyCalled = true;
  }

  const viewport = getTelegramViewport(webApp, getBrowserViewportHeight());

  return {
    isReady: true,
    isTelegram: true,
    source: 'telegram-webapp',
    telegramExists: true,
    webAppExists: true,
    platform: webApp.platform ?? 'unknown',
    version: webApp.version ?? 'unknown',
    colorScheme: webApp.colorScheme ?? getBrowserColorScheme(),
    ...viewport,
    initDataLength: webApp.initData?.length ?? 0
  };
}

export function useTelegram(): TelegramState {
  const [telegramState, setTelegramState] = useState<TelegramState>(getLoadingState);

  useEffect(() => {
    let timeoutId: number | undefined;
    let cancelled = false;
    let unsubscribeViewport: () => void = () => undefined;
    const maxAttempts = 20;
    const retryDelayMs = 50;
    let attempts = 0;
    const handleBrowserResize = () => {
      const webApp = (window as TelegramWindow).Telegram?.WebApp;

      if (!webApp?.viewportHeight) {
        setTelegramState((currentState) => ({
          ...currentState,
          ...getTelegramViewport(undefined, getBrowserViewportHeight())
        }));
      }
    };

    window.addEventListener('resize', handleBrowserResize);

    const refreshTelegramState = () => {
      if (cancelled) {
        return;
      }

      const telegramWindow = window as TelegramWindow;
      const webApp = telegramWindow.Telegram?.WebApp;

      if (webApp) {
        setTelegramState(getTelegramState(telegramWindow));
        unsubscribeViewport = subscribeTelegramViewport(
          webApp as TelegramViewportApi,
          getBrowserViewportHeight(),
          (viewport) => setTelegramState((currentState) => ({ ...currentState, ...viewport }))
        );
        return;
      }

      attempts += 1;

      if (attempts >= maxAttempts) {
        setTelegramState(getBrowserFallbackState(Boolean(telegramWindow.Telegram)));
        return;
      }

      timeoutId = window.setTimeout(refreshTelegramState, retryDelayMs);
    };

    refreshTelegramState();

    return () => {
      cancelled = true;

      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
      unsubscribeViewport();
      window.removeEventListener('resize', handleBrowserResize);
    };
  }, []);

  return telegramState;
}
