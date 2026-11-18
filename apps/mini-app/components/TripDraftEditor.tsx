'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';

import { ApiError, type BackendApiClient, type TripDetailResponse, type TripDraftAlternativeMetadataResponse, type TripDraftContent, type TripDraftResponse, type TripItineraryDayResponse, type TripProposalResponse, type TripProposalSummaryResponse } from '@/lib/backend-api-client';
import { buildDraftContentForScope, formatProposalValue, getDraftScopeSnapshot, getInlineProposalTitle, validateTripDraftForProposal } from '@/lib/trip-inline-editing';
import { TripProposalPanel } from '@/components/TripProposalPanel';
import { formatTripBudget, formatTripDayCount, formatTripDetailDates } from '@/lib/trip-detail-runtime';
import { formatRussianDate } from '@/lib/russian-date-format';
import { proposalScopesOverlap } from '@/lib/trip-proposal-placement';
import type { TripView } from '@/components/TripWorkspace';

type DraftNavigation = Readonly<{
  view: TripView;
  navigate: (view: TripView) => void;
  back: () => void;
  backLabel?: string;
  focusedProposalId: string | null;
  openProposal: (id: string) => void;
  closeProposal: () => void;
}>;

export type TripDraftEditorProps = Readonly<{
  token: string;
  userId: string;
  draft: TripDraftResponse;
  trip: TripDetailResponse;
  alternatives: readonly TripDraftAlternativeMetadataResponse[];
  confirmedDays: readonly TripItineraryDayResponse[];
  api: Pick<BackendApiClient, 'getTripDraft' | 'getTripDraftAlternative' | 'saveTripDraft' | 'saveTripDraftAlternative' | 'getTripProposals' | 'getTripProposal' | 'createTripProposal' | 'voteTripProposal' | 'cancelTripProposal'>;
  authorLabel: (userId: string) => string;
  onProposalAccepted: () => void;
  navigation?: DraftNavigation;
  isRefreshing?: boolean;
  confirmedItineraryNotice?: Readonly<{ failed: boolean; onRetry?: () => void }>;
}>;

export function TripDraftEditor({ token, userId, draft: initialDraft, trip, alternatives: initialAlternatives, confirmedDays, api, authorLabel, onProposalAccepted, navigation, isRefreshing, confirmedItineraryNotice }: TripDraftEditorProps) {
  const confirmedContent = useMemo(() => createConfirmedContent(trip, confirmedDays), [confirmedDays, trip]);
  const initialContent = useMemo(() => mergeConfirmedContent(initialDraft.content, confirmedContent, initialDraft.version === 1), [confirmedContent, initialDraft.content, initialDraft.version]);
  const [content, setContent] = useState<TripDraftContent>(initialContent);
  const [savedContent, setSavedContent] = useState<TripDraftContent>(initialContent);
  const [version, setVersion] = useState(initialDraft.version);
  const [updatedBy, setUpdatedBy] = useState(initialDraft.updated_by_user_id);
  const [alternatives, setAlternatives] = useState<readonly TripDraftAlternativeMetadataResponse[]>(initialAlternatives);
  const [sentProposal, setSentProposal] = useState<TripProposalResponse | null>(null);
  const [alternativeTitle, setAlternativeTitle] = useState('');
  const [alternativeError, setAlternativeError] = useState<'save' | 'open' | null>(null);
  const [alternativeToConfirm, setAlternativeToConfirm] = useState<TripDraftAlternativeMetadataResponse | null>(null);
  const scope = navigation?.view.screen === 'edit' ? navigation.view.scope : null;
  const show = (target: string) => !navigation || scope === target;
  const dayNumber = scope?.startsWith('itinerary:day:')
    ? content.days.findIndex((day) => scope === `itinerary:day:${day.id}`) + 1 : 0;
  const [isReloading, setIsReloading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingAlternative, setIsSavingAlternative] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [hasConflict, setHasConflict] = useState(false);
  const [confirmReload, setConfirmReload] = useState(false);
  const [openingAlternativeId, setOpeningAlternativeId] = useState<string | null>(null);
  const [proposals, setProposals] = useState<TripProposalSummaryResponse[]>([]);
  const [proposalReloadSignal, setProposalReloadSignal] = useState(0);
  const pendingProposals = useRef(new Map<string, Readonly<{ snapshot: string; draftVersion: number; idempotencyKey: string }>>());
  const proposalInFlightRef = useRef(false);
  const hasUnsavedChanges = JSON.stringify(content) !== JSON.stringify(savedContent);
  const budgetIssue = scope === 'budget' ? validateTripDraftForProposal(content, 'budget')[0] : undefined;
  const budgetConflict = scope === 'budget' && hasConflict && !confirmedItineraryNotice;
  const requestDraftReload = () => {
    if (hasUnsavedChanges) setConfirmReload(true);
    else void reload();
  };
  const mergeProposalList = useCallback((incoming: TripProposalSummaryResponse[]) => setProposals((current) => [
      ...incoming,
      ...current.filter((proposalItem) => !incoming.some((item) => item.id === proposalItem.id))
    ]), []);
  const hasActiveProposal = (scope: string) => proposals.some((proposal) =>
    (proposal.status === 'pending' || proposal.status === 'blocked') && proposal.scopes.some((proposalScope) => proposalScopesOverlap(proposalScope, scope)));

  const reload = async () => {
    setIsReloading(true);
    setError(null);
    setSuccess(null);
    setConfirmReload(false);
    try {
      const latest = await api.getTripDraft(token, initialDraft.trip_id);
      const latestContent = mergeConfirmedContent(latest.draft.content, confirmedContent, latest.draft.version === 1);
      setContent(latestContent);
      setSavedContent(latestContent);
      setVersion(latest.draft.version);
      setUpdatedBy(latest.draft.updated_by_user_id);
      setAlternatives(latest.alternatives);
      setHasConflict(false);
    } catch {
      setError('Не удалось загрузить актуальный черновик. Ваши правки пока остаются на экране.');
    } finally {
      setIsReloading(false);
    }
  };

  const saveAlternative = async () => {
    setIsSavingAlternative(true);
    setAlternativeError(null);
    setSuccess(null);
    try {
      const saved = await api.saveTripDraftAlternative(token, initialDraft.trip_id, alternativeTitle, content);
      setAlternatives((current) => [saved, ...current]);
      setAlternativeTitle('');
      setSuccess('Вариант сохранён отдельно и не изменил основной черновик.');
    } catch {
      setAlternativeError('save');
    } finally {
      setIsSavingAlternative(false);
    }
  };

  const openAlternative = async (alternative: TripDraftAlternativeMetadataResponse) => {
    setAlternativeToConfirm(null);
    setOpeningAlternativeId(alternative.id);
    setAlternativeError(null);
    setSuccess(null);
    try {
      const snapshot = await api.getTripDraftAlternative(token, initialDraft.trip_id, alternative.id);
      setContent(snapshot.content);
      if (navigation) navigation.navigate({ screen: 'draft' });
      setSuccess('Вариант загружен в план. Выберите раздел и предложите его участникам для согласования.');
    } catch {
      setAlternativeError('open');
    } finally {
      setOpeningAlternativeId(null);
    }
  };

  const updateContent = (patch: Partial<TripDraftContent>) => setContent((current) => ({ ...current, ...patch }));

  useEffect(() => {
    const needsInitialItinerary = initialDraft.version === 1 && version === 1 && !hasUnsavedChanges &&
      !confirmedItineraryNotice && JSON.stringify(initialContent) !== JSON.stringify(savedContent);
    if (initialDraft.version <= version && !needsInitialItinerary) return;
    let isCurrent = true;
    void Promise.resolve().then(() => {
      if (!isCurrent) return;
      if (hasUnsavedChanges) {
        setHasConflict(true);
        setError('Общий черновик обновился. Ваши локальные правки сохранены; загрузите актуальную версию после проверки.');
        return;
      }
      const refreshedContent = mergeConfirmedContent(initialDraft.content, confirmedContent, initialDraft.version === 1);
      setContent(refreshedContent);
      setSavedContent(refreshedContent);
      setVersion(initialDraft.version);
      setUpdatedBy(initialDraft.updated_by_user_id);
    });
    return () => { isCurrent = false; };
  }, [confirmedContent, confirmedItineraryNotice, hasUnsavedChanges, initialContent, initialDraft, savedContent, version]);

  const propose = async (scope: string, label?: string) => {
    if (proposalInFlightRef.current || isSaving || isSavingAlternative || openingAlternativeId !== null) return;
    if (hasActiveProposal(scope)) {
      setError('По этой области уже идёт голосование. Откройте предложение рядом с пунктом поездки.');
      return;
    }
    proposalInFlightRef.current = true;
    setIsSaving(true);
    setError(null);
    setSuccess(null);
    const scopeSnapshot = JSON.stringify(getDraftScopeSnapshot(content, scope));
    const proposalContent = buildDraftContentForScope(content, savedContent, scope);
    const validationIssues = validateTripDraftForProposal(proposalContent, scope);
    if (validationIssues.length > 0) {
      setError(validationIssues.join(' '));
      setIsSaving(false);
      proposalInFlightRef.current = false;
      return;
    }

    let retry = pendingProposals.current.get(scope);
    let savedVersion = version;
    if (retry?.snapshot === scopeSnapshot) {
      savedVersion = retry.draftVersion;
    } else {
      try {
        const saved = await api.saveTripDraft(token, initialDraft.trip_id, { base_version: version, content: proposalContent });
        savedVersion = saved.version;
        setSavedContent(saved.content);
        setVersion(saved.version);
        setUpdatedBy(saved.updated_by_user_id);
        setHasConflict(false);
        retry = { snapshot: scopeSnapshot, draftVersion: saved.version, idempotencyKey: crypto.randomUUID() };
        pendingProposals.current.set(scope, retry);
      } catch (saveError) {
        let currentDraft: TripDraftResponse | null = null;
        try { currentDraft = (await api.getTripDraft(token, initialDraft.trip_id)).draft; } catch { /* Preserve the edit and report the original save failure. */ }
        if (currentDraft !== null && JSON.stringify(currentDraft.content) === JSON.stringify(proposalContent)) {
          savedVersion = currentDraft.version;
          setSavedContent(currentDraft.content);
          setVersion(currentDraft.version);
          setUpdatedBy(currentDraft.updated_by_user_id);
          retry = { snapshot: scopeSnapshot, draftVersion: currentDraft.version, idempotencyKey: crypto.randomUUID() };
          pendingProposals.current.set(scope, retry);
        } else {
          setHasConflict(saveError instanceof ApiError && saveError.status === 409);
          setError(saveError instanceof ApiError && saveError.status === 422
            ? `Черновик не прошёл проверку: ${saveError.message}`
            : saveError instanceof ApiError && saveError.status === 409
              ? 'Черновик изменился у другого участника. Ваши правки сохранены на экране. Загрузите актуальную версию и повторите.'
              : 'Не удалось сохранить черновик. Проверьте сеть и повторите; предложение ещё не создано.');
          setIsSaving(false);
          proposalInFlightRef.current = false;
          return;
        }
      }
    }

    if (!retry) {
      setError('Не удалось подготовить предложение. Повторите действие.');
      setIsSaving(false);
      proposalInFlightRef.current = false;
      return;
    }
    try {
      const proposal = await api.createTripProposal(token, initialDraft.trip_id, {
        draft_version: savedVersion,
        title: getInlineProposalTitle(scope, label),
        idempotency_key: retry.idempotencyKey,
        scopes: [scope]
      });
      pendingProposals.current.delete(scope);
      if (navigation) setSentProposal(proposal);
      setSuccess('Предложение отправлено участникам. Подтверждённая поездка изменится после единогласного принятия.');
      setProposals((current) => [toProposalSummary(proposal), ...current.filter((item) => item.id !== proposal.id)]);
      setProposalReloadSignal((current) => current + 1);
    } catch (proposalError) {
      if (proposalError instanceof ApiError && proposalError.status === 422) {
        pendingProposals.current.delete(scope);
        setError(`Предложение не прошло проверку: ${proposalError.message}`);
      } else if (proposalError instanceof ApiError && proposalError.status === 409) {
        pendingProposals.current.delete(scope);
        let latestProposals: TripProposalSummaryResponse[] = [];
        try {
          latestProposals = await api.getTripProposals(token, initialDraft.trip_id);
          setProposals(latestProposals);
        } catch { /* The explicit refresh action remains available in the Proposal list. */ }
        setProposalReloadSignal((current) => current + 1);
        const activeMatch = latestProposals.find((item) =>
          (item.status === 'pending' || item.status === 'blocked') && item.scopes.includes(scope));
        if (isProposalScopeBusy(proposalError) || activeMatch) {
          setError(activeMatch
            ? 'По этой области уже идёт голосование. Откройте предложение рядом с пунктом поездки.'
            : 'По этой области уже идёт голосование. Обновите список предложений и откройте его там.');
        } else {
          setHasConflict(true);
          setError('Версия поездки или согласованные данные изменились. Загрузите актуальную версию, проверьте свои правки и создайте новое предложение.');
        }
      } else {
        setError('Черновик сохранён, но ответ на создание предложения не получен. Повторите это же действие: голосование не будет продублировано.');
      }
    } finally {
      setIsSaving(false);
      proposalInFlightRef.current = false;
    }
  };

  const addDay = () => updateContent({ days: [...content.days, {
    id: crypto.randomUUID(), date: null, title: null, notes: null, events: []
  }] });
  const addRouteStop = () => updateContent({ route_stops: [...content.route_stops, {
    id: crypto.randomUUID(), place_label: '', country_code: null, place_ref: null,
    stay_from: null, stay_to: null, notes: null
  }] });
  const addAccommodation = () => updateContent({ accommodations: [...content.accommodations, {
    id: crypto.randomUUID(), name: '', location: null, date_from: null, date_to: null, notes: null
  }] });
  const addTransport = () => updateContent({ transport: [...content.transport, {
    id: crypto.randomUUID(), mode: '', origin: null, destination: null,
    departure_at: null, arrival_at: null, notes: null
  }] });

  return (
    <TripProposalPanel token={token} userId={userId} tripId={initialDraft.trip_id}
      api={api} participantLabel={authorLabel} onAccepted={onProposalAccepted}
      onProposalsChange={mergeProposalList} externallyKnownProposals={proposals} reloadSignal={proposalReloadSignal}
      focusedProposalId={navigation?.focusedProposalId} onOpenProposal={navigation?.openProposal} onCloseProposal={navigation?.closeProposal}
      onOpenProgram={navigation ? () => {
        navigation.closeProposal();
        if (navigation.view.screen !== 'program') navigation.navigate({ screen: 'program' });
      } : undefined}
      onOpenHistory={navigation ? () => {
        navigation.closeProposal();
        if (navigation.view.screen !== 'proposals') navigation.navigate({ screen: 'proposals' });
      } : undefined}
      onReturnToEdit={navigation ? (proposal) => {
        navigation.closeProposal();
        if (proposal.scopes.length === 1) navigation.navigate({ screen: 'edit', scope: proposal.scopes[0] });
        else navigation.navigate({ screen: 'draft' });
      } : undefined}
      confirmedContext={(proposal) => isRefreshing ?
        <article className="trip-draft-editor__section" role="status"><p>Обновляем согласованный план…</p></article> :
        <ConfirmedScope scope={proposal.scopes[0]} content={confirmedContent} voting />}>
    {(renderProposalAtScope, proposalHistory) => navigation?.view.screen === 'proposals' ? (
      <section className="trip-draft-editor trip-workspace-editor">
        <h1>История предложений</h1>
        {proposalHistory}
        <button className="profile-button profile-button--secondary" type="button" onClick={navigation.back}>Свернуть историю</button>
        <button className="profile-button profile-button--secondary" type="button" onClick={() => navigation.navigate({ screen: 'program' })}>К программе</button>
      </section>
    ) : sentProposal && navigation?.view.screen === 'edit' ? (
      <section className="trip-draft-editor trip-workspace-editor">
        <h1>Предложение отправлено</h1>
        <ConfirmedScope scope={sentProposal.operations[0]?.scope} content={confirmedContent} />
        <article className="trip-draft-editor__section" role="status">
          <h2>{sentProposal.title}</h2>
          <p>Участники могут проголосовать. Согласованный план обновится после единогласного принятия.</p>
          <button className="profile-button profile-button--primary" type="button" onClick={() => {
            navigation.openProposal(sentProposal.id);
            setSentProposal(null);
            setSuccess(null);
          }}>Открыть голосование</button>
          <button className="profile-button profile-button--secondary" type="button" onClick={() => {
            setSentProposal(null);
            setSuccess(null);
            navigation.navigate({ screen: 'alternatives' });
          }}>Сохранённые варианты</button>
        </article>
        <button className="profile-button profile-button--secondary" type="button" onClick={() => {
          setSentProposal(null);
          setSuccess(null);
          navigation.back();
        }}>Назад</button>
      </section>
    ) : alternativeToConfirm && (!navigation || navigation.view.screen === 'alternatives') ? (
      <section className="trip-draft-editor trip-workspace-editor">
        <h1>Открыть вариант</h1>
        <article className="trip-draft-editor__section">
          <h2>Заменить локальные правки?</h2>
          <p>Вариант «{alternativeToConfirm.title}» заменит несохранённые изменения в редакторе.</p>
          <button className="profile-button profile-button--primary" type="button" onClick={() => void openAlternative(alternativeToConfirm)}>Заменить и открыть</button>
          <button className="profile-button profile-button--secondary" type="button" onClick={() => setAlternativeToConfirm(null)}>Оставить текущие правки</button>
        </article>
        <article className="trip-draft-editor__section"><h2>Согласованный план</h2><p>Открытие варианта меняет только локальный черновик. Затем можно предложить выбранный раздел.</p></article>
      </section>
    ) : (
    <section className={navigation ? 'trip-draft-editor trip-workspace-editor' : 'trip-draft-editor'} aria-labelledby="trip-draft-title">
      {navigation ? <>
        <h1 id="trip-draft-title">{scope ? `${dayNumber ? `День ${dayNumber}` : scopeTitle(scope)} · изменение` : navigation.view.screen === 'alternatives' ? 'Сохранённые варианты' : 'Общий черновик'}</h1>
        {scope ? <ConfirmedScope scope={scope} content={confirmedContent} /> : null}
        {navigation.view.screen === 'alternatives' && alternativeError !== 'save' ? <article className="trip-draft-editor__section">
          <h2>Общий черновик · версия {version}</h2>
          <p>Последняя правка: {authorLabel(updatedBy)}<br />Согласованный план не изменён.</p>
        </article> : (scope === 'budget' || navigation.view.screen === 'draft') ?
          <p className="trip-draft-editor__byline">Общий черновик · версия {version} · правка: {authorLabel(updatedBy)}</p> : null}
      </> : <header className="trip-draft-editor__header">
        <div>
          <p className="section-kicker">Рабочая версия поездки · версия {version}</p>
          <h3 id="trip-draft-title" className="trip-details__heading">План поездки</h3>
          <p className="surface-card__copy">Изменение сначала сохраняется в черновике и отправляется на голосование. Согласованная поездка обновится после единогласного принятия.</p>
          <p className="trip-draft-editor__byline">Последняя правка: {authorLabel(updatedBy)}</p>
        </div>
      </header>}

      {error && scope !== 'budget' ? <p role="alert" className="trip-draft-editor__message trip-draft-editor__message--error">{error}</p> : null}
      {success ? <p role="status" className="trip-draft-editor__message">{success}</p> : null}
      {confirmedItineraryNotice ? <article className="trip-draft-editor__section">
        <p role={confirmedItineraryNotice.failed ? 'alert' : 'status'}>{confirmedItineraryNotice.failed ?
          'Не удалось загрузить согласованную программу. Правки доступны после повторной загрузки.' : 'Загружаем согласованную программу…'}</p>
        {confirmedItineraryNotice.failed && confirmedItineraryNotice.onRetry ?
          <button className="profile-button profile-button--secondary" type="button" onClick={confirmedItineraryNotice.onRetry}>Повторить загрузку программы</button> : null}
      </article> : null}
      {hasConflict && confirmReload && !confirmedItineraryNotice && !budgetConflict ? <article className="trip-draft-editor__section">
        <h2>Заменить локальные правки?</h2>
        <p>При успешной загрузке актуальная версия заменит несохранённые поля.</p>
        <button className="profile-button profile-button--primary" type="button" onClick={() => void reload()}>Загрузить и заменить</button>
        <button className="profile-button profile-button--secondary" type="button" onClick={() => setConfirmReload(false)}>Оставить текущие правки</button>
      </article> : null}
      {hasConflict && !confirmReload && !confirmedItineraryNotice && !budgetConflict ? <button className="profile-button profile-button--secondary" type="button" disabled={isReloading} onClick={requestDraftReload}>{isReloading ? 'Загружаем актуальную версию…' : 'Загрузить актуальную версию'}</button> : null}
      {isSaving && scope !== 'budget' ? <p role="status" className="trip-draft-editor__byline">Отправляем предложение…</p> : null}

      {alternativeError === 'open' && (!navigation || navigation.view.screen === 'alternatives') ?
        <p role="alert" className="trip-draft-editor__message trip-draft-editor__message--error">Не удалось загрузить вариант. Текущие правки остались на экране.</p> : null}
      <fieldset className="trip-draft-editor__fields" disabled={Boolean(confirmedItineraryNotice) || isRefreshing || isSaving || isReloading || isSavingAlternative || openingAlternativeId !== null}>
      <DraftSection title="Маршрут и даты" navigation={navigation} scope="route" alternateScope="dates" open={hasActiveProposal('route') || hasActiveProposal('dates')} summary={`${sectionState('Маршрут', content.route_stops, confirmedContent.route_stops, trip.trip.destination_status)} · ${sectionState('Даты', [content.date_from, content.date_to], [confirmedContent.date_from, confirmedContent.date_to], trip.trip.dates_status)}`}>
        {show('dates') ? <>
        <div className="trip-workspace-editor__rows">
          <DraftField label={navigation ? 'Начало' : 'Начало поездки'} type="date" value={content.date_from ?? ''} onChange={(value) => updateContent({ date_from: value || null })} />
          <DraftField label={navigation ? 'Окончание' : 'Окончание поездки'} type="date" value={content.date_to ?? ''} onChange={(value) => updateContent({ date_to: value || null })} />
        </div>
        {renderProposalAtScope('dates')}
        <button className="profile-button profile-button--primary" type="button" disabled={isSaving || hasActiveProposal('dates')} onClick={() => void propose('dates')}>Предложить даты</button>
        </> : null}
        {show('route') ? <>
        {content.route_stops.map((stop, index) => {
          const detailsForStop = <>
            <DraftField label="Прибытие" type="date" value={stop.stay_from ?? ''} onChange={(stay_from) => updateContent({ route_stops: content.route_stops.map((item) => item.id === stop.id ? { ...item, stay_from: stay_from || null } : item) })} />
            <DraftField label="Отъезд" type="date" value={stop.stay_to ?? ''} onChange={(stay_to) => updateContent({ route_stops: content.route_stops.map((item) => item.id === stop.id ? { ...item, stay_to: stay_to || null } : item) })} />
            <DraftField label="Заметка о месте" value={stop.notes ?? ''} onChange={(notes) => updateContent({ route_stops: content.route_stops.map((item) => item.id === stop.id ? { ...item, notes: notes || null } : item) })} />
            <button className="navigation-link" type="button" onClick={() => updateContent({ route_stops: content.route_stops.filter((item) => item.id !== stop.id) })}>Удалить место</button>
          </>;
          return (
          <div className="trip-draft-editor__item trip-workspace-editor__rows" key={stop.id}>
            <DraftField label={`Место ${index + 1}`} value={stop.place_label} onChange={(place_label) => updateContent({ route_stops: content.route_stops.map((item) => item.id === stop.id ? { ...item, place_label } : item) })} />
            {navigation ? <details className="trip-workspace-editor__extra">
              <summary>Детали места {index + 1}</summary>
              <div className="trip-workspace-editor__rows">{detailsForStop}</div>
            </details> : detailsForStop}
          </div>
          );
        })}
        <button className="profile-button profile-button--secondary" type="button" onClick={addRouteStop}>Добавить место</button>
        {renderProposalAtScope('route')}
        <button className="profile-button profile-button--primary" type="button" disabled={isSaving || hasActiveProposal('route')} onClick={() => void propose('route')}>{isSaving ? 'Отправляем…' : 'Предложить маршрут'}</button>
        </> : null}
      </DraftSection>

      <DraftSection title="Бюджет"
        editHeading={budgetConflict ? 'Черновик обновился' : budgetIssue ? 'Проверьте бюджет' : undefined}
        navigation={navigation} scope="budget" open={hasActiveProposal('budget')} summary={sectionState('Бюджет', content.budget, confirmedContent.budget, trip.trip.budget_status)}>
        <div className="trip-workspace-editor__rows">
          <DraftField label="От" error={budgetIssue ? 'Проверьте значение.' : undefined} type="number" value={content.budget.min ?? ''} onChange={(value) => updateContent({ budget: { ...content.budget, min: value || null } })} />
          <DraftField label="До" error={budgetIssue ? 'Проверьте значение.' : undefined} type="number" value={content.budget.max ?? ''} onChange={(value) => updateContent({ budget: { ...content.budget, max: value || null } })} />
          <DraftField label="Валюта" placeholder="Не указана" value={content.budget.currency ?? ''} onChange={(value) => updateContent({ budget: { ...content.budget, currency: value || null } })} />
          <label className="trip-draft-editor__field">
            <span>Бюджет</span>
            <select className="profile-input" value={content.budget.scope ?? ''} onChange={(event) => updateContent({ budget: { ...content.budget, scope: event.target.value === '' ? null : event.target.value as 'per_person' | 'group_total' } })}>
              <option value="">Не указан</option><option value="per_person">На человека</option><option value="group_total">На группу</option>
            </select>
          </label>
        </div>
        {renderProposalAtScope('budget')}
        {scope === 'budget' && (budgetIssue || error) ? <p role="alert" className="trip-draft-editor__byline">{budgetIssue ?? error}</p> : null}
        <button className="profile-button profile-button--primary" type="button" disabled={isSaving || hasActiveProposal('budget') || Boolean(budgetIssue) || budgetConflict} onClick={() => void propose('budget')}>{isSaving ? 'Отправляем…' : 'Предложить бюджет'}</button>

        {budgetConflict ? <>
          {confirmReload ? <p>Актуальная версия заменит несохранённые поля после успешной загрузки.</p> : null}
          <button className="profile-button profile-button--secondary" type="button"
            onClick={confirmReload ? () => void reload() : requestDraftReload}>
            {confirmReload ? 'Загрузить и заменить' : 'Загрузить актуальную версию'}
          </button>
          <button className="profile-button profile-button--secondary" type="button" onClick={() => {
            if (confirmReload) setConfirmReload(false);
            else { setHasConflict(false); setError(null); }
          }}>{confirmReload ? 'Оставить текущие правки' : 'Остаться и проверить правки'}</button>
        </> : null}
      </DraftSection>

      <DraftSection title="Проживание" navigation={navigation} scope="accommodation" open={hasActiveProposal('accommodation')} summary={sectionState('Проживание', content.accommodations, confirmedContent.accommodations)}>
        {content.accommodations.map((stay, index) => (
          <div className="trip-draft-editor__item trip-workspace-editor__rows" key={stay.id}>
            <DraftField label={`Вариант ${index + 1}`} value={stay.name} onChange={(name) => updateContent({ accommodations: content.accommodations.map((item) => item.id === stay.id ? { ...item, name } : item) })} />
            <DraftField label="Место" value={stay.location ?? ''} onChange={(location) => updateContent({ accommodations: content.accommodations.map((item) => item.id === stay.id ? { ...item, location: location || null } : item) })} />
            <DraftField label="Заезд" type="date" value={stay.date_from ?? ''} onChange={(date_from) => updateContent({ accommodations: content.accommodations.map((item) => item.id === stay.id ? { ...item, date_from: date_from || null } : item) })} />
            <DraftField label="Выезд" type="date" value={stay.date_to ?? ''} onChange={(date_to) => updateContent({ accommodations: content.accommodations.map((item) => item.id === stay.id ? { ...item, date_to: date_to || null } : item) })} />
            <DraftField label="Заметка" value={stay.notes ?? ''} onChange={(notes) => updateContent({ accommodations: content.accommodations.map((item) => item.id === stay.id ? { ...item, notes: notes || null } : item) })} />
            <button className="navigation-link" type="button" onClick={() => updateContent({ accommodations: content.accommodations.filter((item) => item.id !== stay.id) })}>Удалить вариант</button>
          </div>
        ))}
        <button className="profile-button profile-button--secondary" type="button" onClick={addAccommodation}>Добавить проживание</button>
        {renderProposalAtScope('accommodation')}
        <button className="profile-button profile-button--primary" type="button" disabled={isSaving || hasActiveProposal('accommodation')} onClick={() => void propose('accommodation')}>Предложить проживание</button>
      </DraftSection>

      <DraftSection title="Транспорт" navigation={navigation} scope="transport" open={hasActiveProposal('transport')} summary={sectionState('Транспорт', content.transport, confirmedContent.transport, trip.trip.transport_status)}>
        {content.transport.map((leg, index) => (
          <div className="trip-draft-editor__item trip-workspace-editor__rows" key={leg.id}>
            <DraftField label={`Способ · перемещение ${index + 1}`} value={leg.mode} onChange={(mode) => updateContent({ transport: content.transport.map((item) => item.id === leg.id ? { ...item, mode } : item) })} />
            <DraftField label="Откуда" value={leg.origin ?? ''} onChange={(origin) => updateContent({ transport: content.transport.map((item) => item.id === leg.id ? { ...item, origin: origin || null } : item) })} />
            <DraftField label="Куда" value={leg.destination ?? ''} onChange={(destination) => updateContent({ transport: content.transport.map((item) => item.id === leg.id ? { ...item, destination: destination || null } : item) })} />
            <DraftField label="Отправление" type="datetime-local" value={toLocalDateTimeInput(leg.departure_at)} onChange={(departure_at) => updateContent({ transport: content.transport.map((item) => item.id === leg.id ? { ...item, departure_at: departure_at ? new Date(departure_at).toISOString() : null } : item) })} />
            <DraftField label="Прибытие" type="datetime-local" value={toLocalDateTimeInput(leg.arrival_at)} onChange={(arrival_at) => updateContent({ transport: content.transport.map((item) => item.id === leg.id ? { ...item, arrival_at: arrival_at ? new Date(arrival_at).toISOString() : null } : item) })} />
            <DraftField label="Заметка" value={leg.notes ?? ''} onChange={(notes) => updateContent({ transport: content.transport.map((item) => item.id === leg.id ? { ...item, notes: notes || null } : item) })} />
            <button className="navigation-link" type="button" onClick={() => updateContent({ transport: content.transport.filter((item) => item.id !== leg.id) })}>Удалить перемещение</button>
          </div>
        ))}
        <button className="profile-button profile-button--secondary" type="button" onClick={addTransport}>Добавить перемещение</button>
        {renderProposalAtScope('transport')}
        <button className="profile-button profile-button--primary" type="button" disabled={isSaving || hasActiveProposal('transport')} onClick={() => void propose('transport')}>Предложить транспорт</button>
      </DraftSection>

      <DraftSection title="Программа по дням" navigation={navigation} scope="itinerary:all" open={hasActiveProposal('itinerary:all') || content.days.some((day) => hasActiveProposal(`itinerary:day:${day.id}`) || day.events.some((event) => hasActiveProposal(`itinerary:event:${day.id}:${event.id}`)))} summary={sectionState('Программа', content.days, confirmedContent.days)}>
        {show('itinerary:all') ? <>
        {renderProposalAtScope('itinerary:all')}
        </> : null}
        {scope?.startsWith('itinerary:') && scope !== 'itinerary:all' && !content.days.some((day) => scope === `itinerary:day:${day.id}` || day.events.some((event) => scope === `itinerary:event:${day.id}:${event.id}`)) ? (
          <p>Этого пункта нет в рабочем черновике. Проверьте состав программы в редакторе.</p>
        ) : null}
        {content.days.map((day, dayIndex) => {
          const dayScope = `itinerary:day:${day.id}`;
          if (navigation && scope === 'itinerary:all') return <button key={day.id} className="trip-workspace-editor__day-link" type="button"
            onClick={() => navigation.navigate({ screen: 'edit', scope: dayScope })}>День {dayIndex + 1}{day.title ? ` · ${day.title}` : ''}</button>;
          if (navigation && scope !== dayScope && !day.events.some((event) => scope === `itinerary:event:${day.id}:${event.id}`)) return null;
          return <div className="trip-draft-editor__day trip-workspace-editor__rows" key={day.id}>
            {show(dayScope) ? <>
            <DraftField label="Название дня" value={day.title ?? ''} onChange={(title) => updateContent({ days: content.days.map((item) => item.id === day.id ? { ...item, title: title || null } : item) })} />
            <DraftField label={`День ${dayIndex + 1}`} type="date" value={day.date ?? ''} onChange={(date) => updateContent({ days: content.days.map((item) => item.id === day.id ? { ...item, date: date || null } : item) })} />
            <DraftField label="Заметка о дне" value={day.notes ?? ''} onChange={(notes) => updateContent({ days: content.days.map((item) => item.id === day.id ? { ...item, notes: notes || null } : item) })} />
            </> : null}
            {day.events.map((event, eventIndex) => {
              const eventScope = `itinerary:event:${day.id}:${event.id}`;
              if (navigation && scope === dayScope) return <button key={event.id} className="profile-button profile-button--secondary" type="button"
                onClick={() => navigation.navigate({ screen: 'edit', scope: eventScope })}>{event.title || `Событие ${eventIndex + 1}`}</button>;
              if (navigation && scope !== eventScope) return null;
              return <div className="trip-draft-editor__item trip-workspace-editor__rows" key={event.id}>
                <DraftField label={navigation ? 'Название' : `Событие ${eventIndex + 1}`} value={event.title} onChange={(title) => updateDayEvent(day.id, event.id, { title })} />
                <label className="trip-draft-editor__field">
                  <span>Тип</span>
                  <select className="profile-input" value={event.kind} onChange={(change) => updateDayEvent(day.id, event.id, { kind: change.target.value as TripDraftContent['days'][number]['events'][number]['kind'] })}>
                    <option value="activity">Занятие</option><option value="transport">Транспорт</option><option value="accommodation">Проживание</option><option value="meal">Питание</option><option value="note">Заметка</option><option value="other">Другое</option>
                  </select>
                </label>
                <DraftField label="Время" type="time" value={event.start_time ?? ''} onChange={(start_time) => updateDayEvent(day.id, event.id, { start_time: start_time || null })} />
                <DraftField label={navigation ? 'Длительность, мин.' : 'Длительность, минут'} type="number" value={event.duration_minutes === null ? '' : String(event.duration_minutes)} onChange={(value) => updateDayEvent(day.id, event.id, { duration_minutes: value ? Number(value) : null })} />
                <DraftField label="Адрес" value={event.address ?? ''} onChange={(address) => updateDayEvent(day.id, event.id, { address: address || null })} />
                <DraftField label="Расход" type="number" value={event.estimated_cost ?? ''} onChange={(estimated_cost) => updateDayEvent(day.id, event.id, { estimated_cost: estimated_cost || null })} />
                <DraftField label="Валюта расхода" value={event.currency ?? ''} onChange={(currency) => updateDayEvent(day.id, event.id, { currency: currency || null })} />
                <DraftField label="Заметка к событию" value={event.notes ?? ''} onChange={(notes) => updateDayEvent(day.id, event.id, { notes: notes || null })} />
                {renderProposalAtScope(`itinerary:event:${day.id}:${event.id}`)}
                <button className="profile-button profile-button--primary" type="button" disabled={isSaving || hasActiveProposal(`itinerary:event:${day.id}:${event.id}`) || !confirmedDays.some((confirmedDay) => confirmedDay.id === day.id)} onClick={() => void propose(`itinerary:event:${day.id}:${event.id}`, event.title || `события в дне ${dayIndex + 1}`)}>Предложить событие</button>
                {!confirmedDays.some((confirmedDay) => confirmedDay.id === day.id) ? <p className="surface-card__copy">Сначала согласуйте день, чтобы предлагать изменение отдельного события.</p> : null}
                <button className="navigation-link" type="button" onClick={() => updateContent({ days: content.days.map((item) => item.id === day.id ? { ...item, events: item.events.filter((part) => part.id !== event.id) } : item) })}>Удалить событие</button>
              </div>;
            })}
            {show(dayScope) ? <div className="trip-draft-editor__actions">
              <button className="profile-button profile-button--secondary" type="button" onClick={() => updateContent({ days: content.days.map((item) => item.id === day.id ? { ...item, events: [...item.events, createEvent()] } : item) })}>Добавить событие</button>
              <button className="navigation-link" type="button" onClick={() => updateContent({ days: content.days.filter((item) => item.id !== day.id) })}>Удалить день</button>
            </div> : null}
            {show(dayScope) ? <>
              {renderProposalAtScope(dayScope)}
              <button className="profile-button profile-button--primary" type="button" disabled={isSaving || hasActiveProposal(dayScope)} onClick={() => void propose(dayScope, day.title ?? `дня ${dayIndex + 1}`)}>Предложить изменение дня</button>
            </> : null}
          </div>;
        })}
        {show('itinerary:all') ? <>
          <button className="profile-button profile-button--primary" type="button" disabled={isSaving || hasActiveProposal('itinerary:all')} onClick={() => void propose('itinerary:all')}>Предложить программу целиком</button>
          <button className="profile-button profile-button--secondary" type="button" onClick={addDay}>Добавить день</button>
        </> : null}
      </DraftSection>

      <DraftSection title="Общие заметки" navigation={navigation} scope="notes" summary={content.notes ? 'Черновые заметки' : 'Не указаны'}>
        <p>{content.notes || 'Заметки пока не указаны.'}</p>
        <p className="surface-card__copy">Общие заметки не входят в доступные области согласования.</p>
      </DraftSection>

      <DraftSection title="Сохранённые альтернативы" navigation={navigation} scope="alternatives" summary={`${alternatives.length} сохранено`}
        editHeading={alternativeError === 'save' ? 'Не удалось сохранить вариант' : 'Сохранить отдельный вариант'}>
        {alternativeError === 'save' ? <p role="alert">Текущие правки остались на экране. Проверьте сеть и повторите.</p> : null}
        <div className="trip-workspace-editor__rows">
          <DraftField label="Название" value={alternativeTitle} onChange={setAlternativeTitle} />
          <button className={`profile-button profile-button--${alternativeError === 'save' ? 'primary' : 'secondary'}`} type="button" disabled={isSavingAlternative || !alternativeTitle.trim()} onClick={() => void saveAlternative()}>
            {isSavingAlternative ? 'Сохраняем…' : alternativeError === 'save' ? 'Повторить сохранение' : 'Сохранить вариант'}
          </button>
        </div>
        {!navigation ? renderAlternatives() : null}
      </DraftSection>
      {navigation?.view.screen === 'alternatives' && alternativeError !== 'save' ? renderAlternatives() : null}
      </fieldset>
      {scope === 'itinerary:all' ? <article className="trip-draft-editor__section"><h2>Общие заметки</h2><p>{content.notes || 'Заметки пока не указаны.'} Доступны только для чтения.</p></article> : null}
      {scope === 'accommodation' ? <p className="trip-draft-editor__byline">Голосование по всему списку. Это не бронь.</p> : null}
      {scope === 'route' ? <p className="trip-draft-editor__byline">Предлагается вся последовательность. Бюджет и даты останутся прежними.</p> : null}
      {dayNumber ? <p className="trip-draft-editor__byline">День может остаться свободным. Для нового дня сначала согласуйте его целиком.</p> : null}
      {navigation ? <button className="profile-button profile-button--secondary trip-workspace-editor__back" type="button" onClick={navigation.back}>
        {navigation.backLabel ?? 'Назад'}
      </button> : null}
      {navigation && scope === 'itinerary:all' ? <nav className="trip-workspace-editor__scopes" aria-label="Разделы поездки">
        {['route', 'dates', 'accommodation', 'transport'].map((target) => <button key={target}
          className="profile-button profile-button--secondary" type="button"
          onClick={() => navigation.navigate({ screen: 'edit', scope: target })}>{scopeTitle(target)}</button>)}
        <button className="profile-button profile-button--secondary" type="button" onClick={() => navigation.navigate({ screen: 'alternatives' })}>Сохранённые варианты</button>
        <button className="trip-workspace-editor__day-link" type="button" onClick={() => navigation.navigate({ screen: 'draft' })}>Все разделы черновика</button>
      </nav> : null}
    </section>
    )}
    </TripProposalPanel>
  );

  function renderAlternatives() {
    return <>
        {alternatives.length === 0 ? <article className="trip-draft-editor__alternative"><h2>Сохранённых вариантов пока нет</h2><p>Здесь появятся сохранённые вами варианты.</p></article> : null}
        {alternatives.map((alternative) => (
          <article className="trip-draft-editor__alternative" key={alternative.id}>
            <h2>{alternative.title}</h2>
            <p>Автор: {[authorLabel(alternative.created_by_user_id), formatRussianDate(alternative.created_at.slice(0, 10))].filter(Boolean).join(' · ')}<br />Сохранённый вариант черновика.</p>
            <button className="profile-button profile-button--secondary" type="button" disabled={openingAlternativeId === alternative.id} onClick={() => { if (hasUnsavedChanges) setAlternativeToConfirm(alternative); else void openAlternative(alternative); }}>
              {openingAlternativeId === alternative.id ? 'Загружаем…' : 'Открыть в редакторе'}
            </button>
          </article>
        ))}
    </>;
  }

  function updateDayEvent(dayId: string, eventId: string, patch: Partial<TripDraftContent['days'][number]['events'][number]>) {
    updateContent({ days: content.days.map((day) => day.id === dayId
      ? { ...day, events: day.events.map((event) => event.id === eventId ? { ...event, ...patch } : event) }
      : day) });
  }
}

function createEvent(): TripDraftContent['days'][number]['events'][number] {
  return {
    id: crypto.randomUUID(), kind: 'activity', title: '', start_time: null,
    duration_minutes: null, address: null, estimated_cost: null, currency: null, notes: null
  };
}

function DraftSection({ title, summary, open = false, children, navigation, scope, alternateScope, editHeading }: Readonly<{
  title: string; summary: string; open?: boolean; children: ReactNode; navigation?: DraftNavigation; scope: string; alternateScope?: string; editHeading?: string;
}>) {
  if (!navigation) return <details className="trip-draft-editor__section" open={open}><summary><strong>{title}</strong><span>{summary}</span></summary><div className="trip-draft-editor__section-content">{children}</div></details>;
  const view = navigation.view;
  if (view.screen === 'draft') {
    return <article className="trip-draft-editor__section">
      <h2>{title}</h2><p>{summary}</p>
      <button className="profile-button profile-button--secondary" type="button" onClick={() => navigation.navigate(scope === 'alternatives' ? { screen: 'alternatives' } : { screen: 'edit', scope })}>
        {scope === 'alternatives' ? 'Открыть варианты' : scope === 'notes' ? 'Открыть заметки' : `Редактировать · ${scopeTitle(scope).toLowerCase()}`}
      </button>
      {alternateScope ? <button className="profile-button profile-button--secondary" type="button" onClick={() => navigation.navigate({ screen: 'edit', scope: alternateScope })}>Изменить даты</button> : null}
    </article>;
  }
  const selected = view.screen === 'edit' && (view.scope === scope || view.scope === alternateScope || (scope === 'itinerary:all' && view.scope.startsWith('itinerary:')));
  if (!selected && !(view.screen === 'alternatives' && scope === 'alternatives')) return null;
  const selectedScope = view.screen === 'edit' ? view.scope : '';
  const headings: Record<string, string> = {
    route: 'В черновике · маршрут', dates: 'Даты в черновике', transport: 'Весь раздел транспорта',
    accommodation: 'Весь раздел проживания', 'itinerary:all': 'Программа в черновике'
  };
  const itineraryHeading = selectedScope.startsWith('itinerary:day:') ? 'День в черновике' : 'Событие в черновике';
  const heading = editHeading ?? headings[selectedScope] ?? (selectedScope.startsWith('itinerary:') ? itineraryHeading : 'Исходные значения');
  return <article className="trip-draft-editor__section"><h2>{heading}</h2>{children}</article>;
}

function scopeTitle(scope: string): string {
  if (scope.startsWith('itinerary:day:')) return 'День';
  if (scope.startsWith('itinerary:event:')) return 'Событие';
  return ({
    route: 'Маршрут', dates: 'Даты', budget: 'Бюджет', accommodation: 'Проживание',
    transport: 'Транспорт', 'itinerary:all': 'Программа', notes: 'Заметки'
  } as Record<string, string>)[scope] ?? 'Раздел поездки';
}

function ConfirmedScope({ scope, content, voting }: Readonly<{ scope?: string; content: TripDraftContent; voting?: boolean }>) {
  const budget = scope === 'budget' ? formatTripBudget(content.budget) : null;
  const snapshot = scope ? getDraftScopeSnapshot(content, scope) : null;
  const parentId = scope?.startsWith('itinerary:event:') ? scope.split(':')[2] : null;
  const parentIndex = content.days.findIndex((day) => day.id === parentId);
  const parent = content.days[parentIndex];
  const title = parentId ? (parent ? 'Родительский день согласован' : 'Родительский день ещё не согласован') :
    voting && scope === 'budget' ? 'Согласованный бюджет' : 'Согласовано';
  let value = formatSectionValue(snapshot);
  if (scope === 'budget') value = budget ?? (voting ? 'Не заполнен' : 'Бюджет не заполнен');
  if (scope === 'dates') value = formatTripDetailDates(content.date_from, content.date_to) ?? 'Даты не указаны';
  if (scope === 'accommodation' && content.accommodations.length === 0) value = 'Проживание не указано';
  if (scope === 'transport' && content.transport.length === 0) value = 'Транспорт не указан';
  if (scope === 'route') value = content.route_stops.map((stop) => stop.place_label).join(' → ') || 'Маршрут не указан';
  if (scope?.startsWith('itinerary:day:')) {
    const day = content.days.find((item) => item.id === scope.slice('itinerary:day:'.length));
    value = day ? [day.title, ...day.events.map((event) => event.title)].filter(Boolean).join(' · ') || 'Событий нет' : 'День ещё не согласован';
  }
  if (scope === 'itinerary:all') {
    value = [content.route_stops.map((stop) => stop.place_label).join(' → '),
      content.days.length ? formatTripDayCount(content.days.length) : 'Согласованных дней пока нет.'].filter(Boolean).join(' · ');
  }
  if (parent) value = [`День ${parentIndex + 1}`, parent.title].filter(Boolean).join(' · ');
  if (parentId && !parent) value = 'Сначала согласуйте день целиком.';
  return <article className="trip-draft-editor__section"><h2>{title}</h2><p>{value}</p></article>;
}

function sectionState(label: string, current: unknown, confirmed: unknown, status?: TripDetailResponse['trip']['destination_status']): string {
  const currentValue = formatSectionValue(current);
  const confirmedValue = formatSectionValue(confirmed);
  const confirmation = status ? getConfirmationLabel(status) : JSON.stringify(current) === JSON.stringify(confirmed) ? 'Согласовано' : 'Не согласовано';
  return JSON.stringify(current) === JSON.stringify(confirmed)
    ? `${label}: ${confirmation} · ${confirmedValue}`
    : `${label}: ${confirmation}: ${confirmedValue} · В черновике: ${currentValue}`;
}

function getConfirmationLabel(status: TripDetailResponse['trip']['destination_status']): string {
  if (status === 'confirmed') return 'Согласовано';
  if (status === 'pending_analysis') return 'Проверяется';
  if (status === 'review_required') return 'Нужно пересмотреть';
  return 'Не заполнено';
}

function formatSectionValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.length > 0 ? formatProposalValue(value) : 'не указано';
  }
  if (typeof value === 'object' && value !== null) return formatProposalValue(value);
  return value === null || value === '' ? 'не указано' : String(value);
}

function createConfirmedContent(trip: TripDetailResponse, days: readonly TripItineraryDayResponse[]): TripDraftContent {
  return {
    route_stops: trip.route_stops.map(({ id, place_label, country_code, place_ref, stay_from, stay_to, notes }) => ({ id, place_label, country_code, place_ref, stay_from, stay_to, notes })),
    date_from: trip.trip.date_from,
    date_to: trip.trip.date_to,
    accommodations: trip.accommodations,
    transport: trip.transport,
    budget: { min: trip.trip.budget_min, max: trip.trip.budget_max, currency: trip.trip.budget_currency, scope: trip.trip.budget_scope },
    days: days.map((day) => ({
      id: day.id, date: day.day_date, title: day.title, notes: day.notes,
      events: day.events.map(({ id, kind, title, start_time, duration_minutes, address, estimated_cost, currency, notes }) => ({
        id, kind, title, start_time, duration_minutes, address, estimated_cost, currency, notes
      }))
    })),
    notes: ''
  };
}

function mergeConfirmedContent(draft: TripDraftContent, confirmed: TripDraftContent, allowInitialFallback: boolean): TripDraftContent {
  if (!allowInitialFallback) return draft;
  const hasDraftDates = draft.date_from !== null || draft.date_to !== null;
  const days = [...draft.days];
  for (const day of confirmed.days) {
    if (!days.some((item) => item.id === day.id)) days.push(day);
  }
  return {
    ...draft,
    route_stops: draft.route_stops.length > 0 ? draft.route_stops : confirmed.route_stops,
    date_from: hasDraftDates ? draft.date_from : confirmed.date_from,
    date_to: hasDraftDates ? draft.date_to : confirmed.date_to,
    accommodations: draft.accommodations.length > 0 ? draft.accommodations : confirmed.accommodations,
    transport: draft.transport.length > 0 ? draft.transport : confirmed.transport,
    budget: Object.values(draft.budget).some((value) => value !== null) ? draft.budget : confirmed.budget,
    days
  };
}

function DraftField({
  label,
  value,
  onChange,
  type = 'text',
  error,
  placeholder = type === 'text' || type === 'number' ? 'Не указано' : undefined
}: Readonly<{ label: string; value: string; onChange: (value: string) => void; type?: 'date' | 'datetime-local' | 'number' | 'text' | 'time'; error?: string; placeholder?: string }>) {
  const errorId = useId();
  const field = <label className="trip-draft-editor__field">
    <span>{label}</span><input className="profile-input" type={type} value={value} placeholder={placeholder}
      aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined}
      onChange={(event) => onChange(event.target.value)} />
  </label>;
  return error ? <div className="form-field-with-error">{field}<p id={errorId} className="profile-field-error">{error}</p></div> : field;
}

function toLocalDateTimeInput(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function toProposalSummary(proposal: TripProposalResponse): TripProposalSummaryResponse {
  return { ...proposal, scopes: proposal.operations.map((operation) => operation.scope) };
}

function isProposalScopeBusy(error: ApiError): boolean {
  if (typeof error.body !== 'object' || error.body === null || !('detail' in error.body)) return false;
  const detail = error.body.detail;
  return typeof detail === 'object' && detail !== null && 'code' in detail && detail.code === 'proposal_scope_busy';
}
