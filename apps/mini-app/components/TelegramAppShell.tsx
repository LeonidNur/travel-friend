'use client';

import { useEffect } from 'react';

import { getTelegramWebApp } from '@/lib/telegram';

interface TelegramAppShellProps {
  children: React.ReactNode;
}

export function TelegramAppShell({ children }: TelegramAppShellProps) {
  useEffect(() => {
    const telegramWebApp = getTelegramWebApp();

    if (!telegramWebApp) {
      return;
    }

    telegramWebApp.ready();
    telegramWebApp.expand();
  }, []);

  return <div className="app-shell">{children}</div>;
}
