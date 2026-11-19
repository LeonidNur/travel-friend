import type { TripDetailResponse } from './backend-api-client';
import { formatRussianDate, formatRussianDateRange } from './russian-date-format';

const utcClock = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });

export function getTripLogistics(trip: Pick<TripDetailResponse, 'accommodations' | 'transport'>) {
  return {
    accommodations: trip.accommodations.map((item) => {
      const from = formatRussianDate(item.date_from);
      const to = formatRussianDate(item.date_to);
      return {
        id: item.id,
        label: [item.name, item.location?.trim()].filter(Boolean).join(' · '),
        timing: from && to ? formatRussianDateRange(item.date_from, item.date_to)
          : from ? `Заезд: ${from}` : to ? `Выезд: ${to}` : null,
        notes: item.notes?.trim() || null
      };
    }),
    transport: trip.transport.map((item) => {
      const origin = item.origin?.trim();
      const destination = item.destination?.trim();
      const route = origin && destination ? `${origin} → ${destination}`
        : origin ? `Откуда: ${origin}` : destination ? `Куда: ${destination}` : null;
      const departure = formatTimestamp(item.departure_at);
      const arrival = formatTimestamp(item.arrival_at);
      return {
        id: item.id,
        label: [route, item.mode].filter(Boolean).join(' · '),
        timing: [departure && `Отправление: ${departure}`, arrival && `Прибытие: ${arrival}`].filter(Boolean).join('\n') || null,
        notes: item.notes?.trim() || null
      };
    })
  };
}

function formatTimestamp(value: string | null): string | null {
  if (!value || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return null;
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return null;
  const date = formatRussianDate(time.toISOString().slice(0, 10));
  return date ? `${date} · ${utcClock.format(time)} UTC` : null;
}
