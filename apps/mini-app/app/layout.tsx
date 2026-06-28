import type { Metadata } from 'next';

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
    <html lang="en">
      <body>
        <TelegramAppShell>{children}</TelegramAppShell>
      </body>
    </html>
  );
}
