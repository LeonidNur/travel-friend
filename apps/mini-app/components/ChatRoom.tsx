'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';

import { useTelegramAuthSession } from '@/components/TelegramAuthBootstrapProvider';
import {
  ApiError,
  createBackendApiClient,
  type ChatMessageResponse,
  type ChatResponse
} from '@/lib/backend-api-client';
import { findChatById, getMessageAuthorLabel, mapChatMessages, submitChatMessage } from '@/lib/chat-runtime';
import { createChatTrip, getCreateTripButtonState } from '@/lib/chat-trip-runtime';
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
  const router = useRouter();
  const [chat, setChat] = useState<ChatResponse | null>(null);
  const [messages, setMessages] = useState<ChatMessageResponse[]>([]);
  const [roomState, setRoomState] = useState<ChatRoomState>('loading');
  const [draftMessage, setDraftMessage] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isCreatingTrip, setIsCreatingTrip] = useState(false);
  const [tripError, setTripError] = useState<string | null>(null);
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

  const handleCreateTrip = async () => {
    if (session === null || chat === null || isCreatingTrip) {
      return;
    }

    setIsCreatingTrip(true);
    setTripError(null);
    const result = await createChatTrip({
      chatId: chat.chat_id,
      createTrip: () => backendApiClient.createTrip(session.accessToken, chat.chat_id),
      getTrips: () => backendApiClient.getTrips(session.accessToken)
    });

    if (result.tripPath !== null) {
      router.push(result.tripPath);
      return;
    }

    setTripError(result.error);
    setIsCreatingTrip(false);
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

  const isGroupChat = chat.type === 'group';
  const companion = chat.type === 'direct' ? chat.companion : null;
  const chatTitle = isGroupChat ? 'Групповой чат' : companion?.display_name ?? '';
  const tripButtonState = getCreateTripButtonState(isCreatingTrip);

  return (
    <section className="page">
      <article className="hero-card chat-room-hero">
        <div className="profile-header">
          <Link className="profile-button profile-button--secondary profile-back-button" href="/chats">
            Назад к чатам
          </Link>
          <span className="profile-status">Чат</span>
        </div>
        <p className="section-kicker">{isGroupChat ? 'Группа' : 'Диалог'}</p>
        {/* TODO: enable this link after public profiles support backend UUID user ids. */}
        <div className="profile-hero">
          <div className="profile-hero__avatar" aria-hidden="true">
            {getAvatarInitials(chatTitle)}
          </div>
          <div className="profile-hero__content">
            <h2 className="hero-card__title profile-hero__title">{chatTitle}</h2>
            {companion !== null ? <p className="profile-hero__city">{companion.city ?? 'Город не указан'}</p> : null}
          </div>
        </div>
      </article>

      <article className="surface-card surface-card--compact">
        <div className="chat-room__participants-header">
          <p className="surface-card__title">{isGroupChat ? 'Участники' : 'Собеседник'}</p>
          <span className="chat-room__participants-count">
            {isGroupChat ? `${chat.participant_count} участников` : 'Прямой чат'}
          </span>
        </div>
        <div className="chat-room__participants" aria-label={isGroupChat ? 'Участники чата' : 'Собеседник в чате'}>
          {isGroupChat ? chat.participants.map((participant) => {
            const participantName = participant.display_name ?? 'Имя не указано';

            return (
              <div className="chat-room__participant" key={participant.user_id}>
                <div className="chat-room__participant-avatar" aria-hidden="true">
                  {getAvatarInitials(participantName)}
                </div>
                <div className="chat-room__participant-copy">
                  <p className="chat-room__participant-name">{participantName}</p>
                </div>
              </div>
            );
          }) : companion === null ? null : (
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
          )}
        </div>
      </article>

      <article className="surface-card surface-card--compact">
        <p className="surface-card__title">Поездка</p>
        <p className="surface-card__copy">Создайте поездку для участников этого чата.</p>
        {tripError !== null ? <p className="chat-room__composer-note" role="alert">{tripError}</p> : null}
        <button className="profile-button profile-button--primary" disabled={tripButtonState.disabled} type="button" onClick={handleCreateTrip}>
          {tripButtonState.label}
        </button>
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

            const sourceMessage = messages.find((source) => source.message_id === message.messageId);
            const authorLabel = sourceMessage === undefined ? null : getMessageAuthorLabel(chat, sourceMessage, session?.userId ?? '');

            return (
              <div className={getMessageClassName(message.isOwn)} key={message.messageId}>
                {authorLabel === null ? null : <p className="chat-room__message-author">{authorLabel}</p>}
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
