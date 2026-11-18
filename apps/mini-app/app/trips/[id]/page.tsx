'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';

import { useTelegramAuthSession } from '@/components/TelegramAuthBootstrapProvider';
import { ApiError, createBackendApiClient, type TripDetailResponse, type TripDraftDetailResponse, type TripItineraryResponse } from '@/lib/backend-api-client';
import { TripDraftEditor } from '@/components/TripDraftEditor';
import { formatTripBudget, formatTripDetailDates, formatTripParticipants, formatTripRouteStops, getPersistedTripStatusLabel, getTripDetailScreenState } from '@/lib/trip-detail-runtime';

interface TripDetailsPageProps {
  params: Promise<{
    id: string;
  }>;
}

const backendApiClient = createBackendApiClient();

export default function TripDetailsPage({ params }: TripDetailsPageProps) {
  const { id } = use(params);
  const { session } = useTelegramAuthSession();
  return <TripDetailsContent key={`${id}:${session?.userId ?? 'unauthenticated'}`} id={id} session={session} />;
}

type TripSession = ReturnType<typeof useTelegramAuthSession>['session'];

function TripDetailsContent({ id, session }: Readonly<{ id: string; session: TripSession }>) {
  const [detail, setDetail] = useState<TripDetailResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [draftDetail, setDraftDetail] = useState<TripDraftDetailResponse | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [draftReloadKey, setDraftReloadKey] = useState(0);
  const [itinerary, setItinerary] = useState<TripItineraryResponse | null>(null);
  const [itineraryError, setItineraryError] = useState<string | null>(null);
  const [itineraryReloadKey, setItineraryReloadKey] = useState(0);

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
  }, [id, reloadKey, session]);

  useEffect(() => {
    if (session === null) return;
    let isCurrent = true;
    void backendApiClient.getTripDraft(session.accessToken, id).then(
      (value) => { if (isCurrent) { setDraftDetail(value); setDraftError(null); } },
      () => { if (isCurrent) setDraftError('Не удалось загрузить общий черновик. Попробуйте ещё раз.'); }
    );
    return () => { isCurrent = false; };
  }, [draftReloadKey, id, session]);

  useEffect(() => {
    if (session === null) return;
    let isCurrent = true;
    void backendApiClient.getTripItinerary(session.accessToken, id).then(
      (value) => { if (isCurrent) { setItinerary(value); setItineraryError(null); } },
      () => { if (isCurrent) setItineraryError('Не удалось загрузить согласованную программу. Попробуйте ещё раз.'); }
    );
    return () => { isCurrent = false; };
  }, [id, itineraryReloadKey, session]);

  const screenState = getTripDetailScreenState({
    isLoading,
    hasError: error !== null,
    errorStatus,
    detail
  });
  const handleRetry = () => {
    setIsLoading(true);
    setError(null);
    setErrorStatus(null);
    setReloadKey((key) => key + 1);
  };

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
    return <TripState title="Не удалось загрузить поездку" message={error} onRetry={handleRetry} />;
  }

  const participants = formatTripParticipants(detail.participants);
  const route = formatTripRouteStops(detail.route_stops);
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
        <div className="trip-details-header__actions">
          <Link className="profile-button profile-button--secondary" href="/trips" aria-label="Вернуться к списку поездок">
            ← Назад
          </Link>
          <Link className="profile-button profile-button--secondary" href={`/chats/${detail.trip.chat_id}`}>Открыть чат</Link>
        </div>
        <p className="section-kicker">Поездка</p>
        <h1 className="trip-details-header__title">{route ?? getPersistedTripStatusLabel(detail.trip.status)}</h1>
        <span className="chat-status trip-card__status">{getPersistedTripStatusLabel(detail.trip.status)}</span>
        {dates !== null || budget !== null ? (
          <dl className="trip-summary__facts">
            {dates !== null ? <div><dt>Даты</dt><dd>{dates}</dd></div> : null}
            {budget !== null ? <div><dt>Бюджет</dt><dd>{budget}</dd></div> : null}
          </dl>
        ) : null}
        <div className="trip-details-header__meta">
          <p className="trip-details-header__participants">
            Участники: {participants.length > 0 ? participants.join(', ') : 'не указаны'}
          </p>
        </div>
      </article>

      {itineraryError ? <section className="trip-draft-editor" aria-label="Согласованная программа">
        <p role="alert" className="trip-draft-editor__message trip-draft-editor__message--error">{itineraryError}</p>
        <button className="profile-button profile-button--secondary" type="button" onClick={() => setItineraryReloadKey((key) => key + 1)}>Повторить</button>
      </section> : null}

      {draftError ? (
        <section className="trip-draft-editor" aria-label="Рабочий черновик">
          <p role="alert" className="trip-draft-editor__message trip-draft-editor__message--error">{draftError}</p>
          <button className="profile-button profile-button--secondary" type="button" onClick={() => setDraftReloadKey((key) => key + 1)}>Повторить</button>
        </section>
      ) : null}
      {draftDetail === null && draftError === null ? (
        <section className="trip-draft-editor" aria-label="Рабочий черновик" aria-live="polite">
          <p className="surface-card__copy">Загружаем общий черновик…</p>
        </section>
      ) : null}
      {draftDetail !== null && session !== null ? (
        <TripDraftEditor
          key={draftDetail.draft.trip_id}
          token={session.accessToken}
          userId={session.userId}
          draft={draftDetail.draft}
          trip={detail}
          alternatives={draftDetail.alternatives}
          confirmedDays={itinerary?.days ?? []}
          api={backendApiClient}
          authorLabel={(userId) => detail.participants.find((participant) => participant.user_id === userId)?.display_name ?? 'участник поездки'}
          onProposalAccepted={() => {
            setIsLoading(true);
            setReloadKey((key) => key + 1);
            setItineraryReloadKey((key) => key + 1);
            setDraftReloadKey((key) => key + 1);
          }}
        />
      ) : null}
    </section>
  );
}

function TripState({ title, message, onRetry }: Readonly<{ title: string; message: string | null; onRetry?: () => void }>) {
  return (
    <section className="page">
      <article className="surface-card surface-card--compact empty-state-card" aria-live="polite">
        <p className="section-kicker">Поездка</p>
        <h2 className="empty-state-card__title">{title}</h2>
        {message !== null ? <p className="surface-card__copy">{message}</p> : null}
        {onRetry ? <button className="profile-button profile-button--secondary" type="button" onClick={onRetry}>Повторить</button> : null}
      </article>
    </section>
  );
}
