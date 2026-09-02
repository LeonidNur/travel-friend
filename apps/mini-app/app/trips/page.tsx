'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { useTelegramAuthSession } from '@/components/TelegramAuthBootstrapProvider';
import { createBackendApiClient, type TripListItemResponse } from '@/lib/backend-api-client';
import {
  formatTripDates,
  formatTripRoute,
  getPersistedTripStatusLabel,
  getTripListScreenState
} from '@/lib/trip-list-runtime';

const backendApiClient = createBackendApiClient();

export default function TripsPage() {
  const { session } = useTelegramAuthSession();
  const [trips, setTrips] = useState<TripListItemResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (session === null) {
      return;
    }

    let isCurrent = true;

    void backendApiClient.getTrips(session.accessToken).then(
      (nextTrips) => {
        if (isCurrent) {
          setTrips(nextTrips);
          setIsLoading(false);
        }
      },
      () => {
        if (isCurrent) {
          setError('Не удалось загрузить поездки. Попробуйте открыть экран ещё раз.');
          setIsLoading(false);
        }
      }
    );

    return () => {
      isCurrent = false;
    };
  }, [session]);

  const screenState = getTripListScreenState({ isLoading, error, trips });

  return (
    <section className="page">
      <article className="hero-card">
        <h2 className="hero-card__title">Поездки</h2>
      </article>

      {screenState === 'loading' ? (
        <article className="surface-card surface-card--compact empty-state-card" aria-live="polite">
          <p className="section-kicker">Загружаем поездки</p>
        </article>
      ) : null}

      {screenState === 'error' ? (
        <article className="surface-card surface-card--compact empty-state-card" role="alert">
          <p className="section-kicker">Не удалось загрузить поездки</p>
          <p className="surface-card__copy">{error}</p>
        </article>
      ) : null}

      {screenState === 'empty' ? (
        <article className="surface-card surface-card--compact empty-state-card">
          <p className="section-kicker">Поездок пока нет</p>
          <h2 className="empty-state-card__title">Здесь появятся ваши поездки</h2>
        </article>
      ) : null}

      {screenState === 'success' ? (
        <section className="list-stack" aria-label="Список поездок">
          {trips.map((trip) => <TripCard key={trip.trip_id} trip={trip} />)}
        </section>
      ) : null}
    </section>
  );
}

function TripCard({ trip }: Readonly<{ trip: TripListItemResponse }>) {
  const route = formatTripRoute(trip.route_place_labels);
  const dates = formatTripDates(trip.date_from, trip.date_to);

  return (
    <Link className="surface-card surface-card--compact trip-card trip-card--link" href={`/trips/${trip.trip_id}`}>
      <h2 className="trip-card__title">{route ?? 'Маршрут пока не указан'}</h2>
      <span className="chat-status trip-card__status">{getPersistedTripStatusLabel(trip.status)}</span>
      {dates !== null ? <p className="trip-card__meta">Даты: {dates}</p> : null}
    </Link>
  );
}
