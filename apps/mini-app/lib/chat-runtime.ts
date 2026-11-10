import type { ChatMessageResponse, ChatResponse, TripProposalStatus } from './backend-api-client';
import { getProposalEventLabel } from './trip-proposal-runtime';

export type ChatsScreenState = 'empty' | 'error' | 'loading' | 'success';
export type ChatMessageHistoryState = 'empty' | 'success';

type ChatsScreenInput = Readonly<{
  isLoading: boolean;
  error: string | null;
  chats: readonly ChatResponse[];
}>;

export type RuntimeChatMessage = Readonly<{
  messageId: string;
  sequenceNumber: number;
  kind: 'participant' | 'system';
  isOwn: boolean;
  text: string;
  sentAtLabel: string;
  proposalId: string | null;
  proposalTripId: string | null;
  proposalStatus: TripProposalStatus | null;
  proposalBlockedReason: string | null;
}>;

type SubmitChatMessageInput = Readonly<{
  draft: string;
  isSending: boolean;
  messages: readonly ChatMessageResponse[];
  requestId: string;
  sendMessage: (contentText: string, requestId: string) => Promise<ChatMessageResponse>;
}>;

export type SubmitChatMessageResult = Readonly<{
  draft: string;
  error: string | null;
  messages: readonly ChatMessageResponse[];
}>;

const SEND_MESSAGE_ERROR = 'Не удалось отправить сообщение. Попробуйте ещё раз.';

export function getChatsScreenState({ isLoading, error, chats }: ChatsScreenInput): ChatsScreenState {
  if (isLoading) {
    return 'loading';
  }

  if (error !== null) {
    return 'error';
  }

  return chats.length === 0 ? 'empty' : 'success';
}

export function findChatById(chats: readonly ChatResponse[], chatId: string): ChatResponse | undefined {
  return chats.find((chat) => chat.chat_id === chatId);
}

export function getChatMessageHistoryState(messages: readonly unknown[]): ChatMessageHistoryState {
  return messages.length === 0 ? 'empty' : 'success';
}

export function getMessageAuthorLabel(
  chat: ChatResponse,
  message: ChatMessageResponse,
  currentUserId: string
): string | null {
  if (message.type !== 'user' || message.sender_user_id === null) {
    return null;
  }

  if (message.sender_user_id === currentUserId) {
    return 'Вы';
  }

  if (chat.type === 'direct') {
    return chat.companion.display_name;
  }

  return chat.participants.find((participant) => participant.user_id === message.sender_user_id)?.display_name ?? 'Участник';
}

export function appendServerMessage(
  messages: readonly ChatMessageResponse[],
  serverMessage: ChatMessageResponse
): ChatMessageResponse[] {
  if (messages.some((message) => message.message_id === serverMessage.message_id)) {
    return [...messages];
  }

  return [...messages, serverMessage].sort((first, second) => first.sequence_number - second.sequence_number);
}

export function mergeServerMessages(
  messages: readonly ChatMessageResponse[],
  incomingMessages: readonly ChatMessageResponse[]
): ChatMessageResponse[] {
  const byId = new Map(messages.map((message) => [message.message_id, message]));
  for (const message of incomingMessages) {
    byId.set(message.message_id, message);
  }
  return [...byId.values()].sort((first, second) => first.sequence_number - second.sequence_number);
}

export function formatChatListTimestamp(createdAt: string, now = new Date()): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const isToday = date.toLocaleDateString('ru-RU') === now.toLocaleDateString('ru-RU');
  return new Intl.DateTimeFormat('ru-RU', isToday
    ? { hour: '2-digit', minute: '2-digit' }
    : { day: 'numeric', month: 'short' }).format(date);
}

export function mapChatMessages(
  messages: readonly ChatMessageResponse[],
  currentUserId: string
): RuntimeChatMessage[] {
  return [...messages]
    .sort((first, second) => first.sequence_number - second.sequence_number)
    .map((message) => ({
      messageId: message.message_id,
      sequenceNumber: message.sequence_number,
      kind: message.type === 'system' ? 'system' : 'participant',
      isOwn: message.type === 'user' && message.sender_user_id === currentUserId,
      text: message.type === 'system' && message.system_event?.startsWith('proposal_')
        ? getProposalEventLabel(message.system_event)
        : message.content_text ?? 'Системное сообщение',
      sentAtLabel: formatMessageTime(message.created_at),
      proposalId: message.proposal_id ?? null,
      proposalTripId: message.proposal_trip_id ?? null,
      proposalStatus: message.proposal_status ?? null,
      proposalBlockedReason: message.proposal_blocked_reason ?? null
    }));
}

export async function submitChatMessage({
  draft,
  isSending,
  messages,
  requestId,
  sendMessage
}: SubmitChatMessageInput): Promise<SubmitChatMessageResult> {
  const contentText = draft.trim();

  if (isSending || !contentText) {
    return { draft, error: null, messages: [...messages] };
  }

  try {
    const serverMessage = await sendMessage(contentText, requestId);

    return {
      draft: '',
      error: null,
      messages: appendServerMessage(messages, serverMessage)
    };
  } catch {
    return { draft, error: SEND_MESSAGE_ERROR, messages: [...messages] };
  }
}

function formatMessageTime(createdAt: string): string {
  const date = new Date(createdAt);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(date);
}
