import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import Script from 'next/script';

import { CurrentUserProfileProvider } from '@/components/CurrentUserProfileProvider';
import { InterestDecisionProvider } from '@/components/InterestDecisionProvider';
import { TelegramAuthBootstrapProvider } from '@/components/TelegramAuthBootstrapProvider';
import { TelegramAppShell } from '@/components/TelegramAppShell';

import './globals.css';

const inter = Inter({
  subsets: ['latin', 'cyrillic'],
  display: 'swap',
  variable: '--font-inter'
});

export const metadata: Metadata = {
  title: 'Travel Friend',
  description: 'Мини-приложение Telegram для поиска попутчиков.'
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className={inter.variable}>
        <Script
          src="https://telegram.org/js/telegram-web-app.js"
          strategy="afterInteractive"
        />
        <TelegramAuthBootstrapProvider>
          <CurrentUserProfileProvider>
            <InterestDecisionProvider>
              <TelegramAppShell>{children}</TelegramAppShell>
            </InterestDecisionProvider>
          </CurrentUserProfileProvider>
        </TelegramAuthBootstrapProvider>
      </body>
    </html>
  );
}
