import Link from 'next/link';

import type { InterestDecision } from '@/lib/types';

interface InterestOutcomeBannerProps {
  buddyName: string;
  variant: Exclude<InterestDecision, 'rejected'>;
}

export function InterestOutcomeBanner({ buddyName, variant }: InterestOutcomeBannerProps) {
  const isMatch = variant === 'match';

  return (
    <article className="surface-card surface-card--compact surface-card--wide interest-banner">
      <div className="interest-banner__header">
        <p className="section-kicker">{isMatch ? 'Mock match' : 'Mock interest'}</p>
        <span className="interest-banner__status">{buddyName}</span>
      </div>
      <h3 className="interest-banner__title">{isMatch ? 'У вас мэтч' : 'Интерес отправлен'}</h3>
      <p className="surface-card__copy">
        {isMatch
          ? 'Мэтч — можно перейти к обсуждению поездки.'
          : 'Интерес отправлен — чат будет доступен после ответа.'}
      </p>
      {isMatch ? (
        <Link className="profile-button profile-button--primary interest-banner__action" href="/chats">
          Перейти к чатам
        </Link>
      ) : null}
    </article>
  );
}
