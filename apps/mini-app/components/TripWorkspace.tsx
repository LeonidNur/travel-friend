'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { TripDraftEditor, type TripDraftEditorHandle, type TripDraftEditorProps } from '@/components/TripDraftEditor';
import { TripLogistics } from '@/components/TripLogistics';
import { TripDayCard, TripOverview, dayName } from '@/components/TripOverview';
import type { TripDetailResponse, TripDraftResponse, TripItineraryDayResponse } from '@/lib/backend-api-client';
import { formatRussianDate } from '@/lib/russian-date-format';
import { createConfirmedContent, formatTripDayCount, getTripOverviewData } from '@/lib/trip-detail-runtime';
import styles from './TripWorkspace.module.css';

export type TripView = Readonly<{ screen: 'overview' | 'program' | 'logistics' | 'draft' | 'alternatives' | 'proposals' }> |
  Readonly<{ screen: 'edit'; scope: string }>;

type Props = Readonly<{
  trip: TripDetailResponse;
  days: readonly TripItineraryDayResponse[];
  editor?: Omit<TripDraftEditorProps, 'trip' | 'confirmedDays' | 'navigation' | 'confirmedItineraryNotice' | 'isRefreshing' | 'ref' | 'onDraftSnapshot'>;
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

export function TripDetailStatus({ state, onRetry }: Readonly<{ state: 'loading' | 'error' | 'not_found'; onRetry?: () => void }>) {
  const loading = state === 'loading';
  const unavailable = state === 'not_found';
  return <section className={styles.stack} aria-label="Поездка">
    <h1>Поездка</h1>
    <article className={styles.card} data-error={!loading} role={loading ? 'status' : 'alert'}>
      <h2>{loading ? 'Загружаем поездку' : unavailable ? 'Поездка недоступна' : 'Не удалось загрузить поездку'}</h2>
      <p>{loading ? 'Запрашиваем согласованный план…' : unavailable ? 'Поездка не найдена или у вас нет доступа.' : 'Проверьте подключение. Можно повторить запрос.'}</p>
      {unavailable ? <Link className={styles.primary} href="/trips">К поездкам</Link> : null}
      {state === 'error' && onRetry ? <button className={styles.primary} type="button" onClick={onRetry}>Повторить</button> : null}
    </article>
  </section>;
}

export function TripWorkspace({ trip, days, editor, draftError, isDraftWaitingForItinerary, isRefreshing, itineraryState = 'loaded', onRetryDraft, onRetryItinerary, previewView, previewProposalId }: Props) {
  const viewport = useRef<HTMLDivElement>(null);
  const draftEditor = useRef<TripDraftEditorHandle>(null);
  const [latestDraft, setLatestDraft] = useState<Pick<TripDraftResponse, 'content' | 'version'> | null>(null);
  const initialDraft = editor?.draft;
  const persistedDraft = initialDraft && latestDraft && latestDraft.version >= initialDraft.version ? latestDraft : initialDraft;
  const overviewData = getTripOverviewData(trip.trip.status, itineraryState, createConfirmedContent(trip, days), persistedDraft);
  const [views, setViews] = useState<readonly TripView[]>(() => {
    if (previewView?.screen === 'edit') return [overview, { screen: 'program' }, previewView];
    return [previewView ?? overview];
  });
  const [focusedProposalId, setFocusedProposalId] = useState<string | null>(previewProposalId ?? null);
  const view = views.at(-1) ?? overview;
  const navigate = (next: TripView) => {
    setViews((history) => [...history, next]);
    viewport.current?.scrollTo({ top: 0 });
  };
  const back = () => {
    setViews((history) => history.length > 1 ? history.slice(0, -1) : [overview]);
    viewport.current?.scrollTo({ top: 0 });
  };
  const toProgram = () => {
    setViews([overview, { screen: 'program' }]);
    viewport.current?.scrollTo({ top: 0 });
  };
  const toOverview = () => {
    setViews([overview]);
    viewport.current?.scrollTo({ top: 0 });
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
  const editorVisible = focusedProposalId !== null || !['overview', 'program', 'logistics'].includes(view.screen);
  const previousScreen = views.at(-2)?.screen;
  const backLabel = previousScreen === 'logistics' ? 'К жилью и транспорту' : previousScreen === 'program' ? 'К программе' : undefined;
  return <div ref={viewport} className={styles.workspace}>
    <section className={styles.stack} hidden={editorVisible}>
      {view.screen === 'overview' ? <TripOverview trip={trip} days={days} itineraryState={itineraryState} data={overviewData}
        onLogistics={() => navigate({ screen: 'logistics' })}
        onEdit={edit} onFirstDay={() => draftEditor.current?.openFirstDay()} canAddFirstDay={Boolean(editor) && !isRefreshing}
        draftRecovery={!editor && draftError ? <article className={styles.card} data-error="true" role="alert">
          <h2>Черновик не загрузился</h2>
          <p>{itineraryState === 'loaded' ? 'Согласованная программа доступна. ' : ''}Повторите загрузку черновика.</p>
          {onRetryDraft ? <button className={styles.primary} type="button" onClick={onRetryDraft} disabled={isRefreshing}>Повторить</button> : null}
        </article> : null}
        onProgram={toProgram} onEditBudget={() => {
          setViews((history) => [...history, { screen: 'program' }, { screen: 'edit', scope: 'budget' }]);
          viewport.current?.scrollTo({ top: 0 });
        }}
        onProposals={() => navigate({ screen: 'proposals' })} /> : null}
      {view.screen === 'program' ? <TripProgram days={days} state={itineraryState} detailed={overviewData.mode === 'complex'} onRetry={onRetryItinerary}
        onEdit={edit} onBack={toOverview} /> : null}
      {view.screen === 'logistics' ? <TripLogistics trip={trip} onEdit={edit} onBack={toOverview} /> : null}
    </section>
    {editorVisible && !editor ? <section className={styles.stack}>
      <h1>Рабочая версия поездки</h1>
      <article className={styles.card} role={draftError ? 'alert' : 'status'}>
        <p>{draftError ?? 'Загружаем общий черновик…'}</p>
        {draftError ? <button className={styles.primary} onClick={onRetryDraft}>Повторить</button> : null}
      </article>
      <button className={styles.action} onClick={() => { setFocusedProposalId(null); back(); }}>{backLabel ?? 'Назад'}</button>
    </section> : null}
    {editor ? <div hidden={!editorVisible}>
      <TripDraftEditor {...editor} ref={draftEditor} trip={trip} confirmedDays={days} isRefreshing={isRefreshing}
        onDraftSnapshot={(content, version) => setLatestDraft((previous) => previous && previous.version > version ? previous : { content, version })}
        confirmedItineraryNotice={isDraftWaitingForItinerary ? {
          failed: itineraryState === 'error', onRetry: onRetryItinerary
        } : undefined} navigation={{
        view, navigate, back, toProgram, focusedProposalId,
        backLabel,
        openProposal: (id) => { setFocusedProposalId(id); viewport.current?.scrollTo({ top: 0 }); },
        closeProposal: () => {
          setFocusedProposalId(null);
          if (window.location.hash.startsWith('#proposal-')) {
            window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
          }
          viewport.current?.scrollTo({ top: 0 });
        }
      }} />
    </div> : null}
  </div>;
}

function TripProgram({ days, state, detailed, onRetry, onEdit, onBack }: Readonly<{
  days: readonly TripItineraryDayResponse[]; state: Props['itineraryState']; onRetry?: () => void; detailed: boolean;
  onEdit: (scope: string) => void; onBack: () => void;
}>) {
  return <>
    <h1>Программа{days.length ? ` · ${formatTripDayCount(days.length)}` : ''}</h1>
    <p className={styles.meta}>{detailed && days.every((day) => !day.day_date) ? 'Согласованная программа · даты не указаны' : 'Согласованная программа'}</p>
    {state !== 'loaded' || days.length === 0 ? <article className={styles.card} role={state === 'error' ? 'alert' : 'status'}>
      <p>{state === 'error' ? 'Не удалось загрузить согласованную программу.' : state === 'loading' ? 'Загружаем программу…' : 'Согласованных дней пока нет.'}</p>
      {state === 'error' ? <button className={styles.primary} onClick={onRetry}>Повторить</button> : null}
    </article> : null}
    {days.map((day, index) => detailed ? <TripDayCard key={day.id} day={day} index={index} onEdit={onEdit} /> : <article className={styles.card} key={day.id}>
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
    <button className={styles.secondaryLink} onClick={() => onEdit('itinerary:all')}>Изменить программу</button>
  </>;
}
