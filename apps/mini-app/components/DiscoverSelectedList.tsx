import Link from 'next/link';

import type { PositiveInterestDecision, SelectedDiscoverBuddy } from '@/lib/interest-decisions';

interface DiscoverSelectedListProps {
  selections: readonly SelectedDiscoverBuddy[];
}

function getStatusCopy(decision: PositiveInterestDecision) {
  return decision === 'match'
    ? {
        label: 'Демо-мэтч',
        description: 'Основан на заранее заданном интересе в демонстрационных данных. Реальный пользователь его не подтверждал, чат не создаётся.',
        actionLabel: 'Посмотреть примеры чатов'
      }
    : {
        label: 'Интерес отмечен',
        description: 'Интерес сохранён только в текущем сеансе и пока не отправляется другому пользователю.',
        actionLabel: 'Посмотреть примеры чатов'
      };
}

export function DiscoverSelectedList({ selections }: DiscoverSelectedListProps) {
  if (selections.length === 0) {
    return (
      <article className="surface-card surface-card--compact empty-state-card">
        <p className="section-kicker">Просмотр завершён</p>
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
      <p className="section-kicker">Итоги просмотра</p>
      <h2 className="selected-buddies-card__title">Вы выбрали</h2>
      <p className="surface-card__copy">
        Здесь собраны все анкеты, где вы нажали “Подходит”. В демо-режиме эти решения сохранены
        только в текущем сеансе: реальные чаты не создаются.
      </p>

      <div className="selected-buddies-list" aria-label="Выбранные попутчики">
        {selections.map(({ buddy, decision }) => {
          const status = getStatusCopy(decision);

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
                  className={`selected-buddy-item__status${decision === 'match' ? ' selected-buddy-item__status--match' : ''}`}
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
