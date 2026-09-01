import type { BackendApiClient, ProfileResponse } from './backend-api-client';
import {
  createOnboardingProfileDraft,
  toProfilePatchRequest,
  validateOnboardingProfile,
  type OnboardingProfileDraft,
  type OnboardingProfileValidationErrors
} from './onboarding-profile';
import { fromCanonicalProfileLevel } from './travel-preferences';

export type ProfileEditingDraft = OnboardingProfileDraft;

export type ProfileEditingSaveResult =
  | Readonly<{ status: 'validation_error'; errors: OnboardingProfileValidationErrors }>
  | Readonly<{ status: 'api_error'; message: string }>
  | Readonly<{ status: 'saved'; profile: ProfileResponse }>;

type SaveProfileEditingInput = Readonly<{
  draft: ProfileEditingDraft;
  sourceProfile: ProfileResponse;
  token: string;
  patchProfile: BackendApiClient['patchProfile'];
}>;

export function createProfileEditingDraft(profile: ProfileResponse): ProfileEditingDraft {
  return createOnboardingProfileDraft(profile);
}

export async function saveProfileEditing(
  input: SaveProfileEditingInput
): Promise<ProfileEditingSaveResult> {
  const validationResult = validateOnboardingProfile(input.draft);

  if (!validationResult.isValid) {
    return { status: 'validation_error', errors: validationResult.errors };
  }

  try {
    const { budget_level, comfort_level, ...profilePayload } = toProfilePatchRequest(input.draft);
    const profile = await input.patchProfile(input.token, {
      ...profilePayload,
      ...(budget_level !== null || fromCanonicalProfileLevel(input.sourceProfile.budget_level) !== null || input.sourceProfile.budget_level === null
        ? { budget_level }
        : {}),
      ...(comfort_level !== null || fromCanonicalProfileLevel(input.sourceProfile.comfort_level) !== null || input.sourceProfile.comfort_level === null
        ? { comfort_level }
        : {})
    });
    return { status: 'saved', profile };
  } catch (error) {
    return {
      status: 'api_error',
      message: error instanceof Error ? error.message : 'Не удалось сохранить профиль. Попробуйте ещё раз.'
    };
  }
}
