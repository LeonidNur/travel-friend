import Link from 'next/link';
import type { ChatResponse } from '@/lib/backend-api-client';
import { formatChatListTimestamp } from '@/lib/chat-runtime';
import { getAvatarInitials } from '@/lib/travel-preferences';

export function ChatListRow({ chat, currentUserId }: Readonly<{ chat: ChatResponse; currentUserId: string | undefined }>) {
  const name = chat.type === 'direct' ? `${chat.companion.display_name}${chat.companion.age === null ? '' : `, ${chat.companion.age}`}` : chat.title ?? chat.participants.map((person) => person.display_name ?? 'Имя не указано').join(', ');
  return <Link className="surface-card surface-card--compact chat-card chat-card--link" href={`/chats/${chat.chat_id}`}>
    <div className="chat-card__avatar" aria-hidden="true">{chat.type === 'group' ? chat.participant_count : getAvatarInitials(chat.companion.display_name)}</div>
    <div className="chat-card__content"><div className="chat-card__header"><div className="chat-card__identity"><p className="chat-card__name">{name}</p></div></div>
      <div className="chat-card__secondary"><p className="chat-card__last-message">{chat.last_message === null ? 'Сообщений пока нет' : `${chat.last_message.sender_user_id === currentUserId ? 'Вы: ' : ''}${chat.last_message.content_text ?? 'Системное сообщение'}`}</p>
        <div className="chat-card__preview"><span className="chat-card__preview-time">{chat.last_message === null ? '' : formatChatListTimestamp(chat.last_message.created_at)}</span>{chat.unread_count > 0 ? <span className="chat-card__unread" aria-label={`Непрочитанных сообщений: ${chat.unread_count}`}>{chat.unread_count}</span> : null}</div>
      </div>
    </div>
  </Link>;
}
