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
        <p className="section-kicker">Демо-режим</p>
        <span className="interest-banner__status">{buddyName}</span>
      </div>
      <h3 className="interest-banner__title">{isMatch ? 'Совпадение интереса' : 'Интерес отмечен'}</h3>
      <p className="surface-card__copy">
        {isMatch
          ? 'Демо-мэтч показан на основе заранее заданного интереса в демонстрационных данных. Реальный пользователь его не подтверждал, чат не создаётся.'
          : 'Интерес сохранён только в текущем сеансе и пока не отправляется другому пользователю.'}
      </p>
      {isMatch ? (
        <Link className="profile-button profile-button--primary interest-banner__action" href="/chats">
          Посмотреть примеры чатов
        </Link>
      ) : null}
    </article>
  );
}
