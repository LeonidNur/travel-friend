'use client';

import { usePathname } from 'next/navigation';

import { AppHeader } from '@/components/AppHeader';
import { BottomNavigation } from '@/components/BottomNavigation';
import { OnboardingProfileScreen } from '@/components/OnboardingProfileScreen';
import { useTelegramAuthSession } from '@/components/TelegramAuthBootstrapProvider';
import { getRouteMeta } from '@/lib/navigation';
import { useTelegram } from '@/lib/telegram';

interface TelegramAppShellProps {
  children: React.ReactNode;
}

export function TelegramAppShell({ children }: TelegramAppShellProps) {
  const pathname = usePathname();
  const { status: authStatus } = useTelegramAuthSession();
  const routeMeta = getRouteMeta(pathname);
  const shouldHideBottomNavigation = pathname.startsWith('/chats/');
  useTelegram();

  if (authStatus === 'onboarding_required') {
    return <OnboardingProfileScreen />;
  }

  return (
    <div className="app-shell">
      <AppHeader title={routeMeta.title} description={routeMeta.description} />
      <main className="app-content">
        <div className="app-content__frame">{children}</div>
      </main>
      {shouldHideBottomNavigation ? null : <BottomNavigation pathname={pathname} />}
    </div>
  );
}
