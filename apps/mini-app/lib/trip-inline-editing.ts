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
  if (content.date_from && content.date_to && content.date_to < content.date_from) {
    issues.push('Дата окончания должна быть не раньше даты начала.');
  }
  if (content.budget.min !== null && content.budget.max !== null && Number(content.budget.max) < Number(content.budget.min)) {
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
