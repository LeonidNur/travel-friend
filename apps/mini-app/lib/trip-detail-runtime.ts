import { formatRussianDateRange } from './russian-date-format';

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
