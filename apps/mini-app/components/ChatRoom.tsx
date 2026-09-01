'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';

import { useTelegramAuthSession } from '@/components/TelegramAuthBootstrapProvider';
import {
  ApiError,
  createBackendApiClient,
  type ChatMessageResponse,
  type DirectChatResponse
} from '@/lib/backend-api-client';
import { findChatById, mapChatMessages, submitChatMessage } from '@/lib/chat-runtime';
import { getAvatarInitials } from '@/lib/travel-preferences';

type ChatRoomState = 'error' | 'loaded' | 'loading' | 'not_found';

interface ChatRoomProps {
  chatId: string;
}

const backendApiClient = createBackendApiClient();

function getMessageClassName(isCurrentUser: boolean) {
  return `chat-room__message${isCurrentUser ? ' chat-room__message--outgoing' : ' chat-room__message--incoming'}`;
}

export function ChatRoom({ chatId }: ChatRoomProps) {
  const { session } = useTelegramAuthSession();
  const [chat, setChat] = useState<DirectChatResponse | null>(null);
  const [messages, setMessages] = useState<ChatMessageResponse[]>([]);
  const [roomState, setRoomState] = useState<ChatRoomState>('loading');
  const [draftMessage, setDraftMessage] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const sendingRef = useRef(false);

  useEffect(() => {
    if (session === null) {
      return;
    }

    let isCurrent = true;

    void (async () => {
      try {
        const chats = await backendApiClient.getChats(session.accessToken);
        const nextChat = findChatById(chats, chatId);

        if (!nextChat) {
          if (isCurrent) {
            setRoomState('not_found');
          }
          return;
        }

        const history = await backendApiClient.getChatMessages(session.accessToken, chatId);

        if (isCurrent) {
          setChat(nextChat);
          setMessages(history);
          setRoomState('loaded');
        }
      } catch (error) {
        if (!isCurrent) {
          return;
        }

        setRoomState(error instanceof ApiError && error.status === 404 ? 'not_found' : 'error');
      }
    })();

    return () => {
      isCurrent = false;
    };
  }, [chatId, session]);

  const renderedMessages = useMemo(
    () => (session === null ? [] : mapChatMessages(messages, session.userId)),
    [messages, session]
  );

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (session === null || chat === null || sendingRef.current || !draftMessage.trim()) {
      return;
    }

    sendingRef.current = true;
    setIsSending(true);
    setSendError(null);

    const result = await submitChatMessage({
      draft: draftMessage,
      isSending: false,
      messages,
      sendMessage: (contentText) =>
        backendApiClient.createChatMessage(session.accessToken, chat.chat_id, { content_text: contentText })
    });

    setMessages([...result.messages]);
    setDraftMessage(result.draft);
    setSendError(result.error);
    sendingRef.current = false;
    setIsSending(false);
  };

  if (roomState === 'loading') {
    return (
      <section className="page" aria-live="polite">
        <article className="surface-card surface-card--compact empty-state-card">
          <p className="section-kicker">Загружаем чат</p>
          <p className="surface-card__copy">Получаем историю сообщений.</p>
        </article>
      </section>
    );
  }

  if (roomState === 'not_found') {
    return <ChatRoomUnavailable title="Чат не найден" message="Этот чат недоступен или ссылка устарела." />;
  }

  if (roomState === 'error' || chat === null) {
    return <ChatRoomUnavailable title="Не удалось загрузить чат" message="Попробуйте открыть чат ещё раз." />;
  }

  const companion = chat.companion;

  return (
    <section className="page">
      <article className="hero-card chat-room-hero">
        <div className="profile-header">
          <Link className="profile-button profile-button--secondary profile-back-button" href="/chats">
            Назад к чатам
          </Link>
          <span className="profile-status">Чат</span>
        </div>
        <p className="section-kicker">Диалог</p>
        {/* TODO: enable this link after public profiles support backend UUID user ids. */}
        <div className="profile-hero">
          <div className="profile-hero__avatar" aria-hidden="true">
            {getAvatarInitials(companion.display_name)}
          </div>
          <div className="profile-hero__content">
            <h2 className="hero-card__title profile-hero__title">{companion.display_name}</h2>
            <p className="profile-hero__city">{companion.city ?? 'Город не указан'}</p>
          </div>
        </div>
      </article>

      <article className="surface-card surface-card--compact">
        <div className="chat-room__participants-header">
          <p className="surface-card__title">Собеседник</p>
          <span className="chat-room__participants-count">Прямой чат</span>
        </div>
        <div className="chat-room__participants" aria-label="Собеседник в чате">
          <div className="chat-room__participant">
            <div className="chat-room__participant-avatar" aria-hidden="true">
              {getAvatarInitials(companion.display_name)}
            </div>
            <div className="chat-room__participant-copy">
              <p className="chat-room__participant-name">
                {companion.display_name}
                {companion.age === null ? '' : `, ${companion.age}`}
              </p>
              <p className="chat-room__participant-meta">{companion.city ?? 'Город не указан'}</p>
            </div>
          </div>
        </div>
      </article>

      <section className="surface-card chat-room" aria-label="История сообщений">
        <div className="chat-room__timeline">
          {renderedMessages.map((message) => {
            if (message.kind === 'system') {
              return (
                <div className="chat-room__system-block" key={message.messageId}>
                  <div className="chat-room__system-message">
                    <p className="chat-room__system-text">{message.text}</p>
                    <span className="chat-room__message-time">{message.sentAtLabel}</span>
                  </div>
                </div>
              );
            }

            return (
              <div className={getMessageClassName(message.isOwn)} key={message.messageId}>
                <p className="chat-room__message-author">{message.isOwn ? 'Вы' : companion.display_name}</p>
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
            disabled={isSending}
          />
          <div className="chat-room__composer-footer">
            <p className="chat-room__composer-note" role={sendError ? 'alert' : undefined}>
              {sendError ?? 'Сообщение будет добавлено в чат после подтверждения сервером.'}
            </p>
            <button className="profile-button profile-button--primary" type="submit" disabled={isSending}>
              {isSending ? 'Отправляем…' : 'Отправить сообщение'}
            </button>
          </div>
        </form>
      </section>
    </section>
  );
}

function ChatRoomUnavailable({ title, message }: Readonly<{ title: string; message: string }>) {
  return (
    <section className="page">
      <article className="surface-card surface-card--compact empty-state-card">
        <p className="section-kicker">{title}</p>
        <h2 className="empty-state-card__title">{title}</h2>
        <p className="surface-card__copy">{message}</p>
        <Link className="profile-button profile-button--secondary" href="/chats">
          Вернуться к списку чатов
        </Link>
      </article>
    </section>
  );
}
