'use client';

import Link from 'next/link';
import { use } from 'react';

import { useCurrentUserProfile } from '@/components/CurrentUserProfileProvider';
import { useTripSession } from '@/components/InterestDecisionProvider';
import { getDisplayedChatParticipant } from '@/lib/current-user-chat-participant';
import { formatChatParticipantLabel } from '@/lib/chat-participant-label';
import { getChatById } from '@/lib/mock-chats';
import type { CurrentUserProfile } from '@/lib/mock-current-user';
import { TRIP_CATEGORY_ORDER } from '@/lib/types';
import type { TripCategoryId, TripCategoryStatus } from '@/lib/types';

interface TripDetailsPageProps {
  params: Promise<{
    id: string;
  }>;
}

const TRIP_CATEGORY_LABELS: Record<TripCategoryId, string> = {
  direction: 'Направление',
  dates: 'Даты',
  budget: 'Бюджет',
  transport: 'Транспорт',
  accommodation: 'Жильё',
  activities: 'Активности',
  notes: 'Заметки'
};

const TRIP_CATEGORY_STATUS_LABELS: Record<TripCategoryStatus, string> = {
  confirmed: 'Согласовано',
  needs_decision: 'Требует решения',
  empty: 'Не обсуждалось'
};

function getParticipantsLabel(chatId: string, currentUserProfile: CurrentUserProfile) {
  const participantNames = getChatById(chatId)?.participants
    .map((participant) =>
      formatChatParticipantLabel(getDisplayedChatParticipant(participant, currentUserProfile))
    )
    .join(', ');

  return participantNames || 'Участники не найдены';
}

export default function TripDetailsPage({ params }: TripDetailsPageProps) {
  const { id } = use(params);
  const { getTrip } = useTripSession();
  const { profile } = useCurrentUserProfile();
  const trip = getTrip(id);

  if (!trip) {
    return (
      <section className="page">
        <article className="surface-card surface-card--compact empty-state-card">
          <p className="section-kicker">Поездка</p>
          <h2 className="empty-state-card__title">Поездка не найдена</h2>
          <p className="surface-card__copy">
            Возможно, этой поездки нет в текущем наборе демонстрационных данных или ссылка устарела.
          </p>
          <Link className="profile-button profile-button--secondary" href="/trips">
            Вернуться к списку поездок
          </Link>
        </article>
      </section>
    );
  }

  const chat = getChatById(trip.chatId);
  const participants = getParticipantsLabel(trip.chatId, profile);

  return (
    <section className="page">
      <article className="surface-card trip-details-header">
        <Link className="navigation-link" href="/trips" aria-label="Вернуться к списку поездок">
          ← Назад
        </Link>
        <p className="section-kicker">Поездка</p>
        <h2 className="trip-details-header__title">План поездки</h2>
        <p className="surface-card__copy">
          План поездки показан для проверки сценария. Статусы категорий не синхронизируются и не
          подтверждаются другими участниками.
        </p>
        <div className="trip-details-header__meta">
          <p className="trip-details-header__participants">Участники: {participants}</p>
          {chat ? (
            <Link className="navigation-link" href={`/chats/${trip.chatId}`}>
              Перейти в чат
            </Link>
          ) : null}
        </div>
      </article>

      <section className="trip-details" aria-label="План поездки">
        {TRIP_CATEGORY_ORDER.map((categoryId) => {
          const category = trip.categories[categoryId];
          const summary = category.status === 'empty' ? 'Пока не обсуждалось.' : category.summary;

          return (
            <article className="trip-details__section" data-status={category.status} key={categoryId}>
              <h3 className="trip-details__heading">{TRIP_CATEGORY_LABELS[categoryId]}</h3>
              <span className="trip-details__status">{TRIP_CATEGORY_STATUS_LABELS[category.status]}</span>
              <p className="trip-details__summary">{summary}</p>
            </article>
          );
        })}
      </section>
    </section>
  );
}
