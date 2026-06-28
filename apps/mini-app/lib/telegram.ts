'use client';

import { useEffect, useState } from 'react';

import {
  expandViewport,
  init,
  isTMA,
  miniAppReady,
  retrieveLaunchParams
} from '@telegram-apps/sdk';
import { isThemeParamsDark, viewportHeight } from '@telegram-apps/sdk-react';

export interface TelegramState {
  isReady: boolean;
  isTelegram: boolean;
  platform: string;
  version: string;
  colorScheme: 'dark' | 'light';
  viewportHeight: number;
}

let isTelegramSdkInitialized = false;

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

  return {
    isReady: true,
    isTelegram: true,
    platform: launchParams.tgWebAppPlatform,
    version: launchParams.tgWebAppVersion,
    colorScheme,
    viewportHeight: currentViewportHeight
  };
}

function ensureTelegramInitialized(): void {
  if (isTelegramSdkInitialized || !isTMA()) {
    return;
  }

  init();
  miniAppReady();
  expandViewport();
  isTelegramSdkInitialized = true;
}

export function useTelegram(): TelegramState {
  const [telegramState, setTelegramState] = useState<TelegramState>(getLoadingState);

  useEffect(() => {
    if (!isTMA()) {
      setTelegramState(getBrowserFallbackState());
      return;
    }

    try {
      ensureTelegramInitialized();

      setTelegramState(
        getTelegramFallbackState(isThemeParamsDark() ? 'dark' : 'light', viewportHeight())
      );
    } catch {
      setTelegramState({
        isReady: true,
        isTelegram: true,
        platform: 'unknown',
        version: 'unknown',
        colorScheme: 'light',
        viewportHeight: 0
      });
    }
  }, []);

  return telegramState;
}
