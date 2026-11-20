'use client';

import { createContext, useContext, useEffect } from 'react';

import { useTelegram, type TelegramState } from '@/lib/telegram';

const TelegramViewportContext = createContext<TelegramState | undefined>(undefined);

export function TelegramViewportController({ children }: { children: React.ReactNode }) {
  const telegramState = useTelegram();
  const { viewportHeight, viewportStableHeight, safeAreaInset, contentSafeAreaInset } = telegramState;

  useEffect(() => {
    const root = document.documentElement;
    const insetSides = ['top', 'right', 'bottom', 'left'] as const;

    if (viewportHeight > 0) {
      root.style.setProperty('--app-telegram-viewport-height', `${viewportHeight}px`);
    } else {
      root.style.removeProperty('--app-telegram-viewport-height');
    }

    if (viewportStableHeight > 0) {
      root.style.setProperty('--app-telegram-viewport-stable-height', `${viewportStableHeight}px`);
    } else {
      root.style.removeProperty('--app-telegram-viewport-stable-height');
    }

    insetSides.forEach((side) => {
      const inset = Math.max(safeAreaInset[side], contentSafeAreaInset[side]);
      root.style.setProperty(`--app-telegram-safe-area-${side}`, `${inset}px`);
    });

    return () => {
      root.style.removeProperty('--app-telegram-viewport-height');
      root.style.removeProperty('--app-telegram-viewport-stable-height');
      insetSides.forEach((side) => root.style.removeProperty(`--app-telegram-safe-area-${side}`));
    };
  }, [contentSafeAreaInset, safeAreaInset, viewportHeight, viewportStableHeight]);

  return <TelegramViewportContext.Provider value={telegramState}>{children}</TelegramViewportContext.Provider>;
}

export function useTelegramViewportState(): TelegramState {
  const context = useContext(TelegramViewportContext);

  if (!context) {
    throw new Error('useTelegramViewportState must be used within TelegramViewportController.');
  }

  return context;
}
