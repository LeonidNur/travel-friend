import type { ChatParticipantProfileResponse } from './backend-api-client';

export type ChatParticipantProfileScreenState = 'error' | 'loading' | 'not_found' | 'success';

type ChatParticipantProfileScreenInput = Readonly<{
  isLoading: boolean;
  errorStatus: number | null;
  profile: Pick<ChatParticipantProfileResponse, 'user_id'> | null;
}>;

export function getChatParticipantProfilePath(chatId: string, userId: string): string {
  return `/chats/${chatId}/participants/${userId}`;
}

export function getGroupParticipantProfilePath(
  chatId: string,
  participantUserId: string,
  currentUserId: string
): string {
  return participantUserId === currentUserId
    ? '/profile'
    : getChatParticipantProfilePath(chatId, participantUserId);
}

export function getChatParticipantProfileScreenState({
  isLoading,
  errorStatus,
  profile
}: ChatParticipantProfileScreenInput): ChatParticipantProfileScreenState {
  if (isLoading) {
    return 'loading';
  }

  if (errorStatus === 404) {
    return 'not_found';
  }

  return profile === null ? 'error' : 'success';
}
