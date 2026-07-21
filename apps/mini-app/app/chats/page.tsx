import Link from 'next/link';

import { mockChats } from '@/lib/mock-chats';
import type { ChatStatus } from '@/lib/types';

const CHAT_STATUS_DISPLAY_LABELS: Record<ChatStatus, string> = {
  match: 'Демо-мэтч',
  interest_sent: 'Интерес отмечен',
  draft: 'Черновик обсуждения'
};

export default function ChatsPage() {
  return (
    <section className="page">
      <article className="hero-card">
        <p className="section-kicker">Чаты поездок</p>
        <h2 className="hero-card__title">Список будущих обсуждений по поездкам</h2>
        <p className="hero-card__copy">
          Здесь показаны демонстрационные диалоги для проверки сценария. Они пока не
          синхронизируются с реальными пользователями.
        </p>
      </article>

      {mockChats.length === 0 ? (
        <article className="surface-card surface-card--compact empty-state-card">
          <p className="section-kicker">Чатов пока нет</p>
          <h2 className="empty-state-card__title">Здесь появятся ваши обсуждения</h2>
          <p className="surface-card__copy">
            Обсуждения появляются после взаимного интереса. В текущем демо-режиме действия с
            анкетами не создают реальные чаты.
          </p>
          <Link className="profile-button profile-button--primary" href="/">
            Перейти к анкетам
          </Link>
        </article>
      ) : (
        <section className="list-stack" aria-label="Список демонстрационных чатов">
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
                <span className={`chat-status chat-status--${chat.status}`}>{CHAT_STATUS_DISPLAY_LABELS[chat.status]}</span>
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
      )}
    </section>
  );
}
