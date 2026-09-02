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
}>;

const CREATE_TRIP_ERROR = 'Не удалось создать поездку. Попробуйте ещё раз.';
const UNRESOLVED_CONFLICT_ERROR =
  'Незавершённая поездка уже существует, но её не удалось открыть. Попробуйте ещё раз.';

export function getCreateTripButtonState(isCreating: boolean): CreateTripButtonState {
  return isCreating
    ? { disabled: true, label: 'Создаём поездку…' }
    : { disabled: false, label: 'Создать поездку' };
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
