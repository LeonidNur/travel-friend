'use client';

import { usePathname } from 'next/navigation';

import { BottomNavigation } from '@/components/BottomNavigation';
import { OnboardingProfileScreen } from '@/components/OnboardingProfileScreen';
import { useTelegramAuthSession } from '@/components/TelegramAuthBootstrapProvider';

interface TelegramAppShellProps {
  children: React.ReactNode;
}

export function TelegramAppShell({ children }: TelegramAppShellProps) {
  const pathname = usePathname();
  const { status: authStatus } = useTelegramAuthSession();
  const shouldHideBottomNavigation = pathname.startsWith('/chats/');

  if (process.env.NODE_ENV === 'development' && pathname === '/debug-telegram') {
    return children;
  }

  if (authStatus === 'onboarding_required') {
    return <OnboardingProfileScreen />;
  }

  return (
    <div className="app-shell">
      <main className="app-content">
        <div className="app-content__frame">{children}</div>
      </main>
      {shouldHideBottomNavigation ? null : <BottomNavigation pathname={pathname} />}
    </div>
  );
}
