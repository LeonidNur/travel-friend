import type { BackendApiClient, TravelIntentResponse } from './backend-api-client';
import {
  createOnboardingTravelIntentDraft,
  saveOnboardingTravelIntent,
  type OnboardingTravelIntentDraft,
  type OnboardingTravelIntentSaveResult,
  type OnboardingTravelIntentValidationErrors
} from './onboarding-travel-intent';

export type ProfileTravelIntentDraft = OnboardingTravelIntentDraft;
export type ProfileTravelIntentValidationErrors = OnboardingTravelIntentValidationErrors;
export type ProfileTravelIntentSaveResult = OnboardingTravelIntentSaveResult;

type SaveProfileTravelIntentInput = Readonly<{
  draft: ProfileTravelIntentDraft;
  token: string;
  putTravelIntent: BackendApiClient['putTravelIntent'];
}>;

export function createProfileTravelIntentDraft(travelIntent: TravelIntentResponse): ProfileTravelIntentDraft {
  return createOnboardingTravelIntentDraft(travelIntent);
}

export function saveProfileTravelIntent(input: SaveProfileTravelIntentInput): Promise<ProfileTravelIntentSaveResult> {
  return saveOnboardingTravelIntent(input);
}
