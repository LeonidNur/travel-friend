'use client';

import { usePathname } from 'next/navigation';

import { AppHeader } from '@/components/AppHeader';
import { BottomNavigation } from '@/components/BottomNavigation';
import { getRouteMeta } from '@/lib/navigation';
import { useTelegram } from '@/lib/telegram';

interface TelegramAppShellProps {
  children: React.ReactNode;
}

export function TelegramAppShell({ children }: TelegramAppShellProps) {
  const pathname = usePathname();
  const routeMeta = getRouteMeta(pathname);
  useTelegram();

  return (
    <div className="app-shell">
      <AppHeader title={routeMeta.title} description={routeMeta.description} />
      <main className="app-content">
        <div className="app-content__frame">{children}</div>
      </main>
      <BottomNavigation pathname={pathname} />
    </div>
  );
}
