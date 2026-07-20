import { CURRENT_USER_ID, type CurrentUserProfile } from './mock-current-user';
import type { ChatParticipant } from './types';

export function getDisplayedChatParticipant(
  participant: ChatParticipant,
  currentUserProfile: CurrentUserProfile
): ChatParticipant {
  if (participant.id !== CURRENT_USER_ID) {
    return participant;
  }

  return {
    ...participant,
    name: currentUserProfile.name,
    age: currentUserProfile.age,
    city: currentUserProfile.city,
    isCurrentUser: true
  };
}
