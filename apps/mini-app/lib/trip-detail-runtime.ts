import type { TripDetailResponse, TripDraftContent, TripDraftDay, TripDraftResponse, TripItineraryDayResponse } from './backend-api-client';
import { formatRussianDateRange } from './russian-date-format';
import { getDraftScopeSnapshot } from './trip-inline-editing';

export type PersistedTripStatus = 'forming' | 'active' | 'completed' | 'cancelled';
export type PersistedBudgetScope = 'per_person' | 'group_total';

type TripDetailScreenInput = Readonly<{
  isLoading: boolean;
  hasError: boolean;
  errorStatus: number | null;
  detail: unknown | null;
}>;

export type TripDetailScreenState = 'loading' | 'error' | 'not_found' | 'success';

const TRIP_STATUS_LABELS: Record<PersistedTripStatus, string> = {
  forming: 'Формируется',
  active: 'Активна',
  completed: 'Завершена',
  cancelled: 'Отменена'
};

const BUDGET_SCOPE_LABELS: Record<PersistedBudgetScope, string> = {
  per_person: 'на человека',
  group_total: 'на группу'
};

export function getTripDetailScreenState({
  isLoading,
  hasError,
  errorStatus,
  detail
}: TripDetailScreenInput): TripDetailScreenState {
  if (isLoading) {
    return 'loading';
  }

  if (hasError) {
    return errorStatus === 404 ? 'not_found' : 'error';
  }

  return detail === null ? 'error' : 'success';
}

export function formatTripRouteStops(stops: ReadonlyArray<Readonly<{ place_label: string }>>): string | null {
  const labels = stops.map((stop) => stop.place_label.trim()).filter(Boolean);

  return labels.length === 0 ? null : labels.join(' → ');
}

export function formatTripParticipants(
  participants: ReadonlyArray<Readonly<{ display_name: string | null }>>
): string[] {
  return participants
    .map((participant) => participant.display_name?.trim() ?? '')
    .filter(Boolean);
}

export function formatTripDetailDates(dateFrom: string | null, dateTo: string | null): string | null {
  return formatRussianDateRange(dateFrom, dateTo);
}

export function formatTripBudget({
  min,
  max,
  currency,
  scope
}: Readonly<{
  min: string | null;
  max: string | null;
  currency: string | null;
  scope: PersistedBudgetScope | null;
}>): string | null {
  if (min === null && max === null) {
    return null;
  }

  const amount = [min, max].filter((value) => value !== null).map(formatBudgetAmount).join('–');
  const currencyValue = currency === null ? amount : `${amount} ${currency}`;

  return scope === null ? currencyValue : `${currencyValue} · ${BUDGET_SCOPE_LABELS[scope]}`;
}

function formatBudgetAmount(amount: string): string {
  const decimal = /^(-?\d+)(?:\.(\d+))?$/.exec(amount);
  if (!decimal) return amount;
  const [, integer, fraction] = decimal;
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
  return fraction ? `${grouped},${fraction}` : grouped;
}

export function getPersistedTripStatusLabel(status: PersistedTripStatus): string {
  return TRIP_STATUS_LABELS[status];
}

export function formatTripDayCount(count: number): string {
  const form = new Intl.PluralRules('ru').select(count);
  return `${count} ${form === 'one' ? 'день' : form === 'few' ? 'дня' : 'дней'}`;
}

export function createConfirmedContent(trip: TripDetailResponse, days: readonly TripItineraryDayResponse[]): TripDraftContent {
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

export function mergeConfirmedContent(draft: TripDraftContent, confirmed: TripDraftContent, allowInitialFallback: boolean): TripDraftContent {
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

const overviewSections = ['route', 'dates', 'budget', 'accommodation', 'transport'] as const;
export type TripOverviewSection = typeof overviewSections[number];
export type TripDayRange = Readonly<{ first: number; last: number; place: string | null }>;
type DraftDayChange = Readonly<{ day: TripDraftDay; number: number; existing: boolean }>;

export function getTripOverviewData(
  status: PersistedTripStatus,
  itineraryState: 'loaded' | 'loading' | 'error',
  confirmed: TripDraftContent,
  draft: Pick<TripDraftResponse, 'content' | 'version'> | undefined
) {
  const sections: TripOverviewSection[] = [];
  const draftDays: DraftDayChange[] = [];
  const removedDayNumbers: number[] = [];
  let daysReordered = false;
  const ranges = groupConfirmedDays(confirmed.days, confirmed.route_stops);
  const complex = itineraryState === 'loaded' &&
    (confirmed.days.length > 3 || ranges.some((range) => range.place !== null && range.first !== range.last));
  let mode: 'standard' | 'new' | 'partial' | 'complex' = complex ? 'complex' : 'standard';
  if (itineraryState === 'loaded' && draft) {
    const current = mergeConfirmedContent(draft.content, confirmed, draft.version === 1);
    sections.push(...overviewSections.filter((scope) => !areTripDraftValuesEqual(
      getDraftScopeSnapshot(confirmed, scope), getDraftScopeSnapshot(current, scope)
    )));
    const confirmedById = new Map(confirmed.days.map((day) => [day.id, day]));
    const draftById = new Set(current.days.map((day) => day.id));
    for (const [index, day] of current.days.entries()) {
      const existing = confirmedById.get(day.id);
      if (!existing || !areTripDraftValuesEqual(existing, day)) {
        draftDays.push({ day, number: index + 1, existing: Boolean(existing) });
      }
    }
    for (const [index, day] of confirmed.days.entries()) {
      if (!draftById.has(day.id)) removedDayNumbers.push(index + 1);
    }
    const confirmedOrder = confirmed.days.filter((day) => draftById.has(day.id));
    const draftOrder = current.days.filter((day) => confirmedById.has(day.id));
    daysReordered = confirmedOrder.some((day, index) => day.id !== draftOrder[index].id);
    const hasDraftChanges = sections.length > 0 || draftDays.length > 0 || removedDayNumbers.length > 0 || daysReordered;
    if (!complex && hasDraftChanges) mode = 'partial';
    if (!hasDraftChanges && status === 'forming' && !confirmed.days.length && !confirmed.route_stops.length
        && !confirmed.date_from && !confirmed.date_to && !confirmed.budget.min && !confirmed.budget.max
        && !confirmed.accommodations.length && !confirmed.transport.length) mode = 'new';
  }
  return { mode, ranges, changedSections: sections, draftDays, removedDayNumbers, daysReordered };
}

function groupConfirmedDays(days: readonly TripDraftDay[], stops: TripDraftContent['route_stops']): TripDayRange[] {
  const labelCounts = new Map<string, number>();
  for (const { place_label } of stops) {
    const label = place_label.trim();
    if (label) labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
  }
  const ranges: TripDayRange[] = [];
  for (const [index, day] of days.entries()) {
    const title = day.title?.trim();
    const place = title && labelCounts.get(title) === 1 ? title : null;
    const last = ranges.at(-1);
    if (last && last.place === place) ranges[ranges.length - 1] = { ...last, last: index + 1 };
    else ranges.push({ first: index + 1, last: index + 1, place });
  }
  return ranges;
}

export function areTripDraftValuesEqual(left: unknown, right: unknown): boolean {
  const serialize = (value: unknown) => JSON.stringify(value, (key, item: unknown) => {
    if (typeof item === 'string' && (key === 'min' || key === 'max' || key === 'estimated_cost')) {
      // The Draft JSON and the confirmed numeric columns can return different decimal scales.
      const parsed = /^(-?)(\d+)(?:\.(\d+))?$/.exec(item);
      if (parsed) {
        const [, sign, integer, decimals = ''] = parsed;
        const normalized = integer.replace(/^0+(?=\d)/, '');
        const fraction = decimals.replace(/0+$/, '');
        return `${normalized === '0' && !fraction ? '' : sign}${normalized}${fraction ? `.${fraction}` : ''}`;
      }
    }
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      return Object.fromEntries(Object.entries(item).sort(([first], [second]) => first.localeCompare(second)));
    }
    return item;
  });
  return serialize(left) === serialize(right);
}
