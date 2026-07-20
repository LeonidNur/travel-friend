import type { Metadata } from 'next';
import Script from 'next/script';

import { InterestDecisionProvider } from '@/components/InterestDecisionProvider';
import { TelegramAppShell } from '@/components/TelegramAppShell';

import './globals.css';

export const metadata: Metadata = {
  title: 'Travel Friend',
  description: 'Telegram Mini App MVP for finding travel companions.'
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body>
        <Script
          src="https://telegram.org/js/telegram-web-app.js"
          strategy="afterInteractive"
        />
        <InterestDecisionProvider>
          <TelegramAppShell>{children}</TelegramAppShell>
        </InterestDecisionProvider>
      </body>
    </html>
  );
}
