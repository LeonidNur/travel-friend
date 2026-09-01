'use client';

import Script from 'next/script';
import { useCallback, useEffect, useState } from 'react';

type TelegramWebApp = {
  initData?: string;
  platform?: string;
  version?: string;
  colorScheme?: string;
  viewportHeight?: number;
  viewportStableHeight?: number;
  isExpanded?: boolean;
  ready?: () => void;
  expand?: () => void;
};

type TelegramDiagnostics = {
  windowType: string;
  telegramExists: boolean;
  webAppExists: boolean;
  initDataState: string;
  platform: string;
  version: string;
  colorScheme: string;
  viewportHeight: string;
  viewportStableHeight: string;
  isExpanded: string;
};

type TelegramWindow = Window &
  typeof globalThis & {
    Telegram?: {
      WebApp?: TelegramWebApp;
    };
  };

function getDiagnostics(): TelegramDiagnostics {
  const isBrowser = typeof window !== 'undefined';
  const telegramWindow = isBrowser ? (window as TelegramWindow) : undefined;
  const webApp = telegramWindow?.Telegram?.WebApp;
  const initData = webApp?.initData ?? '';
  return {
    windowType: typeof window,
    telegramExists: Boolean(telegramWindow?.Telegram),
    webAppExists: Boolean(webApp),
    initDataState: initData.length > 0 ? `yes (${initData.length})` : 'no (0)',
    platform: webApp?.platform ?? '—',
    version: webApp?.version ?? '—',
    colorScheme: webApp?.colorScheme ?? '—',
    viewportHeight: typeof webApp?.viewportHeight === 'number' ? `${webApp.viewportHeight}` : '—',
    viewportStableHeight:
      typeof webApp?.viewportStableHeight === 'number' ? `${webApp.viewportStableHeight}` : '—',
    isExpanded: typeof webApp?.isExpanded === 'boolean' ? (webApp.isExpanded ? 'yes' : 'no') : '—'
  };
}

export default function DebugTelegramPage() {
  const [diagnostics, setDiagnostics] = useState<TelegramDiagnostics | null>(null);

  const refreshDiagnostics = useCallback(() => {
    setDiagnostics(getDiagnostics());
  }, []);

  const callReadyAndExpand = useCallback(() => {
    const telegramWindow = typeof window === 'undefined' ? undefined : (window as TelegramWindow);
    const webApp = telegramWindow?.Telegram?.WebApp;

    if (webApp) {
      webApp.ready?.();
      webApp.expand?.();
    }

    refreshDiagnostics();
  }, [refreshDiagnostics]);

  useEffect(() => {
    const animationFrameId = requestAnimationFrame(refreshDiagnostics);

    return () => cancelAnimationFrame(animationFrameId);
  }, [refreshDiagnostics]);

  return (
    <main className="debug-page">
      <Script
        src="https://telegram.org/js/telegram-web-app.js"
        strategy="afterInteractive"
        onLoad={refreshDiagnostics}
      />

      <section className="panel">
        <p className="eyebrow">Debug</p>
        <h1 className="title">Telegram WebApp diagnostics</h1>
        <p className="copy">
          Эта страница читает `window.Telegram.WebApp` напрямую, без нашего `useTelegram()`.
        </p>
      </section>

      <section className="panel">
        <div className="toolbar">
          <button type="button" className="button" onClick={refreshDiagnostics}>
            Refresh diagnostics
          </button>
          <button type="button" className="button button--secondary" onClick={callReadyAndExpand}>
            Call ready() and expand()
          </button>
        </div>

        {!diagnostics ? (
          <p className="status">Loading diagnostics...</p>
        ) : !diagnostics.webAppExists ? (
          <p className="status status--warning">Telegram WebApp API недоступен</p>
        ) : null}

        <dl className="grid" aria-label="Telegram diagnostics">
          <div className="item">
            <dt>typeof window</dt>
            <dd>{diagnostics?.windowType ?? '—'}</dd>
          </div>
          <div className="item">
            <dt>window.Telegram exists</dt>
            <dd>{diagnostics ? (diagnostics.telegramExists ? 'yes' : 'no') : '—'}</dd>
          </div>
          <div className="item">
            <dt>window.Telegram.WebApp exists</dt>
            <dd>{diagnostics ? (diagnostics.webAppExists ? 'yes' : 'no') : '—'}</dd>
          </div>
          <div className="item">
            <dt>initData</dt>
            <dd>{diagnostics?.initDataState ?? '—'}</dd>
          </div>
          <div className="item">
            <dt>platform</dt>
            <dd>{diagnostics?.platform ?? '—'}</dd>
          </div>
          <div className="item">
            <dt>version</dt>
            <dd>{diagnostics?.version ?? '—'}</dd>
          </div>
          <div className="item">
            <dt>colorScheme</dt>
            <dd>{diagnostics?.colorScheme ?? '—'}</dd>
          </div>
          <div className="item">
            <dt>viewportHeight</dt>
            <dd>{diagnostics?.viewportHeight ?? '—'}</dd>
          </div>
          <div className="item">
            <dt>viewportStableHeight</dt>
            <dd>{diagnostics?.viewportStableHeight ?? '—'}</dd>
          </div>
          <div className="item">
            <dt>isExpanded</dt>
            <dd>{diagnostics?.isExpanded ?? '—'}</dd>
          </div>
        </dl>
      </section>

      <style jsx>{`
        .debug-page {
          min-height: 100svh;
          padding: 24px 16px calc(24px + env(safe-area-inset-bottom));
          color: #f3f7fb;
          background:
            radial-gradient(circle at top, rgba(125, 211, 252, 0.2), transparent 28%),
            radial-gradient(circle at 80% 20%, rgba(134, 239, 172, 0.16), transparent 24%),
            linear-gradient(180deg, #08111c 0%, #050b13 100%);
        }

        .panel {
          width: min(100%, 720px);
          margin: 0 auto 16px;
          padding: 20px;
          border: 1px solid rgba(165, 196, 255, 0.16);
          border-radius: 24px;
          background: rgba(10, 18, 30, 0.9);
          box-shadow: 0 24px 70px rgba(0, 0, 0, 0.36);
          backdrop-filter: blur(18px);
        }

        .eyebrow {
          margin: 0;
          color: #7dd3fc;
          font-size: 0.72rem;
          font-weight: 700;
          letter-spacing: 0.14em;
          text-transform: uppercase;
        }

        .title {
          margin: 10px 0 8px;
          font-size: clamp(1.8rem, 6vw, 2.4rem);
          line-height: 1.05;
          letter-spacing: -0.05em;
        }

        .copy,
        .status,
        dt,
        dd {
          margin: 0;
          line-height: 1.5;
        }

        .copy,
        .status {
          color: #aebed4;
        }

        .toolbar {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          margin-bottom: 18px;
        }

        .button {
          min-height: 44px;
          padding: 0 16px;
          border: 1px solid rgba(125, 211, 252, 0.24);
          border-radius: 999px;
          background: rgba(12, 22, 36, 0.9);
          color: #f3f7fb;
          cursor: pointer;
        }

        .button--secondary {
          border-color: rgba(134, 239, 172, 0.24);
        }

        .button:active {
          transform: translateY(1px);
        }

        .status {
          margin-bottom: 16px;
          padding: 12px 14px;
          border-radius: 16px;
          background: rgba(12, 22, 36, 0.72);
        }

        .status--warning {
          color: #d8f7ff;
          border: 1px solid rgba(125, 211, 252, 0.16);
        }

        .grid {
          display: grid;
          gap: 12px;
        }

        .item {
          padding: 14px;
          border: 1px solid rgba(165, 196, 255, 0.1);
          border-radius: 18px;
          background: rgba(8, 15, 26, 0.76);
        }

        dt {
          color: #7dd3fc;
          font-size: 0.74rem;
          font-weight: 700;
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }

        dd {
          margin-top: 6px;
          font-size: 1rem;
          color: #f3f7fb;
          word-break: break-word;
        }
      `}</style>
    </main>
  );
}
