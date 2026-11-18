import type { ChatResponse } from './backend-api-client';

export type GroupChatCompanion = Extract<ChatResponse, { type: 'direct' }>['companion'];

export function getAvailableGroupChatCompanions(chats: readonly ChatResponse[]): GroupChatCompanion[] {
  return chats.flatMap((chat) =>
    chat.type === 'direct'
      ? [chat.companion]
      : []
  );
}

export function validateGroupChatCompanionIds(userIds: readonly string[]): string | null {
  if (userIds.length < 2) {
    return 'Выберите минимум двух собеседников.';
  }

  return new Set(userIds).size === userIds.length ? null : 'Выберите разных собеседников.';
}

export function normalizeGroupChatTitle(value: string): { title: string | null; error: string | null } {
  const title = value.trim();
  if (Array.from(title).length > 80) {
    return { title: null, error: 'Название не должно превышать 80 символов.' };
  }
  return { title: title || null, error: null };
}
