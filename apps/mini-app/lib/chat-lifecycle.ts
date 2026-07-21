import type { ChatStatus } from './types';

const CHAT_MESSAGE_ACCESS_NOTICES: Record<ChatStatus, string | null> = {
  match: null,
  interest_sent: 'Переписка недоступна в этом демонстрационном сценарии.',
  draft: 'Этот черновик обсуждения ещё не активирован.'
};

export function canSendMessagesForChatStatus(status: ChatStatus): boolean {
  return status === 'match';
}

export function getChatMessageAccessNotice(status: ChatStatus): string | null {
  return CHAT_MESSAGE_ACCESS_NOTICES[status];
}
