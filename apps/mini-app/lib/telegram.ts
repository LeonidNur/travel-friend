'use client';

import { useEffect, useState } from 'react';

type TelegramColorScheme = 'dark' | 'light';
type TelegramSource = 'browser' | 'telegram-webapp';

type TelegramWebApp = {
  initData?: string;
  platform?: string;
  version?: string;
  colorScheme?: TelegramColorScheme;
  viewportHeight?: number;
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
  return {
    isReady: true,
    isTelegram: false,
    source: 'browser',
    telegramExists,
    webAppExists: false,
    platform: 'browser',
    version: 'n/a',
    colorScheme: getBrowserColorScheme(),
    viewportHeight: getBrowserViewportHeight(),
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

  return {
    isReady: true,
    isTelegram: true,
    source: 'telegram-webapp',
    telegramExists: true,
    webAppExists: true,
    platform: webApp.platform ?? 'unknown',
    version: webApp.version ?? 'unknown',
    colorScheme: webApp.colorScheme ?? getBrowserColorScheme(),
    viewportHeight: typeof webApp.viewportHeight === 'number' ? webApp.viewportHeight : getBrowserViewportHeight(),
    initDataLength: webApp.initData?.length ?? 0
  };
}

export function useTelegram(): TelegramState {
  const [telegramState, setTelegramState] = useState<TelegramState>(getLoadingState);

  useEffect(() => {
    let timeoutId: number | undefined;
    let cancelled = false;
    const maxAttempts = 20;
    const retryDelayMs = 50;
    let attempts = 0;

    const refreshTelegramState = () => {
      if (cancelled) {
        return;
      }

      const telegramWindow = window as TelegramWindow;
      const webApp = telegramWindow.Telegram?.WebApp;

      if (webApp) {
        setTelegramState(getTelegramState(telegramWindow));
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
    };
  }, []);

  return telegramState;
}
