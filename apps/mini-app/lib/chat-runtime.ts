import type { ChatMessageResponse, DirectChatResponse } from './backend-api-client';

export type ChatsScreenState = 'empty' | 'error' | 'loading' | 'success';

type ChatsScreenInput = Readonly<{
  isLoading: boolean;
  error: string | null;
  chats: readonly DirectChatResponse[];
}>;

export type RuntimeChatMessage = Readonly<{
  messageId: string;
  sequenceNumber: number;
  kind: 'participant' | 'system';
  isOwn: boolean;
  text: string;
  sentAtLabel: string;
}>;

type SubmitChatMessageInput = Readonly<{
  draft: string;
  isSending: boolean;
  messages: readonly ChatMessageResponse[];
  sendMessage: (contentText: string) => Promise<ChatMessageResponse>;
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

export function findChatById(chats: readonly DirectChatResponse[], chatId: string): DirectChatResponse | undefined {
  return chats.find((chat) => chat.chat_id === chatId);
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
      text: message.content_text ?? 'Системное сообщение',
      sentAtLabel: formatMessageTime(message.created_at)
    }));
}

export async function submitChatMessage({
  draft,
  isSending,
  messages,
  sendMessage
}: SubmitChatMessageInput): Promise<SubmitChatMessageResult> {
  const contentText = draft.trim();

  if (isSending || !contentText) {
    return { draft, error: null, messages: [...messages] };
  }

  try {
    const serverMessage = await sendMessage(contentText);

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
