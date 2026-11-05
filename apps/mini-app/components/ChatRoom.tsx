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
import {
  findChatById,
  getChatMessageHistoryState,
  getMessageAuthorLabel,
  mergeServerMessages,
  mapChatMessages,
  submitChatMessage
} from '@/lib/chat-runtime';
import {
  createChatTrip,
  loadChatTripNavigationState,
  getTripNavigationDescription,
  getTripNavigationButtonState,
  type TripNavigationLookupState
} from '@/lib/chat-trip-runtime';
import { getAvatarInitials } from '@/lib/travel-preferences';
import {
  getChatParticipantProfilePath,
  getGroupParticipantProfilePath
} from '@/lib/chat-participant-profile-runtime';

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
  const [hasMoreOlder, setHasMoreOlder] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const [syncError, setSyncError] = useState(false);
  const [readError, setReadError] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [readRetryKey, setReadRetryKey] = useState(0);
  const [roomState, setRoomState] = useState<ChatRoomState>('loading');
  const [reloadKey, setReloadKey] = useState(0);
  const [draftMessage, setDraftMessage] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isCreatingTrip, setIsCreatingTrip] = useState(false);
  const [tripError, setTripError] = useState<string | null>(null);
  const [tripLookup, setTripLookup] = useState<TripNavigationLookupState>({ status: 'loading' });
  const [tripLookupKey, setTripLookupKey] = useState(0);
  const sendingRef = useRef(false);
  const retrySendRef = useRef(new Map<string, string>());
  const afterSequenceRef = useRef(0);
  const lastReadRequestedRef = useRef(0);
  const readRetryDelayRef = useRef(1_000);
  const readRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

        const history = await backendApiClient.getChatMessagePage(session.accessToken, chatId);

        if (isCurrent) {
          setChat(nextChat);
          setMessages(history.messages);
          setHasMoreOlder(history.has_more_older);
          afterSequenceRef.current = history.high_water_sequence;
          lastReadRequestedRef.current = 0;
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
  }, [chatId, reloadKey, session]);

  useEffect(() => {
    if (session === null || chat === null || roomState !== 'loaded') {
      return;
    }

    let isCurrent = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const offlineSyncTimer = setTimeout(() => setIsOffline(!navigator.onLine), 0);
    let isPolling = false;
    let retryDelay = 15_000;

    const clearTimer = () => {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    };

    const schedule = (delay: number) => {
      clearTimer();
      if (isCurrent && document.visibilityState === 'visible' && navigator.onLine) {
        timer = setTimeout(() => void poll(), delay);
      }
    };

    const poll = async () => {
      if (!isCurrent || isPolling || document.visibilityState !== 'visible' || !navigator.onLine) {
        return;
      }
      isPolling = true;
      try {
        for (let pageCount = 0; pageCount < 4; pageCount += 1) {
          const page = await backendApiClient.getChatMessagePage(
            session.accessToken,
            chat.chat_id,
            { after_sequence: afterSequenceRef.current, limit: 100 }
          );
          if (!isCurrent) {
            return;
          }
          if (page.messages.length > 0) {
            setMessages((currentMessages) => mergeServerMessages(currentMessages, page.messages));
          }
          afterSequenceRef.current = page.next_after_sequence;
          if (!page.has_more_newer) {
            break;
          }
        }
        retryDelay = 15_000;
        setSyncError(false);
        schedule(retryDelay);
      } catch {
        setSyncError(true);
        retryDelay = Math.min(120_000, retryDelay * 2);
        schedule(retryDelay * (0.8 + Math.random() * 0.4));
      } finally {
        isPolling = false;
      }
    };

    const resume = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        setIsOffline(false);
        setReadRetryKey((key) => key + 1);
        void poll();
      } else {
        clearTimer();
        setIsOffline(!navigator.onLine);
      }
    };

    const goOffline = () => {
      clearTimer();
      setIsOffline(true);
    };

    schedule(retryDelay);
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('focus', resume);
    window.addEventListener('online', resume);
    window.addEventListener('offline', goOffline);

    return () => {
      isCurrent = false;
      clearTimer();
      clearTimeout(offlineSyncTimer);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('focus', resume);
      window.removeEventListener('online', resume);
      window.removeEventListener('offline', goOffline);
    };
  }, [chat, roomState, session]);

  useEffect(() => {
    if (session === null || chat === null || roomState !== 'loaded' || messages.length === 0 ||
        document.visibilityState !== 'visible') {
      return;
    }
    const displayedSequence = messages[messages.length - 1].sequence_number;
    if (displayedSequence <= lastReadRequestedRef.current) {
      return;
    }
    lastReadRequestedRef.current = displayedSequence;
    void backendApiClient.markChatRead(session.accessToken, chat.chat_id, displayedSequence).catch(() => {
      if (lastReadRequestedRef.current === displayedSequence) {
        setReadError(true);
        lastReadRequestedRef.current = 0;
        if (readRetryTimerRef.current !== null) clearTimeout(readRetryTimerRef.current);
        const delay = readRetryDelayRef.current;
        readRetryDelayRef.current = Math.min(30_000, delay * 2);
        if (document.visibilityState === 'visible' && navigator.onLine) {
          readRetryTimerRef.current = setTimeout(() => {
            readRetryTimerRef.current = null;
            setReadRetryKey((key) => key + 1);
          }, delay);
        }
      }
    }).then(() => {
      if (lastReadRequestedRef.current === displayedSequence) {
        setReadError(false);
        readRetryDelayRef.current = 1_000;
        if (readRetryTimerRef.current !== null) {
          clearTimeout(readRetryTimerRef.current);
          readRetryTimerRef.current = null;
        }
      }
    });
  }, [chat, messages, readRetryKey, roomState, session]);

  useEffect(() => () => {
    if (readRetryTimerRef.current !== null) clearTimeout(readRetryTimerRef.current);
  }, []);

  useEffect(() => {
    if (session === null || chat === null || roomState !== 'loaded') {
      return;
    }

    let isCurrent = true;
    void loadChatTripNavigationState(chat.chat_id, () => backendApiClient.getTrips(session.accessToken)).then((state) => {
      if (!isCurrent) {
        return;
      }

      setTripLookup(state);
    });

    return () => {
      isCurrent = false;
    };
  }, [chat, roomState, session, tripLookupKey]);

  const renderedMessages = useMemo(
    () => (session === null ? [] : mapChatMessages(messages, session.userId)),
    [messages, session]
  );
  const messageHistoryState = getChatMessageHistoryState(renderedMessages);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (session === null || chat === null || sendingRef.current || !draftMessage.trim()) {
      return;
    }

    sendingRef.current = true;
    setIsSending(true);
    setSendError(null);

    const contentText = draftMessage.trim();
    let requestId = retrySendRef.current.get(contentText);
    if (requestId === undefined) {
      requestId = crypto.randomUUID();
      retrySendRef.current.set(contentText, requestId);
    }
    const result = await submitChatMessage({
      draft: draftMessage,
      isSending: false,
      messages,
      requestId,
      sendMessage: (contentText, clientRequestId) =>
        backendApiClient.createChatMessage(session.accessToken, chat.chat_id, {
          content_text: contentText,
          client_request_id: clientRequestId
        })
    });

    setMessages((currentMessages) => mergeServerMessages(currentMessages, result.messages));
    setDraftMessage(result.draft);
    setSendError(result.error);
    if (result.error === null) {
      retrySendRef.current.delete(contentText);
    }
    sendingRef.current = false;
    setIsSending(false);
  };

  const handleLoadOlder = async () => {
    const firstMessage = messages[0];
    if (session === null || chat === null || firstMessage === undefined || isLoadingOlder) {
      return;
    }
    setIsLoadingOlder(true);
    setHistoryError(false);
    try {
      const page = await backendApiClient.getChatMessagePage(session.accessToken, chat.chat_id, {
        before_sequence: firstMessage.sequence_number,
        limit: 50
      });
      setMessages((currentMessages) => mergeServerMessages(currentMessages, page.messages));
      setHasMoreOlder(page.has_more_older);
    } catch {
      setHistoryError(true);
    } finally {
      setIsLoadingOlder(false);
    }
  };

  const handleCreateTrip = async () => {
    if (session === null || chat === null || isCreatingTrip) {
      return;
    }

    if (tripLookup.status !== 'loaded') {
      return;
    }

    if (tripLookup.tripId !== null) {
      router.push(`/trips/${tripLookup.tripId}`);
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

  const retryTripLookup = () => {
    setTripError(null);
    setTripLookup({ status: 'loading' });
    setTripLookupKey((key) => key + 1);
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
    return (
      <ChatRoomUnavailable
        title="Не удалось загрузить чат"
        message="Попробуйте открыть чат ещё раз."
        onRetry={() => {
          setRoomState('loading');
          setTripLookup({ status: 'loading' });
          setReloadKey((key) => key + 1);
        }}
      />
    );
  }

  const isGroupChat = chat.type === 'group';
  const companion = chat.type === 'direct' ? chat.companion : null;
  const chatTitle = isGroupChat ? 'Групповой чат' : companion?.display_name ?? '';
  const tripButtonState = getTripNavigationButtonState(tripLookup, isCreatingTrip);

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
        <div className="profile-hero">
          <div className="profile-hero__avatar" aria-hidden="true">
            {getAvatarInitials(chatTitle)}
          </div>
          <div className="profile-hero__content">
            <h2 className="hero-card__title profile-hero__title">{chatTitle}</h2>
            {companion !== null ? <p className="profile-hero__city">{companion.city ?? 'Город не указан'}</p> : null}
            {companion !== null ? <Link href={getChatParticipantProfilePath(chat.chat_id, companion.user_id)}>Открыть профиль</Link> : null}
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
              <Link
                className="chat-room__participant"
                href={getGroupParticipantProfilePath(chat.chat_id, participant.user_id, session?.userId ?? '')}
                key={participant.user_id}
              >
                <div className="chat-room__participant-avatar" aria-hidden="true">
                  {getAvatarInitials(participantName)}
                </div>
                <div className="chat-room__participant-copy">
                  <p className="chat-room__participant-name">{participantName}</p>
                </div>
              </Link>
            );
          }) : companion === null ? null : (
            <Link className="chat-room__participant" href={getChatParticipantProfilePath(chat.chat_id, companion.user_id)}>
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
            </Link>
          )}
        </div>
      </article>

      <article className="surface-card surface-card--compact">
        <p className="surface-card__title">Поездка</p>
        <p className="surface-card__copy">{getTripNavigationDescription(tripLookup)}</p>
        {tripLookup.status === 'error' ? (
          <p className="chat-room__composer-note" role="alert">Не удалось проверить поездку. Повторите попытку.</p>
        ) : null}
        {tripError !== null ? <p className="chat-room__composer-note" role="alert">{tripError}</p> : null}
        {tripButtonState.showRetry ? (
          <button className="profile-button profile-button--secondary" type="button" onClick={retryTripLookup}>
            Повторить
          </button>
        ) : (
          <button className="profile-button profile-button--primary" disabled={tripButtonState.disabled} type="button" onClick={handleCreateTrip}>
            {tripButtonState.label}
          </button>
        )}
      </article>

      <section className="surface-card chat-room" aria-label="История сообщений">
        {isOffline ? <p className="chat-room__composer-note" role="status">Нет подключения. Сообщения обновятся после восстановления сети; черновик сохранён.</p> : null}
        {syncError ? (
          <p className="chat-room__composer-note" role="status">
            Не удалось обновить сообщения. Повторим автоматически; текст в поле ввода сохранён.
          </p>
        ) : null}
        {readError ? <p className="chat-room__composer-note" role="status">Не удалось обновить отметку о прочтении. Повторим автоматически.</p> : null}
        {historyError ? <p className="chat-room__composer-note" role="alert">Не удалось загрузить ранние сообщения.</p> : null}
        {hasMoreOlder ? (
          <button className="profile-button profile-button--secondary" type="button" disabled={isLoadingOlder} onClick={handleLoadOlder}>
            {isLoadingOlder ? 'Загружаем…' : historyError ? 'Повторить загрузку ранних сообщений' : 'Загрузить ранние сообщения'}
          </button>
        ) : null}
        <div className="chat-room__timeline">
          {messageHistoryState === 'empty' ? (
            <p className="surface-card__copy">Сообщений пока нет</p>
          ) : null}
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

function ChatRoomUnavailable({
  title,
  message,
  onRetry
}: Readonly<{ title: string; message: string; onRetry?: () => void }>) {
  return (
    <section className="page">
      <article className="surface-card surface-card--compact empty-state-card">
        <p className="section-kicker">{title}</p>
        <h2 className="empty-state-card__title">{title}</h2>
        <p className="surface-card__copy">{message}</p>
        {onRetry ? <button className="profile-button profile-button--secondary" type="button" onClick={onRetry}>Повторить</button> : null}
        <Link className="profile-button profile-button--secondary" href="/chats">
          Вернуться к списку чатов
        </Link>
      </article>
    </section>
  );
}
