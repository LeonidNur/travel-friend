import type {
  BackendApiClient,
  OnboardingStatus,
  ProfilePatchRequest,
  ProfileResponse
} from './backend-api-client';
import {
  fromCanonicalProfileLevel,
  toCanonicalProfileLevel
} from './travel-preferences';
import type { BudgetLevel, ComfortLevel } from './types';

export type OnboardingProfileDraft = Readonly<{
  displayName: string;
  birthDate: string;
  city: string;
  bio: string;
  interests: string[];
  travelStyle: string[];
  budgetLevel: BudgetLevel | null;
  comfortLevel: ComfortLevel | null;
}>;

export type OnboardingProfileValidationErrors = Readonly<{
  displayName?: 'Укажите имя';
  birthDate?: 'Укажите корректную дату рождения' | 'Дата рождения не может быть в будущем';
}>;

export type OnboardingProfileSaveResult =
  | Readonly<{ status: 'validation_error'; errors: OnboardingProfileValidationErrors }>
  | Readonly<{ status: 'api_error'; message: string }>
  | Readonly<{ status: 'saved'; profile: ProfileResponse }>;

type SaveOnboardingProfileInput = Readonly<{
  draft: OnboardingProfileDraft;
  onboardingStatus: Exclude<OnboardingStatus, 'completed'>;
  token: string;
  patchOnboarding: BackendApiClient['patchOnboarding'];
  patchProfile: BackendApiClient['patchProfile'];
}>;

function normalizeOptions(values: Array<string | null>): string[] {
  return values.filter((value): value is string => typeof value === 'string');
}

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

export function createOnboardingProfileDraft(profile: ProfileResponse | null): OnboardingProfileDraft {
  if (profile === null) {
    return {
      displayName: '',
      birthDate: '',
      city: '',
      bio: '',
      interests: [],
      travelStyle: [],
      budgetLevel: null,
      comfortLevel: null
    };
  }

  return {
    displayName: profile.display_name,
    birthDate: profile.birth_date ?? '',
    city: profile.city ?? '',
    bio: profile.bio ?? '',
    interests: normalizeOptions(profile.interests),
    travelStyle: normalizeOptions(profile.travel_style),
    budgetLevel: fromCanonicalProfileLevel(profile.budget_level),
    comfortLevel: fromCanonicalProfileLevel(profile.comfort_level)
  };
}

export function validateOnboardingProfile(
  draft: OnboardingProfileDraft,
  now: Date = new Date()
): Readonly<{ isValid: boolean; errors: OnboardingProfileValidationErrors }> {
  const trimmedBirthDate = draft.birthDate.trim();
  const errors: OnboardingProfileValidationErrors = {
    ...(draft.displayName.trim().length === 0 ? { displayName: 'Укажите имя' as const } : {}),
    ...(trimmedBirthDate.length > 0 && !isValidDate(trimmedBirthDate)
      ? { birthDate: 'Укажите корректную дату рождения' as const }
      : {}),
    ...(trimmedBirthDate.length > 0 && isValidDate(trimmedBirthDate) && trimmedBirthDate > now.toISOString().slice(0, 10)
      ? { birthDate: 'Дата рождения не может быть в будущем' as const }
      : {})
  };

  return { errors, isValid: Object.keys(errors).length === 0 };
}

export function toProfilePatchRequest(draft: OnboardingProfileDraft): ProfilePatchRequest {
  return {
    display_name: draft.displayName.trim(),
    birth_date: toNullableTrimmedValue(draft.birthDate),
    city: toNullableTrimmedValue(draft.city),
    bio: toNullableTrimmedValue(draft.bio),
    interests: [...draft.interests],
    travel_style: [...draft.travelStyle],
    budget_level: toCanonicalProfileLevel(draft.budgetLevel),
    comfort_level: toCanonicalProfileLevel(draft.comfortLevel)
  };
}

export async function saveOnboardingProfile(
  input: SaveOnboardingProfileInput
): Promise<OnboardingProfileSaveResult> {
  const validationResult = validateOnboardingProfile(input.draft);

  if (!validationResult.isValid) {
    return { status: 'validation_error', errors: validationResult.errors };
  }

  try {
    if (input.onboardingStatus === 'not_started') {
      await input.patchOnboarding(input.token, { status: 'in_progress' });
    }

    const profile = await input.patchProfile(input.token, toProfilePatchRequest(input.draft));
    return { status: 'saved', profile };
  } catch (error) {
    return {
      status: 'api_error',
      message: error instanceof Error ? error.message : 'Не удалось сохранить профиль. Попробуйте ещё раз.'
    };
  }
}
