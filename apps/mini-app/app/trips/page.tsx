'use client';

import Link from 'next/link';

import { useCurrentUserProfile } from '@/components/CurrentUserProfileProvider';
import { useTripSession } from '@/components/InterestDecisionProvider';
import { getDisplayedChatParticipant } from '@/lib/current-user-chat-participant';
import { getChatById } from '@/lib/mock-chats';
import type { CurrentUserProfile } from '@/lib/mock-current-user';
import { getTripStatusLabel } from '@/lib/trip-status';
import type { Trip } from '@/lib/types';

function getDatesValue(trip: Trip) {
  const dates = trip.categories.dates;

  if (dates.status === 'confirmed') {
    return dates.summary;
  }

  return dates.status === 'needs_decision' ? 'Требуют решения' : 'Не обсуждались';
}

function getDirectionHeading(summary: string) {
  return summary.replace(/[.!?]+$/, '');
}

function getTripCardData(trip: Trip, currentUserProfile: CurrentUserProfile) {
  const participantNames = getChatById(trip.chatId)?.participants
    .map((participant) => getDisplayedChatParticipant(participant, currentUserProfile).name)
    .join(', ');

  return {
    direction: getDirectionHeading(trip.categories.direction.summary),
    dates: getDatesValue(trip),
    participants: participantNames ?? 'Участники не найдены'
  };
}

export default function TripsPage() {
  const { trips } = useTripSession();
  const { profile } = useCurrentUserProfile();

  return (
    <section className="page">
      <article className="hero-card">
        <p className="section-kicker">Поездки</p>
        <h2 className="hero-card__title">Актуальное состояние поездок</h2>
        <p className="hero-card__copy">
          Данные поездок демонстрационные. Созданные здесь поездки доступны только в этой демо-сессии и
          исчезнут после перезагрузки. Статусы категорий показывают предполагаемый сценарий планирования
          и пока не подтверждаются другими участниками.
        </p>
      </article>

      {trips.length === 0 ? (
        <article className="surface-card surface-card--compact empty-state-card">
          <p className="section-kicker">Поездок пока нет</p>
          <h2 className="empty-state-card__title">Здесь появятся ваши поездки</h2>
          <p className="surface-card__copy">
            Здесь будет показана демонстрационная сводка по плану поездки.
          </p>
        </article>
      ) : (
        <section className="list-stack" aria-label="Список поездок">
          {trips.map((trip) => (
            <TripCard currentUserProfile={profile} key={trip.id} trip={trip} />
          ))}
        </section>
      )}
    </section>
  );
}

function TripCard({
  currentUserProfile,
  trip
}: {
  currentUserProfile: CurrentUserProfile;
  trip: Trip;
}) {
  const { direction, dates, participants } = getTripCardData(trip, currentUserProfile);

  return (
    <Link className="surface-card surface-card--compact trip-card trip-card--link" href={`/trips/${trip.id}`}>
      <h2 className="trip-card__title">{direction}</h2>
      <span className="chat-status trip-card__status">{getTripStatusLabel(trip.status)}</span>
      <p className="trip-card__meta">Даты: {dates}</p>
      <p className="trip-card__meta">Участники: {participants}</p>
    </Link>
  );
}
