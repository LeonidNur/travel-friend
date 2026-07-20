import { CURRENT_USER_ID, currentUserProfile, type CurrentUserProfile } from './mock-current-user';
import type { UserProfile } from './types';

export type ProfileDraft = Omit<UserProfile, 'destinations'> & {
  destinations: string;
};

export type CurrentUserProfileSession = Readonly<{
  profile: CurrentUserProfile;
}>;

function cloneUserProfile(profile: UserProfile): UserProfile {
  return {
    ...profile,
    destinations: [...profile.destinations],
    interests: [...profile.interests],
    travelStyles: [...profile.travelStyles]
  };
}

function toCurrentUserProfile(profile: UserProfile): CurrentUserProfile {
  return {
    ...cloneUserProfile(profile),
    id: CURRENT_USER_ID
  };
}

export function createCurrentUserProfileSession(
  profile: CurrentUserProfile = currentUserProfile
): CurrentUserProfileSession {
  return { profile: toCurrentUserProfile(profile) };
}

export function getCurrentUserProfile(
  session: CurrentUserProfileSession
): CurrentUserProfile {
  return toCurrentUserProfile(session.profile);
}

export function saveCurrentUserProfile(
  session: CurrentUserProfileSession,
  profile: UserProfile
): CurrentUserProfileSession {
  return {
    ...session,
    profile: toCurrentUserProfile(profile)
  };
}

export function createProfileDraft(profile: UserProfile): ProfileDraft {
  return {
    ...cloneUserProfile(profile),
    destinations: profile.destinations.join(', ')
  };
}

export function toUserProfile(draft: ProfileDraft): UserProfile {
  return {
    ...draft,
    name: draft.name.trim(),
    city: draft.city.trim(),
    destinations: draft.destinations
      .split(',')
      .map((destination) => destination.trim())
      .filter(Boolean),
    interests: [...draft.interests],
    travelStyles: [...draft.travelStyles]
  };
}
