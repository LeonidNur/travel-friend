'use client';

import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';

import { ApiError, type BackendApiClient, type TripDetailResponse, type TripDraftAlternativeMetadataResponse, type TripDraftContent, type TripDraftResponse, type TripItineraryDayResponse, type TripProposalResponse, type TripProposalSummaryResponse } from '@/lib/backend-api-client';
import { buildDraftContentForScope, getDraftScopeSnapshot, getInlineProposalTitle, validateTripDraftForProposal } from '@/lib/trip-inline-editing';
import { TripProposalPanel } from '@/components/TripProposalPanel';
import { createConfirmedContent, formatTripBudget, formatTripDayCount, formatTripDetailDates, formatTripRouteStops, mergeConfirmedContent } from '@/lib/trip-detail-runtime';
import { formatRussianDate } from '@/lib/russian-date-format';
import { proposalScopesOverlap } from '@/lib/trip-proposal-placement';
import { ConfirmedScope, DraftField, DraftSection, scopeTitle, sectionState, toLocalDateTimeInput, type DraftNavigation } from '@/components/TripDraftFields';

export type TripDraftEditorHandle = Readonly<{ openFirstDay: () => void }>;

type DraftActionError = Readonly<{
  message: string;
  scope?: string;
  kind?: 'save' | 'validation' | 'proposal-response';
  snapshot?: string;
}>;

function formatSectionCount(items: readonly unknown[]) {
  return items.length ? `В списке: ${items.length}` : null;
}

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
  ref?: Ref<TripDraftEditorHandle>;
  onDraftSnapshot?: (content: TripDraftContent, version: number) => void;
  navigation?: DraftNavigation;
  isRefreshing?: boolean;
  confirmedItineraryNotice?: Readonly<{ failed: boolean; onRetry?: () => void }>;
}>;

export function TripDraftEditor({ token, userId, draft: initialDraft, trip, alternatives: initialAlternatives, confirmedDays, api, authorLabel, onProposalAccepted, ref, onDraftSnapshot, navigation, isRefreshing, confirmedItineraryNotice }: TripDraftEditorProps) {
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
  const sectionSelection = navigation?.view.screen === 'draft';
  const show = (target: string) => !navigation || scope === target;
  const dayNumber = scope?.startsWith('itinerary:day:')
    ? content.days.findIndex((day) => scope === `itinerary:day:${day.id}`) + 1 : 0;
  const [isReloading, setIsReloading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingAlternative, setIsSavingAlternative] = useState(false);
  const [actionError, setActionError] = useState<DraftActionError | null>(null);
  const setError = useCallback((message: string | null, context?: Omit<DraftActionError, 'message'>) => {
    setActionError(message ? { message, ...context } : null);
  }, []);
  const error = !scope || !actionError?.scope || actionError.scope === scope ? actionError?.message : null;
  const [success, setSuccess] = useState<string | null>(null);
  const [hasConflict, setHasConflict] = useState(false);
  const [confirmReload, setConfirmReload] = useState(false);
  const [openingAlternativeId, setOpeningAlternativeId] = useState<string | null>(null);
  const [proposals, setProposals] = useState<TripProposalSummaryResponse[]>([]);
  const [proposalReloadSignal, setProposalReloadSignal] = useState(0);
  const pendingProposals = useRef(new Map<string, Readonly<{ snapshot: string; draftVersion: number; idempotencyKey: string }>>());
  const proposalInFlightRef = useRef(false);
  const firstDayPendingId = useRef<string | null>(null);
  const hasUnsavedChanges = JSON.stringify(content) !== JSON.stringify(savedContent);
  const budgetIssue = scope === 'budget' ? validateTripDraftForProposal(content, 'budget')[0] : undefined;
  const budgetConflict = scope === 'budget' && hasConflict && !confirmedItineraryNotice
    && (!actionError?.scope || actionError.scope === 'budget');
  const budgetSnapshot = JSON.stringify(getDraftScopeSnapshot(content, 'budget'));
  const dirtyBudget = budgetSnapshot !== JSON.stringify(getDraftScopeSnapshot(savedContent, 'budget'));
  const budgetErrorKind = scope === 'budget' && actionError?.scope === 'budget' && actionError.snapshot === budgetSnapshot ? actionError.kind : undefined;
  const budgetHeading = budgetConflict ? 'Черновик обновился'
    : budgetIssue ? 'Проверьте бюджет'
    : isSaving ? 'Отправка изменения'
    : budgetErrorKind === 'save' ? 'Нет ответа при сохранении'
    : budgetErrorKind === 'validation' ? 'Проверка сервера'
    : budgetErrorKind === 'proposal-response' ? 'Ответ на предложение не получен'
    : dirtyBudget ? 'Локальные изменения' : undefined;
  const dirtyRoute = JSON.stringify(content.route_stops) !== JSON.stringify(savedContent.route_stops);
  const localRoute = content.route_stops.map((stop) => stop.place_label.trim()).filter(Boolean).join(' → ');
  const [dayId, eventId] = scope?.startsWith('itinerary:event:') ? scope.split(':').slice(2) : [];
  const confirmedEventTitle = eventId ? confirmedDays.find((day) => day.id === dayId)?.events.find((event) => event.id === eventId)?.title : undefined;
  const draftEventDayIndex = dayId ? content.days.findIndex((day) => day.id === dayId) : -1;
  const draftEventDay = content.days[draftEventDayIndex];
  const unconfirmedEvent = draftEventDay && !confirmedDays.some((day) => day.id === dayId)
    ? draftEventDay.events.find((event) => event.id === eventId) : undefined;
  const fieldsDisabled = Boolean(confirmedItineraryNotice) || Boolean(isRefreshing) || isSaving || isReloading || isSavingAlternative || openingAlternativeId !== null;
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
      onDraftSnapshot?.(latest.draft.content, latest.draft.version);
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
  }, [confirmedContent, confirmedItineraryNotice, hasUnsavedChanges, initialContent, initialDraft, savedContent, setError, version]);

  const propose = async (scope: string, label?: string) => {
    if (proposalInFlightRef.current || isSaving || isSavingAlternative || openingAlternativeId !== null) return;
    if (hasActiveProposal(scope)) {
      setError('По этой области уже идёт голосование. Откройте предложение рядом с пунктом поездки.', { scope });
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
      setError(validationIssues.join(' '), { scope });
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
        onDraftSnapshot?.(saved.content, saved.version);
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
          onDraftSnapshot?.(currentDraft.content, currentDraft.version);
          retry = { snapshot: scopeSnapshot, draftVersion: currentDraft.version, idempotencyKey: crypto.randomUUID() };
          pendingProposals.current.set(scope, retry);
        } else {
          const rejected = saveError instanceof ApiError && saveError.status === 422;
          const conflict = saveError instanceof ApiError && saveError.status === 409;
          setHasConflict(conflict);
          setError(rejected
            ? `Черновик не прошёл проверку: ${saveError.message}`
            : conflict
              ? 'Черновик изменился у другого участника. Ваши правки сохранены на экране. Загрузите актуальную версию и повторите.'
              : 'Не удалось сохранить черновик. Проверьте сеть и повторите; предложение ещё не создано.',
          { scope, snapshot: scopeSnapshot, kind: rejected ? 'validation' : conflict ? undefined : 'save' });
          setIsSaving(false);
          proposalInFlightRef.current = false;
          return;
        }
      }
    }

    if (!retry) {
      setError('Не удалось подготовить предложение. Повторите действие.', { scope });
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
        setError(`Предложение не прошло проверку: ${proposalError.message}`, { scope, snapshot: scopeSnapshot, kind: 'validation' });
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
            : 'По этой области уже идёт голосование. Обновите список предложений и откройте его там.', { scope });
        } else {
          setHasConflict(true);
          setError('Версия поездки или согласованные данные изменились. Загрузите актуальную версию, проверьте свои правки и создайте новое предложение.', { scope });
        }
      } else {
        setError('Черновик сохранён, но ответ на создание предложения не получен. Повторите это же действие: голосование не будет продублировано.',
          { scope, snapshot: scopeSnapshot, kind: 'proposal-response' });
      }
    } finally {
      setIsSaving(false);
      proposalInFlightRef.current = false;
    }
  };

  const addDay = () => updateContent({ days: [...content.days, createDay(crypto.randomUUID())] });
  useEffect(() => { firstDayPendingId.current = null; }, [content.days]);
  useImperativeHandle(ref, () => ({
    openFirstDay() {
      if (!navigation || fieldsDisabled) return;
      const firstDay = content.days[0];
      if (!firstDay && firstDayPendingId.current) return;
      const id = firstDay?.id ?? crypto.randomUUID();
      if (!firstDay) {
        firstDayPendingId.current = id;
        setContent((current) => ({ ...current, days: [...current.days, createDay(id)] }));
      }
      navigation.navigate({ screen: 'edit', scope: `itinerary:day:${id}` });
    }
  }), [content.days, fieldsDisabled, navigation]);
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
  const returnToProgram = () => {
    if (!navigation || navigation.view.screen === 'program') return;
    if (navigation.toProgram) navigation.toProgram();
    else if (navigation.backLabel === 'К программе') navigation.back();
    else navigation.navigate({ screen: 'program' });
  };
  const itineraryNotice = confirmedItineraryNotice ? <article className="trip-draft-editor__section">
    <p role={confirmedItineraryNotice.failed ? 'alert' : 'status'}>{confirmedItineraryNotice.failed
      ? 'Не удалось загрузить согласованную программу. Правки доступны после повторной загрузки.' : 'Загружаем согласованную программу…'}</p>
    {confirmedItineraryNotice.failed && confirmedItineraryNotice.onRetry ?
      <button className="profile-button profile-button--secondary" type="button" onClick={confirmedItineraryNotice.onRetry}>Повторить загрузку программы</button> : null}
  </article> : null;
  const conflictRecovery = hasConflict && !confirmedItineraryNotice && !budgetConflict ? (confirmReload ?
    <article className="trip-draft-editor__section">
      <h2>Заменить локальные правки?</h2>
      <p>При успешной загрузке актуальная версия заменит несохранённые поля.</p>
      <button className="profile-button profile-button--primary" type="button" onClick={() => void reload()}>Загрузить и заменить</button>
      <button className="profile-button profile-button--secondary" type="button" onClick={() => setConfirmReload(false)}>Оставить текущие правки</button>
    </article> :
    <button className="profile-button profile-button--secondary" type="button" disabled={isReloading} onClick={requestDraftReload}>
      {isReloading ? 'Загружаем актуальную версию…' : 'Загрузить актуальную версию'}
    </button>) : null;

  return (
    <TripProposalPanel token={token} userId={userId} tripId={initialDraft.trip_id}
      api={api} participantLabel={authorLabel} onAccepted={onProposalAccepted}
      onProposalsChange={mergeProposalList} externallyKnownProposals={proposals} reloadSignal={proposalReloadSignal}
      focusedProposalId={navigation?.focusedProposalId} onOpenProposal={navigation?.openProposal} onCloseProposal={navigation?.closeProposal}
      onOpenProgram={navigation ? () => {
        navigation.closeProposal();
        returnToProgram();
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
        {proposalHistory}
        <button className="profile-button profile-button--secondary" type="button" onClick={navigation.back}>Свернуть историю</button>
        <button className="profile-button profile-button--secondary" type="button" onClick={returnToProgram}>К программе</button>
      </section>
    ) : sentProposal?.operations[0]?.scope === 'budget' && dirtyRoute && navigation?.view.screen === 'edit' ? (
      <section className="trip-draft-editor trip-workspace-editor">
        <h1>Рабочий черновик</h1>
        <article className="trip-draft-editor__section" role="status">
          <h2>Бюджет отправлен на голосование</h2>
          <p>{formatTripBudget(confirmedContent.budget)
            ? <>Согласованный бюджет: {formatTripBudget(confirmedContent.budget)}.</>
            : 'Согласованный бюджет пока не заполнен.'}<br />Предложение находится рядом с бюджетом.</p>
        </article>
        {itineraryNotice}
        {conflictRecovery}
        <fieldset className="trip-draft-editor__fields" disabled={fieldsDisabled}>
          <article className="trip-draft-editor__section">
            <h2>Маршрут · локальная правка</h2>
            {renderRouteStops(false)}
            <p>Эти правки остались здесь. Они не вошли в предложение бюджета.</p>
            {actionError?.scope === 'route' ? <p role="alert">{actionError.message}</p> : null}
            {renderProposalAtScope('route')}
            <button className="profile-button profile-button--primary" type="button" disabled={hasActiveProposal('route')}
              onClick={() => void propose('route')}>{isSaving ? 'Сохраняем и отправляем…' : 'Предложить маршрут'}</button>
          </article>
        </fieldset>
        <button className="profile-button profile-button--secondary" type="button" onClick={() => {
          navigation.openProposal(sentProposal.id);
          setSentProposal(null);
          setSuccess(null);
        }}>Открыть предложение бюджета</button>
        <button className="profile-button profile-button--secondary" type="button" onClick={() => {
          setSentProposal(null);
          setSuccess(null);
          navigation.navigate({ screen: 'alternatives' });
        }}>Сохранённые варианты</button>
        <button className="profile-button profile-button--secondary" type="button" onClick={() => {
          setSentProposal(null);
          setSuccess(null);
          returnToProgram();
        }}>К программе</button>
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
    ) : unconfirmedEvent && draftEventDay && navigation ? (
      <section className="trip-draft-editor trip-workspace-editor">
        <h1>День {draftEventDayIndex + 1} · черновик</h1>
        {itineraryNotice}
        {conflictRecovery}
        <fieldset className="trip-draft-editor__fields" disabled={fieldsDisabled}>
          <article className="trip-draft-editor__section">
            <h2>Сначала согласуйте день</h2>
            <p>Новый день ещё не принят участниками. Его события можно предложить вместе с днём.</p>
            <div className="trip-workspace-editor__rows">
              <DraftField label="Событие" value={unconfirmedEvent.title}
                onChange={(title) => updateDayEvent(draftEventDay.id, unconfirmedEvent.id, { title })} />
              <DraftField label="Время" type="time" value={unconfirmedEvent.start_time ?? ''}
                onChange={(start_time) => updateDayEvent(draftEventDay.id, unconfirmedEvent.id, { start_time: start_time || null })} />
            </div>
            {renderProposalAtScope(`itinerary:day:${draftEventDay.id}`)}
            {actionError ? <p role="alert">{actionError.message}</p> : null}
            <button className="profile-button profile-button--primary" type="button" disabled>Предложить событие</button>
            <button className="profile-button profile-button--primary" type="button" disabled={hasActiveProposal(`itinerary:day:${draftEventDay.id}`)}
              onClick={() => void propose(`itinerary:day:${draftEventDay.id}`, draftEventDay.title ?? `дня ${draftEventDayIndex + 1}`)}>
              {isSaving ? 'Сохраняем и отправляем…' : 'Предложить изменение дня'}
            </button>
          </article>
        </fieldset>
        <button className="profile-button profile-button--secondary" type="button" onClick={returnToProgram}>К программе</button>
        <fieldset className="trip-draft-editor__fields" disabled={fieldsDisabled}>
          <details className="trip-workspace-editor__extra">
            <summary>Детали события</summary>
            <div className="trip-draft-editor__section trip-workspace-editor__rows">
              {renderEventDetails(draftEventDay.id, unconfirmedEvent, false)}
              {removeEventButton(draftEventDay.id, unconfirmedEvent.id)}
            </div>
          </details>
        </fieldset>
        {navigation.backLabel !== 'К программе' ? <button className="trip-workspace-editor__day-link" type="button" onClick={navigation.back}>{navigation.backLabel ?? 'Назад'}</button> : null}
      </section>
    ) : (
    <section className={navigation ? 'trip-draft-editor trip-workspace-editor' : 'trip-draft-editor'} aria-labelledby="trip-draft-title">
      {navigation ? <>
        <h1 id="trip-draft-title">{scope ? `${dayNumber ? `День ${dayNumber}` : scopeTitle(scope)} · изменение` : navigation.view.screen === 'alternatives' ? 'Сохранённые варианты' : 'Общий черновик'}</h1>
        {scope ? <ConfirmedScope scope={scope} content={confirmedContent} /> : null}
        {navigation.view.screen === 'alternatives' && alternativeError !== 'save' ? <article className="trip-draft-editor__section">
          <h2>Общий черновик · версия {version}</h2>
          <p>Последняя правка: {authorLabel(updatedBy)}<br />Согласованный план не изменён.</p>
        </article> : (scope === 'budget' || sectionSelection) ?
          <p className="trip-draft-editor__byline">{sectionSelection ? 'Версия' : 'Общий черновик · версия'} {version} · правка: {authorLabel(updatedBy)}</p> : null}
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
      {itineraryNotice}
      {conflictRecovery}
      {isSaving && scope !== 'budget' ? <p role="status" className="trip-draft-editor__byline">Отправляем предложение…</p> : null}

      {alternativeError === 'open' && (!navigation || navigation.view.screen === 'alternatives') ?
        <p role="alert" className="trip-draft-editor__message trip-draft-editor__message--error">Не удалось загрузить вариант. Текущие правки остались на экране.</p> : null}
      <fieldset className="trip-draft-editor__fields" disabled={fieldsDisabled}>
      <DraftSection title="Маршрут и даты" navigation={navigation} scope="route" alternateScope="dates" open={hasActiveProposal('route') || hasActiveProposal('dates')}
        summary={[
          sectionState('Маршрут', content.route_stops, confirmedContent.route_stops, trip.trip.destination_status, sectionSelection ? formatTripRouteStops : undefined),
          sectionState('Даты', [content.date_from, content.date_to], [confirmedContent.date_from, confirmedContent.date_to],
            trip.trip.dates_status, sectionSelection ? ([from, to]) => formatTripDetailDates(from, to) : undefined)
        ].join(' · ')}>
        {show('dates') ? <>
        <div className="trip-workspace-editor__rows">
          <DraftField label={navigation ? 'Начало' : 'Начало поездки'} type="date" value={content.date_from ?? ''} onChange={(value) => updateContent({ date_from: value || null })} />
          <DraftField label={navigation ? 'Окончание' : 'Окончание поездки'} type="date" value={content.date_to ?? ''} onChange={(value) => updateContent({ date_to: value || null })} />
        </div>
        {renderProposalAtScope('dates')}
        <button className="profile-button profile-button--primary" type="button" disabled={isSaving || hasActiveProposal('dates')} onClick={() => void propose('dates')}>Предложить даты</button>
        </> : null}
        {show('route') ? <>
        {renderRouteStops()}
        <button className="profile-button profile-button--secondary" type="button" onClick={addRouteStop}>Добавить место</button>
        {renderProposalAtScope('route')}
        <button className="profile-button profile-button--primary" type="button" disabled={isSaving || hasActiveProposal('route')} onClick={() => void propose('route')}>{isSaving ? 'Отправляем…' : 'Предложить маршрут'}</button>
        </> : null}
      </DraftSection>

      <DraftSection title="Бюджет"
        editHeading={budgetHeading}
        navigation={navigation} scope="budget" open={hasActiveProposal('budget')}
        summary={sectionState(sectionSelection ? '' : 'Бюджет', content.budget, confirmedContent.budget, trip.trip.budget_status, sectionSelection ? formatTripBudget : undefined)}>
        <div className="trip-workspace-editor__rows trip-workspace-editor__budget-fields">
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
        <button className="profile-button profile-button--primary" type="button" disabled={isSaving || hasActiveProposal('budget') || Boolean(budgetIssue) || budgetConflict} onClick={() => void propose('budget')}>
          {isSaving ? 'Сохраняем и отправляем…' : budgetErrorKind === 'proposal-response' ? 'Повторить отправку' : 'Предложить бюджет'}
        </button>

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

      <DraftSection title="Проживание" navigation={navigation} scope="accommodation" open={hasActiveProposal('accommodation')}
        summary={sectionState(sectionSelection ? '' : 'Проживание', content.accommodations, confirmedContent.accommodations, undefined, sectionSelection ? formatSectionCount : undefined)}>
        {content.accommodations.map((stay, index) => (
          <div className="trip-draft-editor__item trip-workspace-editor__rows" key={stay.id} role="group" aria-label={`Проживание ${index + 1}`}>
            <DraftField label={navigation ? 'Название' : `Вариант ${index + 1}`} value={stay.name} onChange={(name) => updateContent({ accommodations: content.accommodations.map((item) => item.id === stay.id ? { ...item, name } : item) })} />
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

      <DraftSection title="Транспорт" navigation={navigation} scope="transport" open={hasActiveProposal('transport')}
        summary={sectionState(sectionSelection ? '' : 'Транспорт', content.transport, confirmedContent.transport, trip.trip.transport_status, sectionSelection ? formatSectionCount : undefined)}>
        {content.transport.map((leg, index) => (
          <div className="trip-draft-editor__item trip-workspace-editor__rows" key={leg.id} role="group" aria-label={`Перемещение ${index + 1}`}>
            <DraftField label={navigation ? 'Вид' : `Способ · перемещение ${index + 1}`} value={leg.mode} onChange={(mode) => updateContent({ transport: content.transport.map((item) => item.id === leg.id ? { ...item, mode } : item) })} />
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

      <DraftSection title="Программа по дням" navigation={navigation} scope="itinerary:all"
        open={hasActiveProposal('itinerary:all') || content.days.some((day) => hasActiveProposal(`itinerary:day:${day.id}`) || day.events.some((event) => hasActiveProposal(`itinerary:event:${day.id}:${event.id}`)))}
        editHeading={confirmedEventTitle}
        summary={sectionState(sectionSelection ? '' : 'Программа', content.days, confirmedContent.days, undefined, sectionSelection ? (days) => days.length ? formatTripDayCount(days.length) : null : undefined)}>
        {show('itinerary:all') ? <>
        {renderProposalAtScope('itinerary:all')}
        </> : null}
        {scope?.startsWith('itinerary:') && scope !== 'itinerary:all' && !content.days.some((day) => scope === `itinerary:day:${day.id}` || day.events.some((event) => scope === `itinerary:event:${day.id}:${event.id}`)) ? (
          <>
            <p>Этого пункта нет в рабочем черновике. Согласованная программа остаётся прежней.</p>
            {navigation ? <button className="profile-button profile-button--secondary" type="button"
              onClick={() => navigation.navigate({ screen: 'edit', scope: 'itinerary:all' })}>Открыть программу в черновике</button> : null}
          </>
        ) : null}
        {content.days.map((day, dayIndex) => {
          const dayScope = `itinerary:day:${day.id}`;
          if (navigation && scope === 'itinerary:all') return <button key={day.id} className="trip-workspace-editor__day-link" type="button"
            onClick={() => navigation.navigate({ screen: 'edit', scope: dayScope })}>День {dayIndex + 1}{day.title ? ` · ${day.title}` : ''}</button>;
          if (navigation && scope !== dayScope && !day.events.some((event) => scope === `itinerary:event:${day.id}:${event.id}`)) return null;
          return <div className="trip-draft-editor__day trip-workspace-editor__rows" key={day.id}>
            {show(dayScope) ? <>
            <DraftField label="Название дня" value={day.title ?? ''} onChange={(title) => updateContent({ days: content.days.map((item) => item.id === day.id ? { ...item, title: title || null } : item) })} />
            <DraftField label={navigation ? 'Дата' : `День ${dayIndex + 1}`} type="date" value={day.date ?? ''} onChange={(date) => updateContent({ days: content.days.map((item) => item.id === day.id ? { ...item, date: date || null } : item) })} />
            <DraftField label={navigation ? 'Заметка' : 'Заметка о дне'} value={day.notes ?? ''} onChange={(notes) => updateContent({ days: content.days.map((item) => item.id === day.id ? { ...item, notes: notes || null } : item) })} />
            </> : null}
            {day.events.map((event, eventIndex) => {
              const eventScope = `itinerary:event:${day.id}:${event.id}`;
              if (navigation && scope === dayScope) return <button key={event.id} className="profile-button profile-button--secondary" type="button"
                onClick={() => navigation.navigate({ screen: 'edit', scope: eventScope })}>{event.title || `Событие ${eventIndex + 1}`}</button>;
              if (navigation && scope !== eventScope) return null;
              return <div className="trip-draft-editor__item trip-workspace-editor__rows" key={event.id}>
                <DraftField label={navigation ? 'Название' : `Событие ${eventIndex + 1}`} value={event.title} onChange={(title) => updateDayEvent(day.id, event.id, { title })} />
                {renderEventDetails(day.id, event)}
                {renderProposalAtScope(`itinerary:event:${day.id}:${event.id}`)}
                <button className="profile-button profile-button--primary" type="button" disabled={isSaving || hasActiveProposal(`itinerary:event:${day.id}:${event.id}`) || !confirmedDays.some((confirmedDay) => confirmedDay.id === day.id)} onClick={() => void propose(`itinerary:event:${day.id}:${event.id}`, event.title || `события в дне ${dayIndex + 1}`)}>Предложить событие</button>
                {!confirmedDays.some((confirmedDay) => confirmedDay.id === day.id) ? <p className="surface-card__copy">Сначала согласуйте день, чтобы предлагать изменение отдельного события.</p> : null}
                {removeEventButton(day.id, event.id)}
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
      {scope === 'budget' && dirtyRoute ? <p className="trip-draft-editor__byline">
        Маршрут тоже изменён локально{localRoute ? `: ${localRoute}` : ''}. Он не попадёт в предложение бюджета и останется в редакторе.
      </p> : null}
      {dayNumber ? <p className="trip-draft-editor__byline">День может остаться свободным. Для нового дня сначала согласуйте его целиком.</p> : null}
      {navigation ? <button className="profile-button profile-button--secondary trip-workspace-editor__back" type="button" onClick={
        navigation.view.screen === 'alternatives' && alternativeError === 'save' ? returnToProgram : navigation.back
      }>
        {navigation.view.screen === 'alternatives' && alternativeError === 'save' ? 'К программе' : navigation.backLabel ?? 'Назад'}
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

  function renderRouteStops(withDetails = true) {
    return content.route_stops.map((stop, index) => {
      const updateStop = (patch: Partial<typeof stop>) => updateContent({
        route_stops: content.route_stops.map((item) => item.id === stop.id ? { ...item, ...patch } : item)
      });
      const details = withDetails ? <>
        <DraftField label="Прибытие" type="date" value={stop.stay_from ?? ''} onChange={(stay_from) => updateStop({ stay_from: stay_from || null })} />
        <DraftField label="Отъезд" type="date" value={stop.stay_to ?? ''} onChange={(stay_to) => updateStop({ stay_to: stay_to || null })} />
        <DraftField label="Заметка о месте" value={stop.notes ?? ''} onChange={(notes) => updateStop({ notes: notes || null })} />
        <button className="navigation-link" type="button" onClick={() => updateContent({
          route_stops: content.route_stops.filter((item) => item.id !== stop.id)
        })}>Удалить место</button>
      </> : null;
      return <div className="trip-draft-editor__item trip-workspace-editor__rows" key={stop.id}>
        <DraftField label={`Место ${index + 1}`} value={stop.place_label} onChange={(place_label) => updateStop({ place_label })} />
        {details && navigation ? <details className="trip-workspace-editor__extra">
          <summary>Детали места {index + 1}</summary>
          <div className="trip-workspace-editor__rows">{details}</div>
        </details> : details}
      </div>;
    });
  }

  function renderAlternatives() {
    return <>
        {alternatives.length === 0 ? <article className="trip-draft-editor__alternative"><h2>Сохранённых вариантов пока нет</h2><p>Здесь появятся сохранённые вами варианты.</p></article> : null}
        {alternatives.map((alternative) => (
          <article className="trip-draft-editor__alternative" key={alternative.id}>
            <h2>{alternative.title}</h2>
            <p>Автор: {[authorLabel(alternative.created_by_user_id), formatRussianDate(alternative.created_at.slice(0, 10))].filter(Boolean).join(' · ')}<br />Сохранённая альтернатива, не согласованный план.</p>
            <button className="profile-button profile-button--secondary" type="button" disabled={openingAlternativeId === alternative.id} onClick={() => { if (hasUnsavedChanges) setAlternativeToConfirm(alternative); else void openAlternative(alternative); }}>
              {openingAlternativeId === alternative.id ? 'Загружаем…' : 'Открыть в редакторе'}
            </button>
          </article>
        ))}
    </>;
  }

  function renderEventDetails(dayId: string, event: ReturnType<typeof createEvent>, includeTime = true) {
    return <>
      <label className="trip-draft-editor__field">
        <span>Тип</span>
        <select className="profile-input" value={event.kind} onChange={(change) => updateDayEvent(dayId, event.id, { kind: change.target.value as typeof event.kind })}>
          <option value="activity">Занятие</option><option value="transport">Транспорт</option><option value="accommodation">Проживание</option><option value="meal">Питание</option><option value="note">Заметка</option><option value="other">Другое</option>
        </select>
      </label>
      {includeTime ? <DraftField label="Время" type="time" value={event.start_time ?? ''}
        onChange={(start_time) => updateDayEvent(dayId, event.id, { start_time: start_time || null })} /> : null}
      <DraftField label={navigation ? 'Длительность, мин.' : 'Длительность, минут'} type="number" value={event.duration_minutes === null ? '' : String(event.duration_minutes)} onChange={(value) => updateDayEvent(dayId, event.id, { duration_minutes: value ? Number(value) : null })} />
      <DraftField label="Адрес" value={event.address ?? ''} onChange={(address) => updateDayEvent(dayId, event.id, { address: address || null })} />
      <DraftField label="Расход" type="number" value={event.estimated_cost ?? ''} onChange={(estimated_cost) => updateDayEvent(dayId, event.id, { estimated_cost: estimated_cost || null })} />
      <DraftField label="Валюта расхода" value={event.currency ?? ''} onChange={(currency) => updateDayEvent(dayId, event.id, { currency: currency || null })} />
      <DraftField label={navigation ? 'Заметка' : 'Заметка к событию'} value={event.notes ?? ''} onChange={(notes) => updateDayEvent(dayId, event.id, { notes: notes || null })} />
    </>;
  }

  function removeEventButton(dayId: string, eventId: string) {
    return <button className="navigation-link" type="button" onClick={() => updateContent({
      days: content.days.map((day) => day.id === dayId ? { ...day, events: day.events.filter((event) => event.id !== eventId) } : day)
    })}>Удалить событие</button>;
  }

  function updateDayEvent(dayId: string, eventId: string, patch: Partial<TripDraftContent['days'][number]['events'][number]>) {
    updateContent({ days: content.days.map((day) => day.id === dayId
      ? { ...day, events: day.events.map((event) => event.id === eventId ? { ...event, ...patch } : event) }
      : day) });
  }
}

function createDay(id: string): TripDraftContent['days'][number] {
  return { id, date: null, title: null, notes: null, events: [] };
}

function createEvent(): TripDraftContent['days'][number]['events'][number] {
  return {
    id: crypto.randomUUID(), kind: 'activity', title: '', start_time: null,
    duration_minutes: null, address: null, estimated_cost: null, currency: null, notes: null
  };
}

function toProposalSummary(proposal: TripProposalResponse): TripProposalSummaryResponse {
  return { ...proposal, scopes: proposal.operations.map((operation) => operation.scope) };
}

function isProposalScopeBusy(error: ApiError): boolean {
  if (typeof error.body !== 'object' || error.body === null || !('detail' in error.body)) return false;
  const detail = error.body.detail;
  return typeof detail === 'object' && detail !== null && 'code' in detail && detail.code === 'proposal_scope_busy';
}
