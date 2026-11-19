import Link from 'next/link';
import type { ReactNode } from 'react';

import type { TripDetailResponse, TripItineraryDayResponse } from '@/lib/backend-api-client';
import {
  formatTripBudget, formatTripDayCount, formatTripDetailDates, formatTripParticipants, formatTripRouteStops,
  getPersistedTripStatusLabel, type getTripOverviewData, type TripOverviewSection
} from '@/lib/trip-detail-runtime';
import { formatRussianDate } from '@/lib/russian-date-format';
import { formatEventKind } from '@/lib/trip-inline-editing';
import styles from './TripWorkspace.module.css';

type OverviewData = ReturnType<typeof getTripOverviewData>;
type Props = Readonly<{
  trip: TripDetailResponse;
  days: readonly TripItineraryDayResponse[];
  itineraryState: 'loaded' | 'loading' | 'error';
  data: OverviewData;
  draftRecovery: ReactNode;
  onEdit: (scope: string) => void;
  onFirstDay: () => void;
  canAddFirstDay: boolean;
  onProgram: () => void;
  onLogistics: () => void;
  onEditBudget: () => void;
  onProposals: () => void;
}>;

const countForms = new Intl.PluralRules('ru');
const lists = new Intl.ListFormat('ru');
const sectionLabels: Record<TripOverviewSection, string> = {
  route: 'Маршрут', dates: 'Даты', budget: 'Бюджет', accommodation: 'Проживание', transport: 'Транспорт'
};

export function TripOverview({ trip, days, itineraryState, data, draftRecovery, onEdit, onFirstDay, canAddFirstDay, onProgram, onLogistics, onEditBudget, onProposals }: Props) {
  const route = formatTripRouteStops(trip.route_stops);
  const dates = formatTripDetailDates(trip.trip.date_from, trip.trip.date_to);
  const budget = formatTripBudget({
    min: trip.trip.budget_min, max: trip.trip.budget_max, currency: trip.trip.budget_currency, scope: trip.trip.budget_scope
  });
  const status = getPersistedTripStatusLabel(trip.trip.status);
  const participants = formatTripParticipants(trip.participants);
  const chat = <Link className={styles.action} href={`/chats/${trip.trip.chat_id}`}>Перейти в чат</Link>;
  const back = <Link className={styles.action} href="/trips">К поездкам</Link>;
  const logistics = <button className={styles.action} type="button" onClick={onLogistics}>Жильё и транспорт</button>;
  const actions = <>
    <button className={styles.action} type="button" onClick={onEditBudget}>Изменить бюджет</button>
    <button className={styles.action} type="button" onClick={onProposals}>История предложений</button>
  </>;
  if (draftRecovery && itineraryState === 'loaded') return <>
    <h1>Поездка</h1>
    <article className={styles.card}>
      <h2>Согласованный план</h2>
      <p>{route ?? 'Маршрут не указан'}<br />{!dates && !budget ? 'Даты и бюджет не указаны' : <>
        {dates ?? 'Даты не указаны'}<br />{budget ?? 'Бюджет не заполнен'}
      </>}</p>
    </article>
    {draftRecovery}
    {days.map((day, index) => <TripDayCard day={day} index={index} key={day.id} />)}
    <details className={styles.moreActions}>
      <summary>Другие действия с поездкой</summary>
      <div>
        <button className={styles.primary} type="button" onClick={onProgram}>Открыть программу</button>
        {chat}
        {logistics}
        {actions}
        {back}
      </div>
    </details>
  </>;

  if (data.mode === 'new') return <>
    <h1>Новая поездка</h1>
    <article className={styles.card}>
      <h2>{status}</h2>
      <p>{participants.length ? lists.format(participants) : 'Участники не указаны'}<br />Маршрут и даты пока не указаны.</p>
      {chat}
    </article>
    <article className={styles.card}>
      <h2>Соберите программу вместе</h2>
      <p>Начните с маршрута или первого дня. Каждое изменение участники согласуют голосованием.</p>
    </article>
    <button className={styles.primary} type="button" onClick={() => onEdit('route')}>Предложить маршрут</button>
    <button className={styles.action} type="button" onClick={onFirstDay} disabled={!canAddFirstDay}>Добавить первый день</button>
    <article className={styles.card}><h2>Бюджет · проживание · транспорт</h2><p>Пока не заполнены</p></article>
    {back}
    <details className={styles.moreActions}>
      <summary>Другие действия с поездкой</summary>
      <div>
        <button className={styles.action} type="button" onClick={onProgram}>Открыть программу</button>
        {logistics}
        {actions}
      </div>
    </details>
  </>;

  if (data.mode === 'partial') {
    const summary = [
      route ? 'маршрут' : '', days.length === 1 ? 'день 1' : days.length > 1 ? `дни 1–${days.length}` : '',
      dates ? 'даты' : '', budget ? 'бюджет' : ''
    ].filter(Boolean);
    const confirmedSummary = lists.format(summary);
    return <>
      <h1>Поездка</h1>
      <article className={styles.card}>
        <h2>{route ?? 'Маршрут не указан'}</h2>
        <p>{status}<br />{!dates && !budget ? 'Даты и бюджет не указаны.' : <>
          {dates ?? 'Даты не указаны'}<br />{budget ?? 'Бюджет не заполнен'}
        </>}</p>
      </article>
      <article className={styles.card}>
        <h2>Согласовано</h2>
        <p>{confirmedSummary ? confirmedSummary[0].toLocaleUpperCase('ru') + confirmedSummary.slice(1) : 'В согласованном плане пока нет изменений.'}</p>
      </article>
      {days.map((day, index) => <article className={styles.card} key={day.id}>
        <h2>{dayName(day, index)}</h2>
        {day.day_date ? <p className={styles.meta}>{formatRussianDate(day.day_date)}</p> : null}
        {day.events.length > 0 ? <p className={styles.daySummary}>{day.events.map((event) =>
          [event.title, event.start_time?.slice(0, 5) ?? 'время не указано'].join(' · ')
        ).join('\n')}</p> : <p>Событий пока нет. День свободен.</p>}
        <button className={styles.action} type="button" onClick={() => onEdit(`itinerary:day:${day.id}`)}>Изменить день</button>
      </article>)}
      <DraftChanges data={data} onEdit={onEdit} />
      <LogisticsSummary trip={trip} onOpen={onLogistics} />
      <button className={styles.primary} type="button" onClick={onProgram}>Открыть программу</button>
      {chat}
      {actions}
      {back}
    </>;
  }

  if (data.mode === 'complex') return <>
    <h1>Поездка</h1>
    <article className={styles.card}>
      <h2 className={styles.routeTitle}>{route ?? 'Маршрут не указан'}</h2>
      <p>{formatTripDayCount(days.length)} · {dates ?? 'даты не указаны'}<br />
        {[participants.join(', '), status].filter(Boolean).join(' · ')}</p>
      {chat}
    </article>
    <article className={styles.card}>
      <h2>Согласованный план</h2>
      <p>{route ? `${formatCount(trip.route_stops.length, ['направление', 'направления', 'направлений'])} · ` : ''}{formatTripDayCount(days.length)}
        <br />{budget ?? 'Бюджет не заполнен'}</p>
    </article>
    {draftRecovery}
    <article className={styles.card}>
      <h2>Программа по дням</h2>
      <ul className={styles.dayRanges} aria-label="Дни по направлениям">
        {data.ranges.map(({ first, last, place }) => <li key={first}>
          {first === last ? first : `${first}–${last}`} · {place ?? 'место не указано'}
        </li>)}
      </ul>
      <button className={styles.primary} type="button" onClick={onProgram}>Открыть {formatTripDayCount(days.length)}</button>
    </article>
    <LogisticsSummary trip={trip} onOpen={onLogistics} />
    <DraftChanges data={data} onEdit={onEdit} />
    {actions}
    {back}
  </>;

  return <>
    <h1>Поездка</h1>
    <article className={styles.card}>
      <h2>{route ?? 'Маршрут не указан'}</h2>
      <p>{[lists.format(participants), status].filter(Boolean).join(' · ')}</p>
      <p className={styles.meta}>{[days.length ? formatTripDayCount(days.length) : null, dates ?? 'Даты не указаны'].filter(Boolean).join(' · ')}</p>
      {chat}
    </article>
    <article className={styles.card}>
      <h2>Согласованный план</h2>
      <p>Маршрут: {route ?? 'не указан'}<br />Даты: {dates ?? 'не указаны'}<br />Бюджет: {budget ?? 'не заполнен'}</p>
    </article>
    {draftRecovery}
    <article className={styles.card}>
      <h2>Программа{days.length ? ` · ${formatTripDayCount(days.length)}` : ''}</h2>
      {itineraryState === 'loading' ? <p>Загружаем программу…</p> : null}
      {itineraryState === 'error' ? <p>Не удалось загрузить программу.</p> : null}
      {itineraryState === 'loaded' && days.length === 0 ? <p>Согласованных дней пока нет.</p> : null}
      {days.length > 0 ? <div>{days.map((day, index) => {
        const firstActivity = day.events.find((event) => event.kind === 'activity');
        return <p key={day.id}>{dayName(day, index)}{index === 0 && firstActivity ? <><br />{firstActivity.title}{firstActivity.start_time ? '' : ' · время не указано'}</> : null}</p>;
      })}</div> : null}
      <button className={styles.primary} type="button" onClick={onProgram}>Открыть программу</button>
    </article>
    <button className={styles.action} type="button" onClick={onEditBudget}>Изменить бюджет</button>
    {back}
    <button className={styles.action} type="button" onClick={onProposals}>История предложений</button>
    {logistics}
  </>;
}

function DraftChanges({ data, onEdit }: Readonly<{ data: OverviewData; onEdit: Props['onEdit'] }>) {
  return <>
    {data.changedSections.length ? <article className={styles.card}>
      <h2>В черновике</h2>
      <p>Эти изменения ещё не входят в согласованный план.</p>
      {data.changedSections.map((scope) => <button key={scope} className={styles.primary} type="button" onClick={() => onEdit(scope)}>
        Открыть раздел «{sectionLabels[scope]}»
      </button>)}
    </article> : null}
    {data.draftDays.map(({ day, number, existing }) => <article className={styles.card} key={day.id}>
      <h2>В черновике · День {number}</h2>
      {day.date ? <p className={styles.meta}>{formatRussianDate(day.date)}</p> : null}
      <p>{[day.title || (existing ? 'Изменение дня' : 'Новый день'), day.events.map((event) => event.title).filter(Boolean).join(', ') || 'событий пока нет'].join(' · ')}
        <br />Ещё не входит в согласованный план.</p>
      <button className={styles.primary} type="button" onClick={() => onEdit(`itinerary:day:${day.id}`)}>Предложить изменение дня</button>
    </article>)}
    {data.removedDayNumbers.length ? <article className={styles.card}>
      <h2>В черновике · удаление дней</h2>
      <p>Дни {data.removedDayNumbers.join(', ')} остаются в согласованном плане до принятия изменений.</p>
      <button className={styles.primary} type="button" onClick={() => onEdit('itinerary:all')}>Открыть черновик программы</button>
    </article> : null}
    {data.daysReordered ? <article className={styles.card}>
      <h2>В черновике · порядок дней</h2>
      <p>Предложенный порядок ещё не входит в согласованный план.</p>
      <button className={styles.primary} type="button" onClick={() => onEdit('itinerary:all')}>Проверить порядок дней</button>
    </article> : null}
  </>;
}

function LogisticsSummary({ trip, onOpen }: Readonly<{ trip: TripDetailResponse; onOpen: () => void }>) {
  const stays = trip.accommodations.length;
  const segments = trip.transport.length;
  const counts = [
    stays ? formatCount(stays, ['вариант проживания', 'варианта проживания', 'вариантов проживания']) : '',
    segments ? formatCount(segments, ['перемещение', 'перемещения', 'перемещений']) : ''
  ].filter(Boolean).join('\n');
  return <article className={styles.card}>
    <h2><button className={styles.logisticsHeading} type="button" onClick={onOpen} aria-label="Открыть жильё и транспорт">
      {counts ? 'Жильё и перемещения' : 'Проживание и транспорт'} <span aria-hidden="true">›</span>
    </button></h2>
    <p className={styles.daySummary}>{counts || 'Не указаны'}</p>
  </article>;
}

function formatCount(count: number, [one, few, many]: readonly [string, string, string]) {
  const form = countForms.select(count);
  return `${count} ${form === 'one' ? one : form === 'few' ? few : many}`;
}

export function dayName(day: Pick<TripItineraryDayResponse, 'title'>, index: number): string {
  const title = day.title?.trim();
  return `День ${index + 1}${title ? ` · ${title}` : ''}`;
}

export function TripDayCard({ day, index, onEdit }: Readonly<{
  day: TripItineraryDayResponse;
  index: number;
  onEdit?: (scope: string) => void;
}>) {
  return <article className={styles.card}>
    <h2>{dayName(day, index)}</h2>
    <p className={styles.meta}>{day.day_date ? formatRussianDate(day.day_date) : 'Дата не указана'}</p>
    {day.notes ? <p>{day.notes}</p> : null}
    {day.events.length === 0 ? <p>Событий пока нет. День свободен.</p> : day.events.map((event) => {
      const time = event.start_time?.slice(0, 5);
      const duration = event.duration_minutes !== null ? `${event.duration_minutes} мин.` : null;
      const timing = [time ? `${time} · ${formatEventKind(event.kind).toLocaleLowerCase('ru')}` : 'Время не указано', duration].filter(Boolean).join(' · ');
      const cost = formatTripBudget({ min: event.estimated_cost, max: null, currency: event.currency, scope: null });
      return <div className={styles.eventDetails} key={event.id}>
        <h3>{onEdit ? <button className={styles.eventLink} type="button" aria-label={`Изменить событие: ${event.title}`}
          title="Изменить событие" onClick={() => onEdit(`itinerary:event:${day.id}:${event.id}`)}>{event.title}</button> : event.title}</h3>
        <p className={styles.meta}>{timing}</p>
        {event.address || cost || onEdit ? <p>{[event.address, cost].filter(Boolean).join(' · ') || 'Адрес и расходы не указаны'}</p> : null}
        {event.notes ? <p>{event.notes}</p> : null}
      </div>;
    })}
    {!onEdit ? <p>Программа доступна для чтения</p> : null}
    <button className={styles.action} type="button" disabled={!onEdit} onClick={() => onEdit?.(`itinerary:day:${day.id}`)}>Изменить день</button>
  </article>;
}
