'use client';

import { useState, type ReactNode } from 'react';

import { ApiError, type BackendApiClient, type TripDraftAlternativeMetadataResponse, type TripDraftContent, type TripDraftResponse } from '@/lib/backend-api-client';

type TripDraftEditorProps = Readonly<{
  token: string;
  draft: TripDraftResponse;
  alternatives: readonly TripDraftAlternativeMetadataResponse[];
  api: Pick<BackendApiClient, 'getTripDraft' | 'getTripDraftAlternative' | 'saveTripDraft' | 'saveTripDraftAlternative'>;
  authorLabel: (userId: string) => string;
}>;

export function TripDraftEditor({ token, draft: initialDraft, alternatives: initialAlternatives, api, authorLabel }: TripDraftEditorProps) {
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
  const hasUnsavedChanges = JSON.stringify(content) !== JSON.stringify(savedContent);

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
          <p className="section-kicker">Общий рабочий черновик · версия {version}</p>
          <h3 id="trip-draft-title" className="trip-details__heading">Ещё не согласовано</h3>
          <p className="surface-card__copy">Изменения здесь не меняют подтверждённую поездку.</p>
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
      </DraftSection>

      <DraftSection title="Программа по дням">
        {content.days.map((day, dayIndex) => (
          <article className="trip-draft-editor__day" key={day.id}>
            <div className="trip-draft-editor__grid">
              <DraftField label={`День ${dayIndex + 1}`} type="date" value={day.date ?? ''} onChange={(date) => updateContent({ days: content.days.map((item) => item.id === day.id ? { ...item, date: date || null } : item) })} />
              <DraftField label="Название дня" value={day.title ?? ''} onChange={(title) => updateContent({ days: content.days.map((item) => item.id === day.id ? { ...item, title: title || null } : item) })} />
            </div>
            <DraftField label="Заметка о дне" value={day.notes ?? ''} onChange={(notes) => updateContent({ days: content.days.map((item) => item.id === day.id ? { ...item, notes: notes || null } : item) })} />
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
