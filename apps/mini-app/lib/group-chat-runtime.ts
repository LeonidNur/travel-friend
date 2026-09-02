import type { ChatResponse } from './backend-api-client';

export type GroupChatCompanion = Readonly<{
  user_id: string;
  display_name: string;
}>;

export function getAvailableGroupChatCompanions(chats: readonly ChatResponse[]): GroupChatCompanion[] {
  return chats.flatMap((chat) =>
    chat.type === 'direct'
      ? [{ user_id: chat.companion.user_id, display_name: chat.companion.display_name }]
      : []
  );
}

export function validateGroupChatCompanionIds(userIds: readonly string[]): string | null {
  if (userIds.length < 2) {
    return 'Выберите минимум двух собеседников.';
  }

  return new Set(userIds).size === userIds.length ? null : 'Выберите разных собеседников.';
}
