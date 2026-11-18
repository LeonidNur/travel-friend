'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { TripDraftEditor, type TripDraftEditorProps } from '@/components/TripDraftEditor';
import type { TripDetailResponse, TripItineraryDayResponse } from '@/lib/backend-api-client';
import { formatRussianDate } from '@/lib/russian-date-format';
import { formatTripBudget, formatTripDetailDates, formatTripParticipants, formatTripRouteStops, getPersistedTripStatusLabel, formatTripDayCount } from '@/lib/trip-detail-runtime';
import styles from './TripWorkspace.module.css';

export type TripView = Readonly<{ screen: 'overview' | 'program' | 'draft' | 'alternatives' | 'proposals' }> |
  Readonly<{ screen: 'edit'; scope: string }>;

type Props = Readonly<{
  trip: TripDetailResponse;
  days: readonly TripItineraryDayResponse[];
  editor?: Omit<TripDraftEditorProps, 'trip' | 'confirmedDays' | 'navigation' | 'confirmedItineraryNotice' | 'isRefreshing'>;
  draftError?: string | null;
  isDraftWaitingForItinerary?: boolean;
  isRefreshing?: boolean;
  itineraryState?: 'loaded' | 'loading' | 'error';
  onRetryDraft?: () => void;
  onRetryItinerary?: () => void;
  previewView?: TripView;
  previewProposalId?: string;
}>;

const overview: TripView = { screen: 'overview' };

export function TripWorkspace({ trip, days, editor, draftError, isDraftWaitingForItinerary, isRefreshing, itineraryState = 'loaded', onRetryDraft, onRetryItinerary, previewView, previewProposalId }: Props) {
  const [views, setViews] = useState<readonly TripView[]>([previewView ?? overview]);
  const [focusedProposalId, setFocusedProposalId] = useState<string | null>(previewProposalId ?? null);
  const view = views.at(-1) ?? overview;
  const navigate = (next: TripView) => {
    setViews((history) => [...history, next]);
    window.scrollTo({ top: 0 });
  };
  const back = () => {
    setViews((history) => history.length > 1 ? history.slice(0, -1) : [overview]);
    window.scrollTo({ top: 0 });
  };

  useEffect(() => {
    const openLinkedProposal = () => {
      const hash = window.location.hash;
      if (hash.startsWith('#proposal-') && hash.length > '#proposal-'.length) {
        setFocusedProposalId(hash.slice('#proposal-'.length));
      }
    };
    openLinkedProposal();
    window.addEventListener('hashchange', openLinkedProposal);
    return () => window.removeEventListener('hashchange', openLinkedProposal);
  }, []);

  const edit = (scope: string) => navigate({ screen: 'edit', scope });
  const editorVisible = focusedProposalId !== null || (view.screen !== 'overview' && view.screen !== 'program');
  return <div className={styles.workspace}>
    <section className={styles.stack} hidden={editorVisible}>
      {view.screen === 'overview' ? <TripOverview trip={trip} days={days} itineraryState={itineraryState}
        onProgram={() => navigate({ screen: 'program' })} onEdit={edit}
        onDraft={() => navigate({ screen: 'draft' })} onAlternatives={() => navigate({ screen: 'alternatives' })}
        onProposals={() => navigate({ screen: 'proposals' })} /> : null}
      {view.screen === 'program' ? <TripProgram days={days} state={itineraryState} onRetry={onRetryItinerary}
        onEdit={edit} onBack={back} /> : null}
    </section>
    {editorVisible && !editor ? <section className={styles.stack}>
      <h1>Рабочая версия поездки</h1>
      <article className={styles.card} role={draftError ? 'alert' : 'status'}>
        <p>{draftError ?? 'Загружаем общий черновик…'}</p>
        {draftError ? <button className={styles.primary} onClick={onRetryDraft}>Повторить</button> : null}
      </article>
      <button className={styles.action} onClick={() => { setFocusedProposalId(null); back(); }}>Назад</button>
    </section> : null}
    {editor ? <div hidden={!editorVisible}>
      <TripDraftEditor {...editor} trip={trip} confirmedDays={days} isRefreshing={isRefreshing}
        confirmedItineraryNotice={isDraftWaitingForItinerary ? {
          failed: itineraryState === 'error', onRetry: onRetryItinerary
        } : undefined} navigation={{
        view, navigate, back, focusedProposalId,
        backLabel: views.at(-2)?.screen === 'program' ? 'К программе' : undefined,
        openProposal: (id) => { setFocusedProposalId(id); window.scrollTo({ top: 0 }); },
        closeProposal: () => {
          setFocusedProposalId(null);
          if (window.location.hash.startsWith('#proposal-')) {
            window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
          }
          window.scrollTo({ top: 0 });
        }
      }} />
    </div> : null}
  </div>;
}

function TripOverview({ trip, days, itineraryState, onProgram, onEdit, onDraft, onAlternatives, onProposals }: Readonly<{
  trip: TripDetailResponse; days: readonly TripItineraryDayResponse[]; itineraryState: Props['itineraryState'];
  onProgram: () => void; onEdit: (scope: string) => void; onDraft: () => void; onAlternatives: () => void; onProposals: () => void;
}>) {
  const route = formatTripRouteStops(trip.route_stops);
  const dates = formatTripDetailDates(trip.trip.date_from, trip.trip.date_to);
  const budget = formatTripBudget({ min: trip.trip.budget_min, max: trip.trip.budget_max, currency: trip.trip.budget_currency, scope: trip.trip.budget_scope });
  const status = getPersistedTripStatusLabel(trip.trip.status);
  const participants = formatTripParticipants(trip.participants);
  return <>
    <h1>Поездка</h1>
    <article className={styles.card}>
      <h2>{route ?? 'Маршрут не указан'}</h2>
      <p>{[new Intl.ListFormat('ru').format(participants), status].filter(Boolean).join(' · ')}</p>
      <p className={styles.meta}>{[days.length ? formatTripDayCount(days.length) : null, dates ?? 'Даты не указаны'].filter(Boolean).join(' · ')}</p>
      <Link className={styles.action} href={`/chats/${trip.trip.chat_id}`}>Перейти в чат</Link>
    </article>
    <article className={styles.card}>
      <h2>Согласованный план</h2>
      <p>Маршрут: {route ?? 'не указан'}<br />Даты: {dates ?? 'не указаны'}<br />Бюджет: {budget ?? 'не заполнен'}</p>
    </article>
    <article className={styles.card}>
      <h2>Программа{days.length ? ` · ${formatTripDayCount(days.length)}` : ''}</h2>
      {itineraryState === 'loading' ? <p>Загружаем программу…</p> : null}
      {itineraryState === 'error' ? <p>Не удалось загрузить программу.</p> : null}
      {itineraryState === 'loaded' && days.length === 0 ? <p>Согласованных дней пока нет.</p> : null}
      {days.length > 0 ? <div>{days.slice(0, 3).map((day, index) => {
        const firstActivity = day.events.find((event) => event.kind === 'activity');
        return <p key={day.id}>{dayName(day, index)}{index === 0 && firstActivity ? <><br />{firstActivity.title}{firstActivity.start_time ? '' : ' · время не указано'}</> : null}</p>;
      })}</div> : null}
      <button className={styles.primary} onClick={onProgram}>Открыть программу</button>
    </article>
    <button className={styles.action} onClick={() => onEdit('budget')}>Изменить бюджет</button>
    <Link className={styles.action} href="/trips">К поездкам</Link>
    <button className={styles.action} onClick={onDraft}>Общий черновик</button>
    <button className={styles.action} onClick={onAlternatives}>Сохранённые варианты</button>
    <button className={styles.action} onClick={onProposals}>Предложения</button>
  </>;
}

function TripProgram({ days, state, onRetry, onEdit, onBack }: Readonly<{
  days: readonly TripItineraryDayResponse[]; state: Props['itineraryState']; onRetry?: () => void;
  onEdit: (scope: string) => void; onBack: () => void;
}>) {
  return <>
    <h1>Программа{days.length ? ` · ${formatTripDayCount(days.length)}` : ''}</h1>
    <p className={styles.meta}>Согласованная программа</p>
    {state !== 'loaded' || days.length === 0 ? <article className={styles.card} role={state === 'error' ? 'alert' : 'status'}>
      <p>{state === 'error' ? 'Не удалось загрузить согласованную программу.' : state === 'loading' ? 'Загружаем программу…' : 'Согласованных дней пока нет.'}</p>
      {state === 'error' ? <button className={styles.primary} onClick={onRetry}>Повторить</button> : null}
    </article> : null}
    {days.map((day, index) => <article className={styles.card} key={day.id}>
      <h2>{dayName(day, index)}</h2>
      {day.day_date ? <p className={styles.meta}>{formatRussianDate(day.day_date)}</p> : null}
      {day.notes ? <p>{day.notes}</p> : null}
      {day.events.length === 0 ? <p>Событий пока нет. День можно оставить свободным.</p> : day.events.map((event) => <div className={styles.event} key={event.id}>
        <p>{event.start_time ? `${event.start_time.slice(0, 5)} · ` : ''}{event.title}{!event.start_time && !event.notes ? ' · без времени' : ''}</p>
        {event.notes ? <p>{!event.start_time ? 'Время не указано. ' : ''}{event.notes}</p> : null}
      </div>)}
      {day.events.length === 1 ?
        <button className={styles.action} onClick={() => onEdit(`itinerary:event:${day.id}:${day.events[0].id}`)}>Изменить событие</button> :
        <button className={styles.action} onClick={() => onEdit(`itinerary:day:${day.id}`)}>Изменить день</button>}
    </article>)}
    <button className={styles.action} onClick={onBack}>К обзору поездки</button>
    <button className={styles.action} onClick={() => onEdit('itinerary:all')}>Изменить программу</button>
  </>;
}

function dayName(day: TripItineraryDayResponse, index: number): string {
  return `День ${index + 1}${day.title ? ` · ${day.title}` : ''}`;
}

