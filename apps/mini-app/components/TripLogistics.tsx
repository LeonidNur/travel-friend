import type { TripDetailResponse } from '@/lib/backend-api-client';
import { getTripLogistics } from '@/lib/trip-logistics';
import styles from './TripWorkspace.module.css';

type Item = ReturnType<typeof getTripLogistics>['accommodations'][number];

export function TripLogistics({ trip, onEdit, onBack }: Readonly<{
  trip: Pick<TripDetailResponse, 'accommodations' | 'transport'>;
  onEdit: (scope: 'accommodation' | 'transport') => void;
  onBack: () => void;
}>) {
  const { accommodations, transport } = getTripLogistics(trip);
  return <>
    <h1>Жильё и транспорт</h1>
    <p className={styles.meta}>Согласованные данные поездки</p>
    <article className={styles.card}>
      <h2>Проживание · весь раздел</h2>
      <LogisticsList items={accommodations} empty="Согласованное проживание не указано." />
      {accommodations.length > 0 ? <p>
        {accommodations.every((item) => !item.timing) ? <>Даты заезда и выезда не указаны.<br /></> : null}
        Согласовано ≠ забронировано.
      </p> : null}
      <button className={styles.action} type="button" onClick={() => onEdit('accommodation')}>Изменить проживание</button>
    </article>
    <article className={styles.card}>
      <h2>Транспорт · весь раздел</h2>
      <LogisticsList items={transport} empty="Согласованный транспорт не указан." />
      {transport.length > 0 && transport.every((item) => !item.timing) ? <p>Время отправления и прибытия не указано.</p> : null}
      <button className={styles.action} type="button" onClick={() => onEdit('transport')}>Изменить транспорт</button>
    </article>
    <article className={styles.card}>
      <h2>Нет точной привязки к дню</h2>
      <p>Жильё и транспорт показаны общим списком.</p>
    </article>
    <button className={styles.action} type="button" onClick={onBack}>К обзору поездки</button>
  </>;
}

function LogisticsList({ items, empty }: Readonly<{ items: readonly Item[]; empty: string }>) {
  if (items.length === 0) return <p>{empty}</p>;
  return <ul className={styles.logisticsList}>
    {items.map((item) => <li key={item.id} data-details={Boolean(item.timing || item.notes)}>
      {item.label}
      {item.timing ? <p className={styles.meta}>{item.timing}</p> : null}
      {item.notes ? <p className={styles.meta}>{item.notes}</p> : null}
    </li>)}
  </ul>;
}
