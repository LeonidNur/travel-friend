'use client';

import { useId, type ReactNode } from 'react';

import type { TripDetailResponse, TripDraftContent } from '@/lib/backend-api-client';
import { areTripDraftValuesEqual, formatTripBudget, formatTripDayCount, formatTripDetailDates } from '@/lib/trip-detail-runtime';
import { formatProposalValue, getDraftScopeSnapshot } from '@/lib/trip-inline-editing';
import type { TripView } from '@/components/TripWorkspace';

export type DraftNavigation = Readonly<{
  view: TripView;
  navigate: (view: TripView) => void;
  back: () => void;
  backLabel?: string;
  toProgram?: () => void;
  focusedProposalId: string | null;
  openProposal: (id: string) => void;
  closeProposal: () => void;
}>;

export function DraftSection({ title, summary, open = false, children, navigation, scope, alternateScope, editHeading }: Readonly<{
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

export function scopeTitle(scope: string): string {
  if (scope.startsWith('itinerary:day:')) return 'День';
  if (scope.startsWith('itinerary:event:')) return 'Событие';
  return ({
    route: 'Маршрут', dates: 'Даты', budget: 'Бюджет', accommodation: 'Проживание',
    transport: 'Транспорт', 'itinerary:all': 'Программа', notes: 'Заметки'
  } as Record<string, string>)[scope] ?? 'Раздел поездки';
}

export function ConfirmedScope({ scope, content, voting }: Readonly<{ scope?: string; content: TripDraftContent; voting?: boolean }>) {
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

export function sectionState<T>(label: string, current: T, confirmed: T, status?: TripDetailResponse['trip']['destination_status'], formatCompact?: (value: T) => string | null): string {
  if (formatCompact) {
    const confirmedValue = formatCompact(confirmed);
    const currentValue = formatCompact(current);
    const state = status ? getConfirmationLabel(status) : confirmedValue ? 'Согласовано' : 'Не заполнено';
    const summary = `${label ? `${label}: ` : ''}${state}${confirmedValue ? ` · ${confirmedValue}` : ''}`;
    if (areTripDraftValuesEqual(current, confirmed)) return summary;
    return `${summary} · ${currentValue === confirmedValue ? 'Есть правки в черновике' : `В черновике: ${currentValue || 'не указано'}`}`;
  }
  const same = JSON.stringify(current) === JSON.stringify(confirmed);
  const currentValue = formatSectionValue(current);
  const confirmedValue = formatSectionValue(confirmed);
  const confirmation = status ? getConfirmationLabel(status) : same ? 'Согласовано' : 'Не согласовано';
  return same
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

export function DraftField({
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

export function toLocalDateTimeInput(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
