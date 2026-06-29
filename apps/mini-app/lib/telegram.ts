'use client';

import { useEffect, useState } from 'react';

import {
  expandViewport,
  init,
  isTMA,
  isThemeParamsDark,
  mountThemeParamsSync,
  mountViewport,
  miniAppReady,
  retrieveLaunchParams,
  viewportHeight
} from '@telegram-apps/sdk';

export interface TelegramState {
  isReady: boolean;
  isTelegram: boolean;
  platform: string;
  version: string;
  colorScheme: 'dark' | 'light';
  viewportHeight: number;
}

let isTelegramSdkInitialized = false;

interface TelegramWebAppGlobal {
  colorScheme?: 'dark' | 'light';
  platform?: string;
  version?: string;
  viewportHeight?: number;
}

interface TelegramWindow extends Window {
  Telegram?: {
    WebApp?: TelegramWebAppGlobal;
  };
}

function getBrowserColorScheme(): 'dark' | 'light' {
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

function getBrowserFallbackState(): TelegramState {
  return {
    isReady: true,
    isTelegram: false,
    platform: 'browser',
    version: 'n/a',
    colorScheme: getBrowserColorScheme(),
    viewportHeight: getBrowserViewportHeight()
  };
}

function getTelegramWebApp(): TelegramWebAppGlobal | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }

  return (window as TelegramWindow).Telegram?.WebApp;
}

function getLoadingState(): TelegramState {
  return {
    isReady: false,
    isTelegram: false,
    platform: 'loading',
    version: 'loading',
    colorScheme: 'light',
    viewportHeight: 0
  };
}

function getTelegramFallbackState(
  colorScheme: 'dark' | 'light',
  currentViewportHeight: number
): TelegramState {
  const launchParams = retrieveLaunchParams();
  const webApp = getTelegramWebApp();

  return {
    isReady: true,
    isTelegram: true,
    platform: webApp?.platform ?? launchParams.tgWebAppPlatform,
    version: webApp?.version ?? launchParams.tgWebAppVersion,
    colorScheme,
    viewportHeight: currentViewportHeight
  };
}

async function ensureTelegramInitialized(): Promise<void> {
  if (isTelegramSdkInitialized || !isTMA()) {
    return;
  }

  init();
  mountThemeParamsSync.ifAvailable();
  const viewportMount = mountViewport.ifAvailable();

  if (viewportMount[0]) {
    await viewportMount[1];
  }

  miniAppReady();
  expandViewport.ifAvailable();
  isTelegramSdkInitialized = true;
}

function getTelegramColorScheme(): 'dark' | 'light' {
  const webAppColorScheme = getTelegramWebApp()?.colorScheme;

  if (webAppColorScheme === 'dark' || webAppColorScheme === 'light') {
    return webAppColorScheme;
  }

  try {
    return isThemeParamsDark() ? 'dark' : 'light';
  } catch {
    return getBrowserColorScheme();
  }
}

function getTelegramViewportHeight(): number {
  const webAppViewportHeight = getTelegramWebApp()?.viewportHeight;

  if (typeof webAppViewportHeight === 'number' && webAppViewportHeight > 0) {
    return Math.round(webAppViewportHeight);
  }

  let sdkViewportHeight = 0;

  try {
    sdkViewportHeight = viewportHeight();
  } catch {
    sdkViewportHeight = 0;
  }

  if (typeof sdkViewportHeight === 'number' && sdkViewportHeight > 0) {
    return Math.round(sdkViewportHeight);
  }

  return getBrowserViewportHeight();
}

export function useTelegram(): TelegramState {
  const [telegramState, setTelegramState] = useState<TelegramState>(getLoadingState);

  useEffect(() => {
    let isMounted = true;

    if (!isTMA()) {
      setTelegramState(getBrowserFallbackState());
      return undefined;
    }

    async function updateTelegramState() {
      try {
        await ensureTelegramInitialized();

        if (!isMounted) {
          return;
        }

        setTelegramState(
          getTelegramFallbackState(getTelegramColorScheme(), getTelegramViewportHeight())
        );
      } catch {
        if (!isMounted) {
          return;
        }

        setTelegramState({
          isReady: true,
          isTelegram: true,
          platform: getTelegramWebApp()?.platform ?? 'unknown',
          version: getTelegramWebApp()?.version ?? 'unknown',
          colorScheme: getTelegramWebApp()?.colorScheme ?? 'light',
          viewportHeight: getBrowserViewportHeight()
        });
      }
    }

    void updateTelegramState();

    return () => {
      isMounted = false;
    };
  }, []);

  return telegramState;
}
