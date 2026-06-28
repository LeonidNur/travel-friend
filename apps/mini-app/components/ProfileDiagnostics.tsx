'use client';

import { useTelegram } from '@/lib/telegram';

export function ProfileDiagnostics() {
  const telegram = useTelegram();

  return (
    <section className="surface-card surface-card--compact" aria-label="Telegram diagnostics">
      <p className="surface-card__title">Telegram diagnostics</p>

      {!telegram.isTelegram ? (
        <p className="surface-card__note">Development mode (outside Telegram).</p>
      ) : null}

      <dl className="diagnostic-list">
        <div className="diagnostic-list__item">
          <dt className="diagnostic-list__label">Is Telegram</dt>
          <dd className="diagnostic-list__value">{telegram.isTelegram ? 'yes' : 'no'}</dd>
        </div>

        <div className="diagnostic-list__item">
          <dt className="diagnostic-list__label">Platform</dt>
          <dd className="diagnostic-list__value">{telegram.platform}</dd>
        </div>

        <div className="diagnostic-list__item">
          <dt className="diagnostic-list__label">Version</dt>
          <dd className="diagnostic-list__value">{telegram.version}</dd>
        </div>

        <div className="diagnostic-list__item">
          <dt className="diagnostic-list__label">Color scheme</dt>
          <dd className="diagnostic-list__value">{telegram.colorScheme}</dd>
        </div>

        <div className="diagnostic-list__item">
          <dt className="diagnostic-list__label">Viewport height</dt>
          <dd className="diagnostic-list__value">{telegram.viewportHeight}px</dd>
        </div>
      </dl>
    </section>
  );
}
