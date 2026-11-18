'use client';

import { BottomNavigation } from '@/components/BottomNavigation';
import { TripsList } from '@/components/TripsList';
import { TripWorkspace, type TripView } from '@/components/TripWorkspace';
import { ApiError } from '@/lib/backend-api-client';
import type { TripDraftEditorProps } from '@/components/TripDraftEditor';
import type {
  TripDetailResponse, TripDraftContent, TripItineraryDayResponse,
  TripListItemResponse, TripProposalResponse, TripProposalStatus
} from '@/lib/backend-api-client';

export const tripsPreviewOptions = [
  ['trips-list', 'Поездки: список'], ['trips-loading', 'Поездки: загрузка'],
  ['trips-empty', 'Поездки: пусто'], ['trips-error', 'Поездки: ошибка'],
  ['trips-overview', 'Поездка: обзор'], ['trips-program', 'Поездка: программа'],
  ['trips-draft', 'Черновик: разделы'], ['trips-budget', 'Черновик: бюджет'],
  ['trips-budget-validation', 'Черновик: проверка бюджета'], ['trips-budget-conflict', 'Черновик: конфликт версий'],
  ['trips-budget-saving', 'Черновик: отправка'], ['trips-budget-error', 'Черновик: ошибка сети'],
  ['trips-vote-conflict', 'Голосование: конфликт'], ['trips-vote-saved', 'Голосование: голос сохранён'],
  ['trips-vote-history', 'Голосование: история'],
  ['trips-route', 'Черновик: маршрут'], ['trips-day', 'Черновик: день'],
  ['trips-event', 'Черновик: событие'], ['trips-dates', 'Черновик: даты'],
  ['trips-accommodation', 'Черновик: проживание'], ['trips-transport', 'Черновик: транспорт'],
  ['trips-all-days', 'Черновик: вся программа'], ['trips-alternatives', 'Сохранённые варианты'],
  ['trips-vote-pending', 'Голосование: открыто'], ['trips-vote-blocked', 'Голосование: заблокировано'],
  ['trips-vote-accepted', 'Голосование: принято'], ['trips-vote-rejected', 'Голосование: отклонено'],
  ['trips-vote-stale', 'Голосование: устарело'], ['trips-vote-error', 'Голосование: ошибка отправки']
] as const;

const created = '2026-11-09T00:00:00Z';
const baseListTrip: TripListItemResponse = {
  trip_id: 'preview-trip', chat_id: 'preview-trip-chat', status: 'forming',
  created_at: created, date_from: null, date_to: null,
  destination_status: 'confirmed', dates_status: 'empty', budget_status: 'empty',
  transport_status: 'empty', route_place_labels: ['Москва', 'Санкт-Петербург']
};
const list: TripListItemResponse[] = [
  baseListTrip, { ...baseListTrip, trip_id: 'active', status: 'active',
    route_place_labels: ['Сидней', 'Тасмания', 'Мельбурн', 'Кэрнс'] },
  { ...baseListTrip, trip_id: 'completed', status: 'completed', route_place_labels: [] },
  { ...baseListTrip, trip_id: 'cancelled', status: 'cancelled', route_place_labels: [] }
];
const names = { alex: 'Александра', kirill: 'Кирилл' };
const proposedBudget = { min: '18000', max: '25000', currency: 'RUB', scope: 'per_person' } as const;
const emptyBudget = { min: null, max: null, currency: null, scope: null };
const trip: TripDetailResponse = {
  trip: {
    ...baseListTrip, created_by_user_id: 'alex', updated_at: created,
    membership_version: 1, state_version: 1, destination_version: 1,
    dates_version: 0, budget_version: 0, transport_version: 0,
    budget_min: null, budget_max: null, budget_currency: null, budget_scope: null,
    started_at: null, completed_at: null, cancelled_at: null
  },
  route_stops: baseListTrip.route_place_labels.map((place_label, position) => ({
    id: `place-${position}`, position, place_label, country_code: null, place_ref: null,
    stay_from: null, stay_to: null, notes: null, created_at: created, updated_at: created
  })),
  participants: Object.entries(names).map(([user_id, display_name]) => ({ user_id, display_name, age: null, city: null })),
  accommodations: [], transport: []
};
const baseEvent = {
  kind: 'activity', duration_minutes: null, address: null,
  estimated_cost: null, currency: null, start_time: null, notes: null
} as const;
const days: TripItineraryDayResponse[] = [
  { id: 'day1', position: 0, day_date: null, title: 'Санкт-Петербург', notes: null, events: [
    { ...baseEvent, id: 'train', day_id: 'day1', position: 0, kind: 'transport', start_time: '09:00', title: 'Поезд Москва → Санкт-Петербург' },
    { ...baseEvent, id: 'walk', day_id: 'day1', position: 1, title: 'Прогулка по центру', notes: 'Начнём с Невского.' }
  ] },
  { id: 'day2', position: 1, day_date: null, title: 'Свободный день', notes: null, events: [] },
  { id: 'day3', position: 2, day_date: null, title: 'Возвращение', notes: null, events: [
    { ...baseEvent, id: 'return', day_id: 'day3', position: 0, title: 'Прогулка перед отъездом' }
  ] }
];
const content: TripDraftContent = {
  route_stops: trip.route_stops.map(({ id, place_label, country_code, place_ref, stay_from, stay_to, notes }) => ({
    id, place_label, country_code, place_ref, stay_from, stay_to, notes
  })),
  date_from: null, date_to: null, accommodations: [], transport: [],
  budget: emptyBudget, notes: '',
  days: days.map(({ day_date, id, title, notes, events }) => ({
    id, title, notes, date: day_date, events: events.map(({
      id, kind, title, start_time, duration_minutes, address, estimated_cost, currency, notes
    }) => ({ id, kind, title, start_time, duration_minutes, address, estimated_cost, currency, notes }))
  }))
};
const draft = { trip_id: 'preview-trip', version: 7, content, updated_at: created, updated_by_user_id: 'alex' };
const alternative = { id: 'via-vyborg', trip_id: draft.trip_id, title: 'Через Выборг', created_at: created, created_by_user_id: 'alex' };
const alternativeContent = { ...content, route_stops: content.route_stops.map((stop, index) => index === 1 ? { ...stop, place_label: 'Выборг' } : stop) };

function getProposal(status: TripProposalStatus): TripProposalResponse {
  const voters: TripProposalResponse['voters'] = [
    { user_id: 'alex', vote: status === 'accepted' ? 'accept' : status === 'rejected' ? 'reject' : null,
      voted_at: status === 'accepted' || status === 'rejected' ? created : null },
    { user_id: 'kirill', vote: status === 'accepted' ? 'accept' : null, voted_at: status === 'accepted' ? created : null }
  ];
  return {
    id: 'preview-vote', trip_id: draft.trip_id, creator_user_id: 'alex', title: 'Изменение бюджета',
    status, draft_version: 8, deadline: null, blocked_reason: null, created_at: created,
    decided_at: status === 'accepted' || status === 'rejected' ? created : null,
    own_vote: voters[0].vote, voters, prerequisite_proposal_ids: [],
    operations: [{ scope: 'budget', expected_version: 0, old_value: emptyBudget, proposed_value: proposedBudget }]
  };
}

const views: Record<string, TripView> = {
  'trips-overview': { screen: 'overview' }, 'trips-program': { screen: 'program' },
  'trips-draft': { screen: 'draft' }, 'trips-alternatives': { screen: 'alternatives' },
  'trips-budget': { screen: 'edit', scope: 'budget' }, 'trips-route': { screen: 'edit', scope: 'route' },
  'trips-budget-validation': { screen: 'edit', scope: 'budget' },
  'trips-budget-conflict': { screen: 'edit', scope: 'budget' },
  'trips-budget-saving': { screen: 'edit', scope: 'budget' },
  'trips-budget-error': { screen: 'edit', scope: 'budget' },
  'trips-vote-history': { screen: 'proposals' },
  'trips-day': { screen: 'edit', scope: 'itinerary:day:day1' },
  'trips-dates': { screen: 'edit', scope: 'dates' },
  'trips-accommodation': { screen: 'edit', scope: 'accommodation' },
  'trips-transport': { screen: 'edit', scope: 'transport' },
  'trips-all-days': { screen: 'edit', scope: 'itinerary:all' },
  'trips-event': { screen: 'edit', scope: 'itinerary:event:day1:walk' }
};
const readOnly = async (): Promise<never> => { throw new Error('Запись отключена в UI preview'); };

export function TripsPreview({ view, onChange }: Readonly<{ view: string; onChange: (view: string) => void }>) {
  const voteStatus = view.startsWith('trips-vote-') ? view.slice('trips-vote-'.length) : null;
  const voteMode = voteStatus === 'error' || voteStatus === 'conflict' || voteStatus === 'saved' ? 'pending' : voteStatus;
  const proposal = voteMode && voteMode !== 'history' ? getProposal(voteMode as TripProposalStatus) : null;
  const readProposals = voteMode === 'history' ? [
    getProposal('accepted'),
    { ...getProposal('rejected'), id: 'route-proposal', title: 'Маршрут', operations: [{ scope: 'route', expected_version: 0, old_value: content.route_stops, proposed_value: alternativeContent.route_stops }] },
    { ...getProposal('cancelled'), id: 'budget-cancelled', title: 'Бюджет' },
    { ...getProposal('expired'), id: 'dates-expired', title: 'Даты', operations: [{ scope: 'dates', expected_version: 0, old_value: null, proposed_value: { date_from: '2026-11-20', date_to: '2026-11-22' } }] }
  ] : proposal ? [voteStatus === 'saved' ? {
    ...proposal, own_vote: 'accept' as const, voters: proposal.voters.map((voter) => voter.user_id === 'alex'
      ? { ...voter, vote: 'accept' as const, voted_at: created } : voter)
  } : proposal] : [];
  const shownTrip = voteStatus === 'accepted' ? { ...trip, trip: { ...trip.trip, budget_status: 'confirmed' as const,
    budget_min: proposedBudget.min, budget_max: proposedBudget.max, budget_currency: proposedBudget.currency,
    budget_scope: proposedBudget.scope } } : trip;
  const shownDraft = { ...draft, content: {
    ...content,
    ...(view.startsWith('trips-budget-') ? { budget: { ...proposedBudget, min: view === 'trips-budget-validation' ? '30000' : proposedBudget.min } } : {}),
    ...(view === 'trips-dates' ? { date_from: '2026-11-20', date_to: '2026-11-22' } : {}),
    ...(view === 'trips-accommodation' ? { accommodations: [{
      id: 'stay', name: 'Harbour Stay', location: 'Сидней', date_from: null, date_to: null, notes: 'Вариант для обсуждения'
    }] } : {}),
    ...(view === 'trips-transport' ? { transport: [{
      id: 'flight', mode: 'Самолёт', origin: 'Сидней', destination: 'Тасмания', departure_at: null, arrival_at: null,
      notes: 'Рейс и стоимость не проверены'
    }] } : {})
  } };
  const editor: Omit<TripDraftEditorProps, 'trip' | 'confirmedDays' | 'navigation'> = {
    token: '', userId: voteStatus === 'accepted' ? 'kirill' : 'alex', draft: shownDraft, alternatives: [alternative],
    api: {
      getTripDraft: async () => ({ draft: view.startsWith('trips-budget-') ? draft : shownDraft, alternatives: [alternative] }),
      getTripDraftAlternative: async () => ({ ...alternative, content: alternativeContent }),
      getTripProposals: async () => readProposals.map((item) => ({ ...item, scopes: item.operations.map((operation) => operation.scope) })),
      getTripProposal: async (_token, _tripId, id) => readProposals.find((item) => item.id === id) ?? readOnly(),
      saveTripDraft: async () => {
        if (view === 'trips-budget-conflict') throw new ApiError(409, { detail: 'Draft version conflict' });
        if (view === 'trips-budget-saving') return new Promise<never>(() => undefined);
        return readOnly();
      },
      saveTripDraftAlternative: readOnly, createTripProposal: readOnly,
      voteTripProposal: async () => {
        if (voteStatus === 'conflict') throw new ApiError(409, { detail: 'Proposal changed' });
        return readOnly();
      },
      cancelTripProposal: readOnly
    },
    authorLabel: (id) => names[id as keyof typeof names] ?? id, onProposalAccepted: () => undefined
  };
  const listState = { 'trips-list': 'success', 'trips-loading': 'loading', 'trips-empty': 'empty', 'trips-error': 'error' } as const;
  const state = listState[view as keyof typeof listState];

  return <div className="app-shell">
    <main className="app-content"><div className="app-content__frame">
      {state ? <TripsList state={state} trips={list} onRetry={() => onChange('trips-list')}
        onOpen={() => onChange('trips-overview')} /> :
        <TripWorkspace key={view} trip={shownTrip} days={days} editor={editor}
          previewView={views[view]} previewProposalId={proposal?.id} />}
    </div></main>
    <BottomNavigation pathname="/trips" />
  </div>;
}
