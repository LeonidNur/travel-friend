import { ApiError, type TripCreateResponse, type TripListItemResponse } from './backend-api-client';

type CreateChatTripInput = Readonly<{
  chatId: string;
  createTrip: () => Promise<TripCreateResponse>;
  getTrips: () => Promise<TripListItemResponse[]>;
}>;

export type CreateChatTripResult = Readonly<{
  tripPath: string | null;
  error: string | null;
}>;

export type CreateTripButtonState = Readonly<{
  disabled: boolean;
  label: string;
  showRetry: boolean;
}>;

export type TripNavigationLookupState =
  | Readonly<{ status: 'loading' }>
  | Readonly<{ status: 'error' }>
  | Readonly<{ status: 'loaded'; tripId: string | null }>;

const CREATE_TRIP_ERROR = 'Не удалось создать поездку. Попробуйте ещё раз.';
const UNRESOLVED_CONFLICT_ERROR =
  'Незавершённая поездка уже существует, но её не удалось открыть. Попробуйте ещё раз.';

export function findUnfinishedTripForChat(
  trips: readonly TripListItemResponse[],
  chatId: string
): TripListItemResponse | null {
  return trips.find((trip) => trip.chat_id === chatId && (trip.status === 'forming' || trip.status === 'active')) ?? null;
}

export async function loadChatTripNavigationState(
  chatId: string,
  getTrips: () => Promise<TripListItemResponse[]>
): Promise<TripNavigationLookupState> {
  try {
    const existingTrip = findUnfinishedTripForChat(await getTrips(), chatId);
    return { status: 'loaded', tripId: existingTrip?.trip_id ?? null };
  } catch {
    return { status: 'error' };
  }
}

export function getTripNavigationButtonState(
  lookup: TripNavigationLookupState,
  isCreating: boolean
): CreateTripButtonState {
  if (isCreating) {
    return { disabled: true, label: 'Создаём поездку…', showRetry: false };
  }

  if (lookup.status === 'loading') {
    return { disabled: true, label: 'Проверяем поездку…', showRetry: false };
  }

  if (lookup.status === 'error') {
    return { disabled: true, label: 'Поездка недоступна', showRetry: true };
  }

  return lookup.tripId === null
    ? { disabled: false, label: 'Создать поездку', showRetry: false }
    : { disabled: false, label: 'Открыть поездку', showRetry: false };
}

export function getTripNavigationDescription(lookup: TripNavigationLookupState): string {
  if (lookup.status === 'loading') {
    return 'Проверяем, есть ли поездка для этого чата.';
  }

  if (lookup.status === 'error') {
    return 'Повторите проверку, чтобы узнать, доступна ли поездка.';
  }

  return lookup.tripId === null
    ? 'Создайте поездку для участников этого чата.'
    : 'Откройте поездку участников этого чата.';
}

export async function createChatTrip({ chatId, createTrip, getTrips }: CreateChatTripInput): Promise<CreateChatTripResult> {
  try {
    const trip = await createTrip();
    return { tripPath: `/trips/${trip.trip_id}`, error: null };
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 409) {
      return { tripPath: null, error: CREATE_TRIP_ERROR };
    }

    try {
      const existingTrip = (await getTrips()).find(
        (trip) => trip.chat_id === chatId && (trip.status === 'forming' || trip.status === 'active')
      );
      return existingTrip === undefined
        ? { tripPath: null, error: UNRESOLVED_CONFLICT_ERROR }
        : { tripPath: `/trips/${existingTrip.trip_id}`, error: null };
    } catch {
      return { tripPath: null, error: UNRESOLVED_CONFLICT_ERROR };
    }
  }
}
