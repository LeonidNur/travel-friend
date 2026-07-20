import Link from 'next/link';

import { ChatRoom } from '@/components/ChatRoom';
import { getChatById } from '@/lib/mock-chats';
import { getActiveTripByChatId } from '@/lib/mock-trips';

interface ChatRoomPageProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function ChatRoomPage({ params }: ChatRoomPageProps) {
  const { id } = await params;
  const chat = getChatById(id);

  if (!chat) {
    return (
      <section className="page">
        <article className="surface-card surface-card--compact empty-state-card">
          <p className="section-kicker">Чат не найден</p>
          <h2 className="empty-state-card__title">Чат не найден</h2>
          <p className="surface-card__copy">
            Возможно, этого чата нет в текущем наборе демонстрационных диалогов или ссылка устарела.
          </p>
          <Link className="profile-button profile-button--secondary" href="/chats">
            Вернуться к списку чатов
          </Link>
        </article>
      </section>
    );
  }

  const activeTrip = getActiveTripByChatId(chat.id);

  return <ChatRoom chat={chat} tripId={activeTrip?.id} />;
}
