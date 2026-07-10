import Link from 'next/link';

import { CHAT_STATUS_LABELS, mockChats } from '@/lib/mock-chats';

export default function ChatsPage() {
  return (
    <section className="page">
      <article className="hero-card">
        <p className="section-kicker">Чаты поездок</p>
        <h2 className="hero-card__title">Список будущих обсуждений по поездкам</h2>
        <p className="hero-card__copy">
          После мэтчей и отправленных интересов здесь будут собираться обсуждения будущих поездок.
          Сейчас это MVP-заготовка списка, чтобы было понятно, как будет выглядеть вход в общение.
        </p>
      </article>

      <section className="list-stack" aria-label="Список mock-чатов">
        {mockChats.map((chat) => (
          <Link className="surface-card surface-card--compact chat-card chat-card--link" key={chat.id} href={`/chats/${chat.id}`}>
            <div className="chat-card__header">
              <div>
                <p className="surface-card__title">{chat.title}</p>
                <p className="chat-card__meta">
                  {chat.participants
                    .filter((participant) => !participant.isCurrentUser)
                    .map((participant) => `${participant.name}, ${participant.age} · ${participant.city}`)
                    .join(' · ')}
                </p>
              </div>
              <span className={`chat-status chat-status--${chat.status}`}>{CHAT_STATUS_LABELS[chat.status]}</span>
            </div>

            <p className="chat-card__route">Направление: {chat.destination}</p>
            <p className="surface-card__copy">{chat.previewText}</p>

            <div className="chat-card__footer">
              <span className="chat-card__updated">{chat.updatedLabel}</span>
              <span className="chat-card__hint">Открыть чат</span>
            </div>
          </Link>
        ))}
      </section>
    </section>
  );
}
