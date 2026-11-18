import Link from 'next/link';

import type { TripListItemResponse } from '@/lib/backend-api-client';
import {
  formatTripDates,
  formatTripRoute,
  getPersistedTripStatusLabel,
  type TripListScreenState
} from '@/lib/trip-list-runtime';

import styles from './TripsList.module.css';

type TripsListProps = Readonly<{
  state: TripListScreenState;
  trips?: readonly TripListItemResponse[];
  onRetry?: () => void;
  onOpen?: (tripId: string) => void;
}>;

export function TripsList({ state, trips = [], onRetry, onOpen }: TripsListProps) {
  return (
    <section className={styles.page} aria-labelledby="trips-list-title">
      <h1 className={styles.heading} id="trips-list-title">Поездки</h1>

      {state === 'loading' && (
        <article className={styles.panel} role="status">
          <h2>Загружаем поездки</h2>
          <p>Проверяем ваши поездки…</p>
        </article>
      )}

      {state === 'error' && (
        <article className={styles.panel} data-state="error">
          <div className={styles.notice} role="alert">
            <h2>Не удалось загрузить поездки</h2>
            <p>Проверьте подключение и повторите попытку.</p>
          </div>
          {onRetry && <button className={styles.action} type="button" onClick={onRetry}>Повторить</button>}
        </article>
      )}

      {state === 'empty' && (
        <article className={styles.panel}>
          <h2>Поездок пока нет</h2>
          <p>Поездка начинается в чате. Откройте разговор с попутчиками и создайте общий план.</p>
          <Link className={styles.action} href="/chats">Перейти в чаты</Link>
        </article>
      )}

      {state === 'success' && (
        <>
          <p className={styles.subtitle}>Ваши будущие и созданные поездки</p>
          <ul className={styles.list} aria-label="Список поездок">
            {trips.map((trip) => (
              <li key={trip.trip_id}>
                <Link className={styles.card} href={`/trips/${trip.trip_id}`} onClick={onOpen ? (event) => {
                  event.preventDefault();
                  onOpen(trip.trip_id);
                } : undefined}>
                  <h2>{formatTripRoute(trip.route_place_labels) ?? 'Маршрут пока не указан'}</h2>
                  <span className={styles.status} data-status={trip.status}>
                    {getPersistedTripStatusLabel(trip.status)}
                  </span>
                  <p>{formatTripDates(trip.date_from, trip.date_to) ?? 'Даты не указаны'}</p>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
