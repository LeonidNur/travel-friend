import type { BackendApiClient, TravelIntentPutRequest, TravelIntentResponse } from './backend-api-client';

export type OnboardingTravelIntentDraft = Readonly<{
  destination: string;
  dateFrom: string;
  dateTo: string;
}>;

export type OnboardingTravelIntentValidationErrors = Readonly<{
  destination?: 'Укажите направление';
  dateFrom?: 'Укажите корректную дату';
  dateTo?: 'Укажите корректную дату' | 'Дата окончания не может быть раньше даты начала';
}>;

export type OnboardingTravelIntentSaveResult =
  | Readonly<{ status: 'validation_error'; errors: OnboardingTravelIntentValidationErrors }>
  | Readonly<{ status: 'api_error'; message: string }>
  | Readonly<{ status: 'saved'; travelIntent: TravelIntentResponse }>;

type SaveOnboardingTravelIntentInput = Readonly<{
  draft: OnboardingTravelIntentDraft;
  token: string;
  putTravelIntent: BackendApiClient['putTravelIntent'];
}>;

function isValidDate(value: string): boolean {
  const dateParts = value.split('-').map(Number);

  if (dateParts.length !== 3 || dateParts.some((part) => !Number.isInteger(part))) {
    return false;
  }

  const [year, month, day] = dateParts;
  const date = new Date(Date.UTC(year, month - 1, day));

  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function toNullableTrimmedValue(value: string): string | null {
  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : null;
}

export function createOnboardingTravelIntentDraft(
  travelIntent: TravelIntentResponse | null
): OnboardingTravelIntentDraft {
  return {
    destination: travelIntent?.destination ?? '',
    dateFrom: travelIntent?.date_from ?? '',
    dateTo: travelIntent?.date_to ?? ''
  };
}

export function validateOnboardingTravelIntent(
  draft: OnboardingTravelIntentDraft
): Readonly<{ isValid: boolean; errors: OnboardingTravelIntentValidationErrors }> {
  const dateFrom = draft.dateFrom.trim();
  const dateTo = draft.dateTo.trim();
  const errors: OnboardingTravelIntentValidationErrors = {
    ...(draft.destination.trim().length === 0 ? { destination: 'Укажите направление' as const } : {}),
    ...(dateFrom.length > 0 && !isValidDate(dateFrom) ? { dateFrom: 'Укажите корректную дату' as const } : {}),
    ...(dateTo.length > 0 && !isValidDate(dateTo) ? { dateTo: 'Укажите корректную дату' as const } : {}),
    ...(dateFrom.length > 0 && dateTo.length > 0 && isValidDate(dateFrom) && isValidDate(dateTo) && dateTo < dateFrom
      ? { dateTo: 'Дата окончания не может быть раньше даты начала' as const }
      : {})
  };

  return { errors, isValid: Object.keys(errors).length === 0 };
}

export function toTravelIntentPutRequest(
  draft: OnboardingTravelIntentDraft
): TravelIntentPutRequest {
  return {
    destination: draft.destination.trim(),
    date_from: toNullableTrimmedValue(draft.dateFrom),
    date_to: toNullableTrimmedValue(draft.dateTo)
  };
}

export async function saveOnboardingTravelIntent(
  input: SaveOnboardingTravelIntentInput
): Promise<OnboardingTravelIntentSaveResult> {
  const validationResult = validateOnboardingTravelIntent(input.draft);

  if (!validationResult.isValid) {
    return { status: 'validation_error', errors: validationResult.errors };
  }

  try {
    const travelIntent = await input.putTravelIntent(input.token, toTravelIntentPutRequest(input.draft));
    return { status: 'saved', travelIntent };
  } catch (error) {
    return {
      status: 'api_error',
      message: error instanceof Error ? error.message : 'Не удалось сохранить план поездки. Попробуйте ещё раз.'
    };
  }
}
