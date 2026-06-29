'use client';

import { useTelegram } from '@/lib/telegram';

export function ProfileDiagnostics() {
  const telegram = useTelegram();
  const isLoading = !telegram.isReady;
  const initDataState = telegram.initDataLength > 0 ? `yes (${telegram.initDataLength})` : 'no (0)';

  return (
    <section className="surface-card surface-card--compact" aria-label="Telegram diagnostics">
      <p className="surface-card__title">Telegram diagnostics</p>

      {isLoading ? (
        <p className="surface-card__note">Loading Telegram data...</p>
      ) : !telegram.isTelegram ? (
        <p className="surface-card__note">Development mode (outside Telegram).</p>
      ) : null}

      <dl className="diagnostic-list">
        <div className="diagnostic-list__item">
          <dt className="diagnostic-list__label">Source</dt>
          <dd className="diagnostic-list__value">{isLoading ? '—' : telegram.source}</dd>
        </div>

        <div className="diagnostic-list__item">
          <dt className="diagnostic-list__label">window.Telegram exists</dt>
          <dd className="diagnostic-list__value">
            {isLoading ? '—' : telegram.telegramExists ? 'yes' : 'no'}
          </dd>
        </div>

        <div className="diagnostic-list__item">
          <dt className="diagnostic-list__label">window.Telegram.WebApp exists</dt>
          <dd className="diagnostic-list__value">
            {isLoading ? '—' : telegram.webAppExists ? 'yes' : 'no'}
          </dd>
        </div>

        <div className="diagnostic-list__item">
          <dt className="diagnostic-list__label">initData</dt>
          <dd className="diagnostic-list__value">{isLoading ? '—' : initDataState}</dd>
        </div>

        <div className="diagnostic-list__item">
          <dt className="diagnostic-list__label">Platform</dt>
          <dd className="diagnostic-list__value">{isLoading ? '—' : telegram.platform}</dd>
        </div>

        <div className="diagnostic-list__item">
          <dt className="diagnostic-list__label">Version</dt>
          <dd className="diagnostic-list__value">{isLoading ? '—' : telegram.version}</dd>
        </div>

        <div className="diagnostic-list__item">
          <dt className="diagnostic-list__label">Color scheme</dt>
          <dd className="diagnostic-list__value">{isLoading ? '—' : telegram.colorScheme}</dd>
        </div>

        <div className="diagnostic-list__item">
          <dt className="diagnostic-list__label">Viewport height</dt>
          <dd className="diagnostic-list__value">
            {isLoading ? '—' : `${telegram.viewportHeight}px`}
          </dd>
        </div>
      </dl>
    </section>
  );
}
