import type { TripDraftContent } from './backend-api-client';

export function getInlineProposalTitle(scope: string, label?: string): string {
  if (label?.trim()) return `Изменение: ${label.trim()}`.slice(0, 120);
  const labels: Readonly<Record<string, string>> = {
    route: 'маршрута', dates: 'дат поездки', budget: 'бюджета',
    accommodation: 'проживания', transport: 'транспорта', 'itinerary:all': 'программы поездки'
  };
  return `Изменение ${labels[scope] ?? 'поездки'}`;
}

export function validateTripDraftForProposal(content: TripDraftContent, scope?: string): string[] {
  const issues: string[] = [];
  const includes = (section: string) => scope === undefined || scope === section;
  if (includes('dates') && content.date_from && content.date_to && content.date_to < content.date_from) {
    issues.push('Дата окончания должна быть не раньше даты начала.');
  }
  if (includes('budget') && content.budget.min !== null && content.budget.max !== null && Number(content.budget.max) < Number(content.budget.min)) {
    issues.push('Максимальный бюджет должен быть не меньше минимального.');
  }
  if (includes('route') && content.route_stops.some((stop) => !stop.place_label.trim())) {
    issues.push('Укажите место маршрута перед отправкой предложения.');
  }
  if (includes('accommodation') && content.accommodations.some((stay) => !stay.name.trim())) {
    issues.push('Укажите название проживания перед отправкой предложения.');
  }
  if (includes('transport') && content.transport.some((leg) => !leg.mode.trim())) {
    issues.push('Укажите вид транспорта перед отправкой предложения.');
  }
  const itineraryScope = scope === undefined || scope === 'itinerary:all' || scope.startsWith('itinerary:');
  if (itineraryScope && content.days.some((day) => {
    if (scope?.startsWith('itinerary:day:') && scope !== `itinerary:day:${day.id}`) return false;
    return day.events.some((event) => {
      if (scope?.startsWith('itinerary:event:') && scope !== `itinerary:event:${day.id}:${event.id}`) return false;
      return !event.title.trim();
    });
  })) {
    issues.push('У каждого события должно быть название.');
  }
  return issues;
}

export function buildDraftContentForScope(
  local: TripDraftContent,
  saved: TripDraftContent,
  scope: string
): TripDraftContent {
  if (scope === 'route') return { ...saved, route_stops: local.route_stops };
  if (scope === 'dates') return { ...saved, date_from: local.date_from, date_to: local.date_to };
  if (scope === 'budget') return { ...saved, budget: local.budget };
  if (scope === 'accommodation') return { ...saved, accommodations: local.accommodations };
  if (scope === 'transport') return { ...saved, transport: local.transport };
  if (scope === 'itinerary:all') return { ...saved, days: local.days };
  if (scope.startsWith('itinerary:day:')) {
    const dayId = scope.slice('itinerary:day:'.length);
    const localDay = local.days.find((day) => day.id === dayId);
    if (!localDay) return saved;
    const hasSavedDay = saved.days.some((day) => day.id === dayId);
    return { ...saved, days: hasSavedDay
      ? saved.days.map((day) => day.id === dayId ? localDay : day)
      : [...saved.days, localDay] };
  }
  if (scope.startsWith('itinerary:event:')) {
    const [, , dayId, eventId] = scope.split(':');
    const localDay = local.days.find((day) => day.id === dayId);
    const localEvent = localDay?.events.find((event) => event.id === eventId);
    if (!localDay || !localEvent) return saved;
    return { ...saved, days: saved.days.map((day) => day.id === dayId
      ? { ...day, events: day.events.some((event) => event.id === eventId)
        ? day.events.map((event) => event.id === eventId ? localEvent : event)
        : [...day.events, localEvent] }
      : day) };
  }
  return saved;
}

export function getDraftScopeSnapshot(content: TripDraftContent, scope: string): unknown {
  if (scope === 'route') return content.route_stops;
  if (scope === 'dates') return { date_from: content.date_from, date_to: content.date_to };
  if (scope === 'budget') return content.budget;
  if (scope === 'accommodation') return content.accommodations;
  if (scope === 'transport') return content.transport;
  if (scope === 'itinerary:all') return content.days;
  if (scope.startsWith('itinerary:day:')) {
    const dayId = scope.slice('itinerary:day:'.length);
    return content.days.find((day) => day.id === dayId) ?? null;
  }
  if (scope.startsWith('itinerary:event:')) {
    const [, , dayId, eventId] = scope.split(':');
    return content.days.find((day) => day.id === dayId)?.events.find((event) => event.id === eventId) ?? null;
  }
  return null;
}

const proposalFieldLabels: Readonly<Record<string, string>> = {
  place_label: 'Место', country_code: 'Страна', stay_from: 'Прибытие', stay_to: 'Отъезд', date_from: 'Начало', date_to: 'Окончание',
  min: 'От', max: 'До', currency: 'Валюта', scope: 'На', name: 'Название', location: 'Место',
  mode: 'Вид', origin: 'Откуда', destination: 'Куда', departure_at: 'Отправление', arrival_at: 'Прибытие',
  date: 'Дата', title: 'Название', notes: 'Заметка', kind: 'Тип', start_time: 'Время',
  duration_minutes: 'Длительность, мин.', address: 'Адрес', estimated_cost: 'Стоимость'
};

export function formatProposalValue(value: unknown): string {
  if (value === null || value === undefined) return 'Не указано';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return 'Не указано';
    return value.map((item) => formatProposalValue(item)).join('; ');
  }
  const fields = Object.entries(value as Record<string, unknown>)
    .filter(([key, item]) => key !== 'id' && key !== 'position' && key !== 'day_id' && key !== 'place_ref' && item !== undefined && item !== '')
    .map(([key, item]) => {
      const label = proposalFieldLabels[key] ?? key;
      const formatted = key === 'scope' ? formatBudgetScope(item) : key === 'kind' ? formatEventKind(item) : formatProposalValue(item);
      return `${label}: ${formatted}`;
    });
  return fields.length > 0 ? fields.join(' · ') : 'Без дополнительных данных';
}

function formatBudgetScope(value: unknown): string {
  if (value === 'per_person') return 'на человека';
  if (value === 'group_total') return 'на группу';
  return String(value);
}

function formatEventKind(value: unknown): string {
  const labels: Readonly<Record<string, string>> = {
    activity: 'Занятие', transport: 'Транспорт', accommodation: 'Проживание', meal: 'Питание', note: 'Заметка', other: 'Другое'
  };
  return typeof value === 'string' ? labels[value] ?? value : String(value);
}
