import Link from 'next/link';

import type { TravelBuddy } from '@/lib/mock-buddies';

interface DiscoverSelectedListProps {
  buddies: readonly TravelBuddy[];
}

function getStatusCopy(buddy: TravelBuddy) {
  return buddy.likedYou
    ? {
        label: 'Мэтч',
        description: 'Мэтч — можно перейти к обсуждению поездки.',
        actionLabel: 'Перейти к чатам'
      }
    : {
        label: 'Интерес отправлен',
        description: 'Интерес отправлен — чат будет доступен после ответа.',
        actionLabel: 'Открыть чат-заготовку'
      };
}

export function DiscoverSelectedList({ buddies }: DiscoverSelectedListProps) {
  if (buddies.length === 0) {
    return (
      <article className="surface-card surface-card--compact empty-state-card">
        <p className="section-kicker">Discover complete</p>
        <h2 className="empty-state-card__title">Вы пока никого не выбрали</h2>
        <p className="surface-card__copy">
          Просмотр завершён. Позже можно будет вернуться к новым анкетам и заново отметить тех,
          кто подходит по формату поездки.
        </p>
      </article>
    );
  }

  return (
    <article className="surface-card selected-buddies-card">
      <p className="section-kicker">Discover complete</p>
      <h2 className="selected-buddies-card__title">Вы выбрали</h2>
      <p className="surface-card__copy">
        Здесь собраны все анкеты, где вы нажали “Подходит”. Это mock-итог без реального создания
        чатов.
      </p>

      <div className="selected-buddies-list" aria-label="Выбранные попутчики">
        {buddies.map((buddy) => {
          const status = getStatusCopy(buddy);

          return (
            <article className="selected-buddy-item" key={buddy.id}>
              <div className="selected-buddy-item__header">
                <div>
                  <h3 className="selected-buddy-item__name">{buddy.name}</h3>
                  <p className="selected-buddy-item__meta">
                    {buddy.city}, {buddy.age}
                  </p>
                </div>
                <span
                  className={`selected-buddy-item__status${buddy.likedYou ? ' selected-buddy-item__status--match' : ''}`}
                >
                  {status.label}
                </span>
              </div>

              <p className="selected-buddy-item__description">{status.description}</p>

              <Link className="profile-button profile-button--primary selected-buddy-item__action" href="/chats">
                {status.actionLabel}
              </Link>
            </article>
          );
        })}
      </div>
    </article>
  );
}
