'use client';

import Link from 'next/link';
import { FormEvent, useMemo, useState } from 'react';

import { getChatCompanion, getChatParticipantById, getChatTitle, isDirectChat, type LocalChatMessage } from '@/lib/mock-chats';
import { getAvatarInitials } from '@/lib/travel-preferences';
import type { MockChat } from '@/lib/types';

interface ChatRoomProps {
  chat: MockChat;
}

function getMessageClassName(isCurrentUser: boolean) {
  return `chat-room__message${isCurrentUser ? ' chat-room__message--outgoing' : ' chat-room__message--incoming'}`;
}

export function ChatRoom({ chat }: ChatRoomProps) {
  const companion = getChatCompanion(chat);
  const companionProfileHref = isDirectChat(chat) && companion?.buddyProfileId ? `/buddies/${companion.buddyProfileId}` : null;
  const [draftMessage, setDraftMessage] = useState('');
  const [localMessages, setLocalMessages] = useState<LocalChatMessage[]>([]);

  const messages = useMemo(() => [...chat.messages, ...localMessages], [chat.messages, localMessages]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedMessage = draftMessage.trim();

    if (!trimmedMessage) {
      return;
    }

    setLocalMessages((current) => [
      ...current,
      {
        id: `local-message-${current.length + 1}`,
        kind: 'participant',
        authorId: 'current-user',
        text: trimmedMessage,
        sentAtLabel: 'только что'
      }
    ]);
    setDraftMessage('');
  };

  return (
    <section className="page">
      <article className="hero-card chat-room-hero">
        <div className="profile-header">
          <Link className="profile-button profile-button--secondary profile-back-button" href="/chats">
            Назад к чатам
          </Link>
          <span className="profile-status">Local-only MVP</span>
        </div>
        <p className="section-kicker">Chat room</p>
        {companionProfileHref ? (
          <Link className="profile-hero chat-room__profile-link" href={companionProfileHref}>
            <div className="profile-hero__avatar" aria-hidden="true">
              {getAvatarInitials(companion?.name ?? chat.title)}
            </div>
            <div className="profile-hero__content">
              <h2 className="hero-card__title profile-hero__title">{getChatTitle(chat)}</h2>
              <p className="profile-hero__city">Направление: {chat.destination}</p>
            </div>
          </Link>
        ) : (
          <div className="profile-hero">
            <div className="profile-hero__avatar" aria-hidden="true">
              {getAvatarInitials(companion?.name ?? chat.title)}
            </div>
            <div className="profile-hero__content">
              <h2 className="hero-card__title profile-hero__title">{getChatTitle(chat)}</h2>
              <p className="profile-hero__city">Направление: {chat.destination}</p>
            </div>
          </div>
        )}
        <p className="surface-card__copy">
          Временный экран для проверки логики переписки. Новые сообщения живут только в памяти текущего экрана.
        </p>
      </article>

      <article className="surface-card surface-card--compact">
        <div className="chat-room__participants-header">
          <p className="surface-card__title">Участники</p>
          <span className="chat-room__participants-count">{chat.participants.length} участника</span>
        </div>
        <div className="chat-room__participants" aria-label="Участники чата">
          {chat.participants.map((participant) => (
            <div className="chat-room__participant" key={participant.id}>
              <div className="chat-room__participant-avatar" aria-hidden="true">
                {getAvatarInitials(participant.name)}
              </div>
              <div className="chat-room__participant-copy">
                <p className="chat-room__participant-name">
                  {participant.name}, {participant.age}
                  {participant.isCurrentUser ? ' · Вы' : ''}
                </p>
                <p className="chat-room__participant-meta">{participant.city}</p>
              </div>
            </div>
          ))}
        </div>
      </article>

      <section className="surface-card chat-room" aria-label="История сообщений">
        <div className="chat-room__timeline">
          {messages.map((message) => {
            if (message.kind === 'system') {
              return (
                <div className="chat-room__system-block" key={message.id}>
                  <div className="chat-room__system-message">
                    <p className="chat-room__system-text">{message.text}</p>
                    <span className="chat-room__message-time">{message.sentAtLabel}</span>
                  </div>
                  {message.actionHref && message.actionLabel ? (
                    <Link className="profile-button profile-button--secondary chat-room__system-action" href={message.actionHref}>
                      {message.actionLabel}
                    </Link>
                  ) : null}
                </div>
              );
            }

            const author = getChatParticipantById(chat, message.authorId);
            const isCurrentUser = Boolean(author?.isCurrentUser);

            return (
              <div className={getMessageClassName(isCurrentUser)} key={message.id}>
                <p className="chat-room__message-author">{isCurrentUser ? 'Вы' : (author?.name ?? 'Участник')}</p>
                <p className="chat-room__message-text">{message.text}</p>
                <span className="chat-room__message-time">{message.sentAtLabel}</span>
              </div>
            );
          })}
        </div>

        <form className="chat-room__composer" onSubmit={handleSubmit}>
          <label className="sr-only" htmlFor="chat-room-message">
            Сообщение
          </label>
          <textarea
            id="chat-room-message"
            className="profile-input chat-room__input"
            value={draftMessage}
            onChange={(event) => setDraftMessage(event.target.value)}
            placeholder="Напишите сообщение для старта обсуждения"
            rows={3}
          />
          <div className="chat-room__composer-footer">
            <p className="chat-room__composer-note">Пустое сообщение не отправляется. История не сохраняется после перезагрузки.</p>
            <button className="profile-button profile-button--primary" type="submit">
              Отправить
            </button>
          </div>
        </form>
      </section>
    </section>
  );
}
