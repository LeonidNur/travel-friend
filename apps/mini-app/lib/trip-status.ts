import type { TripStatus } from './types';

const TRIP_STATUS_LABELS: Record<TripStatus, string> = {
  draft: 'Черновик',
  planning: 'Планируется',
  ready: 'Готово'
};

export function getTripStatusLabel(status: TripStatus): string {
  return TRIP_STATUS_LABELS[status];
}
