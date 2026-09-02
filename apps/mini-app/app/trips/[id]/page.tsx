'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';

import { useTelegramAuthSession } from '@/components/TelegramAuthBootstrapProvider';
import { ApiError, createBackendApiClient, type TripDetailResponse } from '@/lib/backend-api-client';
import {
  formatTripBudget,
  formatTripDetailDates,
  formatTripParticipants,
  formatTripRouteStops,
  getPersistedTripStatusLabel,
  getTripDetailScreenState
} from '@/lib/trip-detail-runtime';

interface TripDetailsPageProps {
  params: Promise<{
    id: string;
  }>;
}

const backendApiClient = createBackendApiClient();

export default function TripDetailsPage({ params }: TripDetailsPageProps) {
  const { id } = use(params);
  const { session } = useTelegramAuthSession();
  const [detail, setDetail] = useState<TripDetailResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);

  useEffect(() => {
    if (session === null) {
      return;
    }

    let isCurrent = true;

    void backendApiClient.getTrip(session.accessToken, id).then(
      (nextDetail) => {
        if (isCurrent) {
          setDetail(nextDetail);
          setIsLoading(false);
        }
      },
      (requestError: unknown) => {
        if (isCurrent) {
          setErrorStatus(requestError instanceof ApiError ? requestError.status : null);
          setError('Не удалось загрузить поездку. Попробуйте открыть экран ещё раз.');
          setIsLoading(false);
        }
      }
    );

    return () => {
      isCurrent = false;
    };
  }, [id, session]);

  const screenState = getTripDetailScreenState({
    isLoading,
    hasError: error !== null,
    errorStatus,
    detail
  });

  if (screenState === 'loading') {
    return <TripState title="Загружаем поездку" message={null} />;
  }

  if (screenState === 'not_found') {
    return (
      <section className="page">
        <article className="surface-card surface-card--compact empty-state-card">
          <p className="section-kicker">Поездка</p>
          <h2 className="empty-state-card__title">Поездка не найдена</h2>
          <Link className="profile-button profile-button--secondary" href="/trips">
            Вернуться к списку поездок
          </Link>
        </article>
      </section>
    );
  }

  if (screenState === 'error' || detail === null) {
    return <TripState title="Не удалось загрузить поездку" message={error} />;
  }

  const route = formatTripRouteStops(detail.route_stops);
  const participants = formatTripParticipants(detail.participants);
  const dates = formatTripDetailDates(detail.trip.date_from, detail.trip.date_to);
  const budget = formatTripBudget({
    min: detail.trip.budget_min,
    max: detail.trip.budget_max,
    currency: detail.trip.budget_currency,
    scope: detail.trip.budget_scope
  });

  return (
    <section className="page">
      <article className="surface-card trip-details-header">
        <Link className="navigation-link" href="/trips" aria-label="Вернуться к списку поездок">
          ← Назад
        </Link>
        <p className="section-kicker">Поездка</p>
        <h2 className="trip-details-header__title">{route ?? 'Маршрут пока не указан'}</h2>
        <div className="trip-details-header__meta">
          <p className="trip-details-header__participants">
            Участники: {participants.length > 0 ? participants.join(', ') : 'не указаны'}
          </p>
          <Link className="navigation-link" href={`/chats/${detail.trip.chat_id}`}>Перейти в чат</Link>
        </div>
      </article>

      <section className="trip-details" aria-label="План поездки">
        <TripDetailSection heading="Статус" value={getPersistedTripStatusLabel(detail.trip.status)} />
        <TripDetailSection heading="Маршрут" value={route ?? 'Маршрут пока не указан'} />
        {dates !== null ? <TripDetailSection heading="Даты" value={dates} /> : null}
        {budget !== null ? <TripDetailSection heading="Бюджет" value={budget} /> : null}
      </section>
    </section>
  );
}

function TripState({ title, message }: Readonly<{ title: string; message: string | null }>) {
  return (
    <section className="page">
      <article className="surface-card surface-card--compact empty-state-card" aria-live="polite">
        <p className="section-kicker">Поездка</p>
        <h2 className="empty-state-card__title">{title}</h2>
        {message !== null ? <p className="surface-card__copy">{message}</p> : null}
      </article>
    </section>
  );
}

function TripDetailSection({ heading, value }: Readonly<{ heading: string; value: string }>) {
  return (
    <article className="trip-details__section">
      <h3 className="trip-details__heading">{heading}</h3>
      <p className="trip-details__summary">{value}</p>
    </article>
  );
}
