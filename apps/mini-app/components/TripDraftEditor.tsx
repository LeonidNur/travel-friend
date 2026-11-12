'use client';

import { useCallback, useRef, useState, type ReactNode } from 'react';

import { ApiError, type BackendApiClient, type TripDraftAlternativeMetadataResponse, type TripDraftContent, type TripDraftResponse, type TripItineraryDayResponse, type TripProposalResponse, type TripProposalSummaryResponse } from '@/lib/backend-api-client';
import { getInlineProposalTitle, validateTripDraftForProposal } from '@/lib/trip-inline-editing';
import { getProposalStatusLabel } from '@/lib/trip-proposal-runtime';
import { TripProposalPanel } from '@/components/TripProposalPanel';

type TripDraftEditorProps = Readonly<{
  token: string;
  userId: string;
  draft: TripDraftResponse;
  alternatives: readonly TripDraftAlternativeMetadataResponse[];
  confirmedDays: readonly TripItineraryDayResponse[];
  api: Pick<BackendApiClient, 'getTripDraft' | 'getTripDraftAlternative' | 'saveTripDraft' | 'saveTripDraftAlternative' | 'getTripProposals' | 'getTripProposal' | 'createTripProposal' | 'voteTripProposal' | 'cancelTripProposal'>;
  authorLabel: (userId: string) => string;
  onProposalAccepted: () => void;
}>;

export function TripDraftEditor({ token, userId, draft: initialDraft, alternatives: initialAlternatives, confirmedDays, api, authorLabel, onProposalAccepted }: TripDraftEditorProps) {
  const [content, setContent] = useState<TripDraftContent>(initialDraft.content);
  const [savedContent, setSavedContent] = useState<TripDraftContent>(initialDraft.content);
  const [version, setVersion] = useState(initialDraft.version);
  const [updatedBy, setUpdatedBy] = useState(initialDraft.updated_by_user_id);
  const [alternatives, setAlternatives] = useState<readonly TripDraftAlternativeMetadataResponse[]>(initialAlternatives);
  const [alternativeTitle, setAlternativeTitle] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingAlternative, setIsSavingAlternative] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [hasConflict, setHasConflict] = useState(false);
  const [openingAlternativeId, setOpeningAlternativeId] = useState<string | null>(null);
  const [proposals, setProposals] = useState<TripProposalSummaryResponse[]>([]);
  const [proposalReloadSignal, setProposalReloadSignal] = useState(0);
  const pendingProposalRef = useRef<Readonly<{ scope: string; content: string; draftVersion: number; idempotencyKey: string }> | null>(null);
  const hasUnsavedChanges = JSON.stringify(content) !== JSON.stringify(savedContent);
  const mergeProposalList = useCallback((incoming: TripProposalSummaryResponse[]) => setProposals((current) => [
      ...incoming,
      ...current.filter((proposalItem) => !incoming.some((item) => item.id === proposalItem.id))
    ]), []);
  const hasActiveProposal = (scope: string) => proposals.some((proposal) =>
    (proposal.status === 'pending' || proposal.status === 'blocked') && proposal.scopes.some((proposalScope) => scopesOverlap(proposalScope, scope)));

  const save = async () => {
    setIsSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const saved = await api.saveTripDraft(token, initialDraft.trip_id, { base_version: version, content });
      setContent(saved.content);
      setSavedContent(saved.content);
      setVersion(saved.version);
      setUpdatedBy(saved.updated_by_user_id);
      setHasConflict(false);
      setSuccess('Черновик сохранён. Подтверждённая поездка не изменилась.');
    } catch (saveError) {
      setHasConflict(saveError instanceof ApiError && saveError.status === 409);
      setError(saveError instanceof ApiError && saveError.status === 409
        ? 'Черновик изменился у другого участника. Ваши правки сохранены на экране; загрузите актуальную версию, чтобы продолжить.'
        : 'Не удалось сохранить черновик. Ваши правки сохранены на экране; попробуйте ещё раз.');
    } finally {
      setIsSaving(false);
    }
  };

  const reload = async () => {
    setError(null);
    setSuccess(null);
    try {
      const latest = await api.getTripDraft(token, initialDraft.trip_id);
      setContent(latest.draft.content);
      setSavedContent(latest.draft.content);
      setVersion(latest.draft.version);
      setUpdatedBy(latest.draft.updated_by_user_id);
      setAlternatives(latest.alternatives);
      setHasConflict(false);
    } catch {
      setError('Не удалось загрузить актуальный черновик. Ваши правки пока остаются на экране.');
    }
  };

  const saveAlternative = async () => {
    setIsSavingAlternative(true);
    setError(null);
    setSuccess(null);
    try {
      const saved = await api.saveTripDraftAlternative(token, initialDraft.trip_id, alternativeTitle, content);
      setAlternatives((current) => [saved, ...current]);
      setAlternativeTitle('');
      setSuccess('Вариант сохранён отдельно и не изменил основной черновик.');
    } catch {
      setError('Не удалось сохранить вариант. Текущие правки остались на экране.');
    } finally {
      setIsSavingAlternative(false);
    }
  };

  const openAlternative = async (alternative: TripDraftAlternativeMetadataResponse) => {
    if (hasUnsavedChanges && !window.confirm('Заменить текущие несохранённые правки выбранным вариантом?')) return;
    setOpeningAlternativeId(alternative.id);
    setError(null);
    setSuccess(null);
    try {
      const snapshot = await api.getTripDraftAlternative(token, initialDraft.trip_id, alternative.id);
      setContent(snapshot.content);
      setSuccess('Вариант загружен в редактор. Сохраните черновик, чтобы сделать его новой основной версией.');
    } catch {
      setError('Не удалось загрузить вариант. Текущие правки остались на экране.');
    } finally {
      setOpeningAlternativeId(null);
    }
  };

  const updateContent = (patch: Partial<TripDraftContent>) => setContent((current) => ({ ...current, ...patch }));

  const propose = async (scope: string, label?: string) => {
    if (isSaving || isSavingAlternative || openingAlternativeId !== null) return;
    if (hasActiveProposal(scope)) {
      setError('По этой области уже идёт голосование. Откройте предложение рядом с пунктом поездки.');
      return;
    }
    setIsSaving(true);
    setError(null);
    setSuccess(null);
    const validationIssues = validateTripDraftForProposal(content, scope);
    if (validationIssues.length > 0) {
      setError(validationIssues.join(' '));
      setIsSaving(false);
      return;
    }

    const contentSnapshot = JSON.stringify(content);
    let retry = pendingProposalRef.current;
    let savedVersion = version;
    if (retry?.scope === scope && retry.content === contentSnapshot) {
      savedVersion = retry.draftVersion;
    } else {
      try {
        const saved = await api.saveTripDraft(token, initialDraft.trip_id, { base_version: version, content });
        savedVersion = saved.version;
        setContent(saved.content);
        setSavedContent(saved.content);
        setVersion(saved.version);
        setUpdatedBy(saved.updated_by_user_id);
        setHasConflict(false);
        retry = { scope, content: JSON.stringify(saved.content), draftVersion: saved.version, idempotencyKey: crypto.randomUUID() };
        pendingProposalRef.current = retry;
      } catch (saveError) {
        let currentDraft: TripDraftResponse | null = null;
        try { currentDraft = (await api.getTripDraft(token, initialDraft.trip_id)).draft; } catch { /* Preserve the edit and report the original save failure. */ }
        if (currentDraft !== null && JSON.stringify(currentDraft.content) === contentSnapshot) {
          savedVersion = currentDraft.version;
          setSavedContent(currentDraft.content);
          setVersion(currentDraft.version);
          setUpdatedBy(currentDraft.updated_by_user_id);
          retry = { scope, content: contentSnapshot, draftVersion: currentDraft.version, idempotencyKey: crypto.randomUUID() };
          pendingProposalRef.current = retry;
        } else {
          setHasConflict(saveError instanceof ApiError && saveError.status === 409);
          setError(saveError instanceof ApiError && saveError.status === 422
            ? `Черновик не прошёл проверку: ${saveError.message}`
            : saveError instanceof ApiError && saveError.status === 409
              ? 'Черновик изменился у другого участника. Ваши правки сохранены на экране. Загрузите актуальную версию и повторите.'
              : 'Не удалось сохранить черновик. Проверьте сеть и повторите; предложение ещё не создано.');
          setIsSaving(false);
          return;
        }
      }
    }

    if (retry === null) {
      setError('Не удалось подготовить предложение. Повторите действие.');
      setIsSaving(false);
      return;
    }
    try {
      const proposal = await api.createTripProposal(token, initialDraft.trip_id, {
        draft_version: savedVersion,
        title: getInlineProposalTitle(scope, label),
        idempotency_key: retry.idempotencyKey,
        scopes: [scope]
      });
      pendingProposalRef.current = null;
      setSuccess('Предложение отправлено участникам. Подтверждённая поездка изменится после единогласного принятия.');
      setProposals((current) => [toProposalSummary(proposal), ...current.filter((item) => item.id !== proposal.id)]);
      setProposalReloadSignal((current) => current + 1);
    } catch (proposalError) {
      if (proposalError instanceof ApiError && proposalError.status === 422) {
        pendingProposalRef.current = null;
        setError(`Предложение не прошло проверку: ${proposalError.message}`);
      } else if (proposalError instanceof ApiError && proposalError.status === 409) {
        pendingProposalRef.current = null;
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
    <section className="trip-draft-editor" aria-labelledby="trip-draft-title">
      <header className="trip-draft-editor__header">
        <div>
          <p className="section-kicker">Рабочая версия поездки · версия {version}</p>
          <h3 id="trip-draft-title" className="trip-details__heading">План поездки</h3>
          <p className="surface-card__copy">Правки сохраняются в рабочей версии. Участники увидят предложение и проголосуют перед обновлением согласованной поездки.</p>
          <p className="trip-draft-editor__byline">Последняя правка: {authorLabel(updatedBy)}</p>
        </div>
        <button className="profile-button profile-button--primary" type="button" disabled={isSaving} onClick={() => void save()}>
          {isSaving ? 'Сохраняем…' : 'Сохранить черновик'}
        </button>
      </header>

      {error ? <p role="alert" className="trip-draft-editor__message trip-draft-editor__message--error">{error}</p> : null}
      {success ? <p role="status" className="trip-draft-editor__message">{success}</p> : null}
      {hasConflict ? <button className="profile-button profile-button--secondary" type="button" onClick={() => void reload()}>Загрузить актуальную версию</button> : null}

      <fieldset className="trip-draft-editor__fields" disabled={isSaving || isSavingAlternative || openingAlternativeId !== null}>
      <DraftSection title="Маршрут и даты">
        <div className="trip-draft-editor__grid">
          <DraftField label="Начало поездки" type="date" value={content.date_from ?? ''} onChange={(value) => updateContent({ date_from: value || null })} />
          <DraftField label="Окончание поездки" type="date" value={content.date_to ?? ''} onChange={(value) => updateContent({ date_to: value || null })} />
        </div>
        {content.route_stops.map((stop, index) => (
          <div className="trip-draft-editor__item" key={stop.id}>
            <DraftField label={`Место ${index + 1}`} value={stop.place_label} onChange={(place_label) => updateContent({ route_stops: content.route_stops.map((item) => item.id === stop.id ? { ...item, place_label } : item) })} />
            <DraftField label="Прибытие" type="date" value={stop.stay_from ?? ''} onChange={(stay_from) => updateContent({ route_stops: content.route_stops.map((item) => item.id === stop.id ? { ...item, stay_from: stay_from || null } : item) })} />
            <DraftField label="Отъезд" type="date" value={stop.stay_to ?? ''} onChange={(stay_to) => updateContent({ route_stops: content.route_stops.map((item) => item.id === stop.id ? { ...item, stay_to: stay_to || null } : item) })} />
            <DraftField label="Заметка о месте" value={stop.notes ?? ''} onChange={(notes) => updateContent({ route_stops: content.route_stops.map((item) => item.id === stop.id ? { ...item, notes: notes || null } : item) })} />
            <button className="navigation-link" type="button" onClick={() => updateContent({ route_stops: content.route_stops.filter((item) => item.id !== stop.id) })}>Удалить место</button>
          </div>
        ))}
        <button className="profile-button profile-button--secondary" type="button" onClick={addRouteStop}>Добавить место</button>
        <ProposalLinks proposals={proposals} scope="route" />
        <button className="profile-button profile-button--secondary" type="button" disabled={isSaving || hasActiveProposal('route')} onClick={() => void propose('route')}>{isSaving ? 'Отправляем…' : 'Предложить маршрут'}</button>
        <ProposalLinks proposals={proposals} scope="dates" />
        <button className="profile-button profile-button--secondary" type="button" disabled={isSaving || hasActiveProposal('dates')} onClick={() => void propose('dates')}>Предложить даты</button>
      </DraftSection>

      <DraftSection title="Бюджет">
        <div className="trip-draft-editor__grid">
          <DraftField label="От" type="number" value={content.budget.min ?? ''} onChange={(value) => updateContent({ budget: { ...content.budget, min: value || null } })} />
          <DraftField label="До" type="number" value={content.budget.max ?? ''} onChange={(value) => updateContent({ budget: { ...content.budget, max: value || null } })} />
          <DraftField label="Валюта" value={content.budget.currency ?? ''} onChange={(value) => updateContent({ budget: { ...content.budget, currency: value || null } })} />
          <label className="trip-draft-editor__field">
            <span>Бюджет</span>
            <select className="profile-input" value={content.budget.scope ?? ''} onChange={(event) => updateContent({ budget: { ...content.budget, scope: event.target.value === '' ? null : event.target.value as 'per_person' | 'group_total' } })}>
              <option value="">Не указано</option><option value="per_person">На человека</option><option value="group_total">На группу</option>
            </select>
          </label>
        </div>
        <ProposalLinks proposals={proposals} scope="budget" />
        <button className="profile-button profile-button--secondary" type="button" disabled={isSaving || hasActiveProposal('budget')} onClick={() => void propose('budget')}>Предложить бюджет</button>
      </DraftSection>

      <DraftSection title="Проживание">
        {content.accommodations.map((stay, index) => (
          <div className="trip-draft-editor__item" key={stay.id}>
            <DraftField label={`Вариант ${index + 1}`} value={stay.name} onChange={(name) => updateContent({ accommodations: content.accommodations.map((item) => item.id === stay.id ? { ...item, name } : item) })} />
            <DraftField label="Место" value={stay.location ?? ''} onChange={(location) => updateContent({ accommodations: content.accommodations.map((item) => item.id === stay.id ? { ...item, location: location || null } : item) })} />
            <DraftField label="Заезд" type="date" value={stay.date_from ?? ''} onChange={(date_from) => updateContent({ accommodations: content.accommodations.map((item) => item.id === stay.id ? { ...item, date_from: date_from || null } : item) })} />
            <DraftField label="Выезд" type="date" value={stay.date_to ?? ''} onChange={(date_to) => updateContent({ accommodations: content.accommodations.map((item) => item.id === stay.id ? { ...item, date_to: date_to || null } : item) })} />
            <DraftField label="Заметка" value={stay.notes ?? ''} onChange={(notes) => updateContent({ accommodations: content.accommodations.map((item) => item.id === stay.id ? { ...item, notes: notes || null } : item) })} />
            <button className="navigation-link" type="button" onClick={() => updateContent({ accommodations: content.accommodations.filter((item) => item.id !== stay.id) })}>Удалить вариант</button>
          </div>
        ))}
        <button className="profile-button profile-button--secondary" type="button" onClick={addAccommodation}>Добавить проживание</button>
        <ProposalLinks proposals={proposals} scope="accommodation" />
        <button className="profile-button profile-button--secondary" type="button" disabled={isSaving || hasActiveProposal('accommodation')} onClick={() => void propose('accommodation')}>Предложить проживание</button>
      </DraftSection>

      <DraftSection title="Транспорт">
        {content.transport.map((leg, index) => (
          <div className="trip-draft-editor__item" key={leg.id}>
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
        <ProposalLinks proposals={proposals} scope="transport" />
        <button className="profile-button profile-button--secondary" type="button" disabled={isSaving || hasActiveProposal('transport')} onClick={() => void propose('transport')}>Предложить транспорт</button>
      </DraftSection>

      <DraftSection title="Программа по дням">
        {content.days.map((day, dayIndex) => (
          <article className="trip-draft-editor__day" key={day.id}>
            <div className="trip-draft-editor__grid">
              <DraftField label={`День ${dayIndex + 1}`} type="date" value={day.date ?? ''} onChange={(date) => updateContent({ days: content.days.map((item) => item.id === day.id ? { ...item, date: date || null } : item) })} />
              <DraftField label="Название дня" value={day.title ?? ''} onChange={(title) => updateContent({ days: content.days.map((item) => item.id === day.id ? { ...item, title: title || null } : item) })} />
            </div>
            <DraftField label="Заметка о дне" value={day.notes ?? ''} onChange={(notes) => updateContent({ days: content.days.map((item) => item.id === day.id ? { ...item, notes: notes || null } : item) })} />
            <ProposalLinks proposals={proposals} scope={`itinerary:day:${day.id}`} />
            <button className="profile-button profile-button--secondary" type="button" disabled={isSaving || hasActiveProposal(`itinerary:day:${day.id}`)} onClick={() => void propose(`itinerary:day:${day.id}`, day.title ?? `дня ${dayIndex + 1}`)}>Предложить изменение дня</button>
            {day.events.map((event, eventIndex) => (
              <div className="trip-draft-editor__item" key={event.id}>
                <DraftField label={`Событие ${eventIndex + 1}`} value={event.title} onChange={(title) => updateDayEvent(day.id, event.id, { title })} />
                <label className="trip-draft-editor__field">
                  <span>Тип</span>
                  <select className="profile-input" value={event.kind} onChange={(change) => updateDayEvent(day.id, event.id, { kind: change.target.value as TripDraftContent['days'][number]['events'][number]['kind'] })}>
                    <option value="activity">Занятие</option><option value="transport">Транспорт</option><option value="accommodation">Проживание</option><option value="meal">Питание</option><option value="note">Заметка</option><option value="other">Другое</option>
                  </select>
                </label>
                <DraftField label="Время" type="time" value={event.start_time ?? ''} onChange={(start_time) => updateDayEvent(day.id, event.id, { start_time: start_time || null })} />
                <DraftField label="Длительность, минут" type="number" value={event.duration_minutes === null ? '' : String(event.duration_minutes)} onChange={(value) => updateDayEvent(day.id, event.id, { duration_minutes: value ? Number(value) : null })} />
                <DraftField label="Адрес" value={event.address ?? ''} onChange={(address) => updateDayEvent(day.id, event.id, { address: address || null })} />
                <DraftField label="Расход" type="number" value={event.estimated_cost ?? ''} onChange={(estimated_cost) => updateDayEvent(day.id, event.id, { estimated_cost: estimated_cost || null })} />
                <DraftField label="Валюта расхода" value={event.currency ?? ''} onChange={(currency) => updateDayEvent(day.id, event.id, { currency: currency || null })} />
                <DraftField label="Заметка к событию" value={event.notes ?? ''} onChange={(notes) => updateDayEvent(day.id, event.id, { notes: notes || null })} />
                <ProposalLinks proposals={proposals} scope={`itinerary:event:${day.id}:${event.id}`} />
                <button className="profile-button profile-button--secondary" type="button" disabled={isSaving || hasActiveProposal(`itinerary:event:${day.id}:${event.id}`) || !confirmedDays.some((confirmedDay) => confirmedDay.id === day.id)} onClick={() => void propose(`itinerary:event:${day.id}:${event.id}`, event.title || `события в дне ${dayIndex + 1}`)}>Предложить событие</button>
                {!confirmedDays.some((confirmedDay) => confirmedDay.id === day.id) ? <p className="surface-card__copy">Сначала согласуйте день, чтобы предлагать изменение отдельного события.</p> : null}
                <button className="navigation-link" type="button" onClick={() => updateContent({ days: content.days.map((item) => item.id === day.id ? { ...item, events: item.events.filter((part) => part.id !== event.id) } : item) })}>Удалить событие</button>
              </div>
            ))}
            <div className="trip-draft-editor__actions">
              <button className="profile-button profile-button--secondary" type="button" onClick={() => updateContent({ days: content.days.map((item) => item.id === day.id ? { ...item, events: [...item.events, createEvent()] } : item) })}>Добавить событие</button>
              <button className="navigation-link" type="button" onClick={() => updateContent({ days: content.days.filter((item) => item.id !== day.id) })}>Удалить день</button>
            </div>
          </article>
        ))}
        <button className="profile-button profile-button--secondary" type="button" onClick={addDay}>Добавить день</button>
      </DraftSection>

      <DraftSection title="Общие заметки">
        <label className="trip-draft-editor__field"><span>Заметки</span>
          <textarea className="profile-input trip-draft-editor__textarea" value={content.notes} onChange={(event) => updateContent({ notes: event.target.value })} />
        </label>
      </DraftSection>

      <DraftSection title="Сохранённые альтернативы">
        <div className="trip-draft-editor__grid">
          <DraftField label="Название варианта" value={alternativeTitle} onChange={setAlternativeTitle} />
          <button className="profile-button profile-button--secondary" type="button" disabled={isSavingAlternative || !alternativeTitle.trim()} onClick={() => void saveAlternative()}>
            {isSavingAlternative ? 'Сохраняем…' : 'Сохранить вариант'}
          </button>
        </div>
        {alternatives.length === 0 ? <p className="surface-card__copy">Сохранённых вариантов пока нет.</p> : null}
        {alternatives.map((alternative) => (
          <article className="trip-draft-editor__alternative" key={alternative.id}>
            <p>{alternative.title} · {authorLabel(alternative.created_by_user_id)}</p>
            <button className="navigation-link" type="button" disabled={openingAlternativeId === alternative.id} onClick={() => void openAlternative(alternative)}>
              {openingAlternativeId === alternative.id ? 'Загружаем…' : 'Открыть в редакторе'}
            </button>
          </article>
        ))}
      </DraftSection>
      </fieldset>
      <TripProposalPanel token={token} userId={userId} tripId={initialDraft.trip_id} draftVersion={version} confirmedDays={confirmedDays}
        draftContent={content} savedContent={savedContent} api={api} participantLabel={authorLabel}
        onAccepted={onProposalAccepted} enableCreate={false} onProposalsChange={mergeProposalList} reloadSignal={proposalReloadSignal} />
    </section>
  );

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

function DraftSection({ title, children }: Readonly<{ title: string; children: ReactNode }>) {
  return <section className="trip-draft-editor__section"><h4>{title}</h4>{children}</section>;
}

function DraftField({
  label,
  value,
  onChange,
  type = 'text'
}: Readonly<{ label: string; value: string; onChange: (value: string) => void; type?: 'date' | 'datetime-local' | 'number' | 'text' | 'time' }>) {
  return <label className="trip-draft-editor__field"><span>{label}</span><input className="profile-input" type={type} value={value} onChange={(event) => onChange(event.target.value)} /></label>;
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

function ProposalLinks({ proposals, scope }: Readonly<{ proposals: readonly TripProposalSummaryResponse[]; scope: string }>) {
  const matching = proposals.filter((proposal) =>
    (proposal.status === 'pending' || proposal.status === 'blocked') && proposal.scopes.some((proposalScope) => scopesOverlap(proposalScope, scope)));
  if (matching.length === 0) return null;
  return <ul className="trip-inline-proposals" aria-label="Предложения по этому пункту">
    {matching.map((proposal) => <li key={proposal.id}>
      <a href={`#proposal-${proposal.id}`}>{proposal.title} · {getProposalStatusLabel(proposal.status)}</a>
    </li>)}
  </ul>;
}

function scopesOverlap(left: string, right: string): boolean {
  if (left === right) return true;
  if (left === 'itinerary:all') return right.startsWith('itinerary:day:') || right.startsWith('itinerary:event:');
  if (right === 'itinerary:all') return left.startsWith('itinerary:day:') || left.startsWith('itinerary:event:');
  const getDayId = (scope: string) => scope.startsWith('itinerary:day:')
    ? scope.slice('itinerary:day:'.length)
    : scope.startsWith('itinerary:event:') ? scope.split(':')[2] : null;
  const leftDayId = getDayId(left);
  const rightDayId = getDayId(right);
  return leftDayId !== null && leftDayId === rightDayId && (
    left.startsWith('itinerary:event:') || right.startsWith('itinerary:event:')
  );
}
