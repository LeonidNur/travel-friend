import type { ChatParticipant } from './types';

export function formatChatParticipantLabel(participant: ChatParticipant): string {
  return `${participant.name}, ${participant.age} · ${participant.city}`;
}
