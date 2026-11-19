import { notFound } from 'next/navigation';

export default async function DebugTelegramPage() {
  if (process.env.NODE_ENV === 'development') {
    const { default: TelegramDiagnostics } = await import('./diagnostics');
    return <TelegramDiagnostics />;
  }

  notFound();
}
