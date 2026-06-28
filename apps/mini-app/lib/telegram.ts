'use client';

import { useEffect, useMemo } from 'react';

import {
  expandViewport,
  init,
  isTMA,
  miniAppReady,
  retrieveLaunchParams
} from '@telegram-apps/sdk';
import { isThemeParamsDark, useSignal, viewportHeight } from '@telegram-apps/sdk-react';

export interface TelegramState {
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
    isTelegram: false,
    platform: 'browser',
    version: 'n/a',
    colorScheme: getBrowserColorScheme(),
    viewportHeight: getBrowserViewportHeight()
  };
}

function getTelegramFallbackState(
  colorScheme: 'dark' | 'light',
  currentViewportHeight: number
): TelegramState {
  const launchParams = retrieveLaunchParams();

  return {
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
  const isTelegram = useMemo(() => isTMA(), []);
  const themeIsDark = useSignal(isThemeParamsDark);
  const currentViewportHeight = useSignal(viewportHeight);

  useEffect(() => {
    ensureTelegramInitialized();
  }, [isTelegram]);

  return useMemo(() => {
    if (!isTelegram) {
      return getBrowserFallbackState();
    }

    try {
      return getTelegramFallbackState(themeIsDark ? 'dark' : 'light', currentViewportHeight);
    } catch {
      return {
        isTelegram: true,
        platform: 'unknown',
        version: 'unknown',
        colorScheme: themeIsDark ? 'dark' : 'light',
        viewportHeight: currentViewportHeight
      };
    }
  }, [currentViewportHeight, isTelegram, themeIsDark]);
}
