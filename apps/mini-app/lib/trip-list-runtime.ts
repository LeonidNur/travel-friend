export type PersistedTripStatus = 'forming' | 'active' | 'completed' | 'cancelled';

type TripListScreenInput = Readonly<{
  isLoading: boolean;
  error: string | null;
  trips: readonly unknown[];
}>;

export type TripListScreenState = 'loading' | 'error' | 'empty' | 'success';

const PERSISTED_TRIP_STATUS_LABELS: Record<PersistedTripStatus, string> = {
  forming: 'Формируется',
  active: 'Активна',
  completed: 'Завершена',
  cancelled: 'Отменена'
};

export function getTripListScreenState({ isLoading, error, trips }: TripListScreenInput): TripListScreenState {
  if (isLoading) {
    return 'loading';
  }

  if (error !== null) {
    return 'error';
  }

  return trips.length === 0 ? 'empty' : 'success';
}

export function formatTripRoute(routePlaceLabels: readonly string[]): string | null {
  const stops = routePlaceLabels.map((label) => label.trim()).filter(Boolean);

  return stops.length === 0 ? null : stops.join(' → ');
}

export function formatTripDates(dateFrom: string | null, dateTo: string | null): string | null {
  if (dateFrom !== null && dateTo !== null) {
    return `${dateFrom} — ${dateTo}`;
  }

  return dateFrom ?? dateTo;
}

export function getPersistedTripStatusLabel(status: PersistedTripStatus): string {
  return PERSISTED_TRIP_STATUS_LABELS[status];
}
