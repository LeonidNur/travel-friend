import Link from 'next/link';

import { getChatById } from '@/lib/mock-chats';
import { getTrips } from '@/lib/mock-trips';
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

function getTripCardData(trip: Trip) {
  const participantNames = getChatById(trip.chatId)?.participants
    .map((participant) => participant.name)
    .join(', ');

  return {
    direction: getDirectionHeading(trip.categories.direction.summary),
    dates: getDatesValue(trip),
    participants: participantNames ?? 'Участники не найдены'
  };
}

export default function TripsPage() {
  const trips = getTrips();

  return (
    <section className="page">
      <article className="hero-card">
        <p className="section-kicker">Поездки</p>
        <h2 className="hero-card__title">Актуальное состояние поездок</h2>
        <p className="hero-card__copy">
          Каждая карточка показывает текущие договорённости и вопросы, которые ещё нужно решить.
        </p>
      </article>

      {trips.length === 0 ? (
        <article className="surface-card surface-card--compact empty-state-card">
          <p className="section-kicker">Поездок пока нет</p>
          <h2 className="empty-state-card__title">Здесь появятся ваши поездки</h2>
          <p className="surface-card__copy">
            Когда совместное планирование начнётся в чате, здесь будет его актуальная сводка.
          </p>
        </article>
      ) : (
        <section className="list-stack" aria-label="Список поездок">
          {trips.map((trip) => (
            <TripCard key={trip.id} trip={trip} />
          ))}
        </section>
      )}
    </section>
  );
}

function TripCard({ trip }: { trip: Trip }) {
  const { direction, dates, participants } = getTripCardData(trip);

  return (
    <Link className="surface-card surface-card--compact trip-card trip-card--link" href={`/trips/${trip.id}`}>
      <h2 className="trip-card__title">{direction}</h2>
      <p className="trip-card__meta">Даты: {dates}</p>
      <p className="trip-card__meta">Участники: {participants}</p>
    </Link>
  );
}
