'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';

import { useTelegramAuthSession } from '@/components/TelegramAuthBootstrapProvider';
import { createBackendApiClient, type ChatResponse } from '@/lib/backend-api-client';
import { formatChatListTimestamp, getChatsScreenState } from '@/lib/chat-runtime';
import {
  getAvailableGroupChatCompanions,
  validateGroupChatCompanionIds
} from '@/lib/group-chat-runtime';

const backendApiClient = createBackendApiClient();

export default function ChatsPage() {
  const { session } = useTelegramAuthSession();
  const router = useRouter();
  const [chats, setChats] = useState<ChatResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [isGroupFormOpen, setIsGroupFormOpen] = useState(false);
  const [selectedCompanionIds, setSelectedCompanionIds] = useState<string[]>([]);
  const [groupError, setGroupError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState(false);
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    if (session === null) {
      return;
    }

    let isCurrent = true;
    void backendApiClient.getChats(session.accessToken).then(
      (nextChats) => {
        if (isCurrent) {
          setChats(nextChats);
          setIsLoading(false);
        }
      },
      () => {
        if (isCurrent) {
          setError('Не удалось загрузить чаты. Попробуйте открыть экран ещё раз.');
          setIsLoading(false);
        }
      }
    );

    return () => {
      isCurrent = false;
    };
  }, [reloadKey, session]);

  useEffect(() => {
    if (session === null || isLoading || error !== null) {
      return;
    }

    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const offlineSyncTimer = setTimeout(() => setIsOffline(!navigator.onLine), 0);
    let isRefreshing = false;

    const refresh = async () => {
      if (!active || isRefreshing || document.visibilityState !== 'visible' || !navigator.onLine) {
        return;
      }
      isRefreshing = true;
      try {
        const nextChats = await backendApiClient.getChats(session.accessToken);
        if (active) {
          setChats(nextChats);
          setRefreshError(false);
        }
      } catch {
        if (active) {
          setRefreshError(true);
        }
      } finally {
        isRefreshing = false;
        if (active && document.visibilityState === 'visible' && navigator.onLine) {
          timer = setTimeout(() => void refresh(), 60_000);
        }
      }
    };

    const resume = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        setIsOffline(false);
        if (timer !== undefined) clearTimeout(timer);
        void refresh();
      } else if (timer !== undefined) {
        clearTimeout(timer);
        setIsOffline(!navigator.onLine);
      }
    };

    const pause = () => {
      if (timer !== undefined) clearTimeout(timer);
      setIsOffline(true);
    };

    timer = setTimeout(() => void refresh(), 60_000);
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('focus', resume);
    window.addEventListener('online', resume);
    window.addEventListener('offline', pause);
    return () => {
      active = false;
      clearTimeout(offlineSyncTimer);
      if (timer !== undefined) clearTimeout(timer);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('focus', resume);
      window.removeEventListener('online', resume);
      window.removeEventListener('offline', pause);
    };
  }, [error, isLoading, reloadKey, session]);

  const screenState = getChatsScreenState({ isLoading, error, chats });
  const companions = getAvailableGroupChatCompanions(chats);
  const handleRetry = () => {
    setIsLoading(true);
    setError(null);
    setReloadKey((key) => key + 1);
  };

  const toggleCompanion = (userId: string) => {
    setSelectedCompanionIds((currentIds) =>
      currentIds.includes(userId)
        ? currentIds.filter((currentUserId) => currentUserId !== userId)
        : [...currentIds, userId]
    );
  };

  const handleCreateGroup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const validationError = validateGroupChatCompanionIds(selectedCompanionIds);

    if (validationError !== null) {
      setGroupError(validationError);
      return;
    }

    if (session === null || isCreatingGroup) {
      return;
    }

    setIsCreatingGroup(true);
    setGroupError(null);

    try {
      const groupChat = await backendApiClient.createGroupChat(session.accessToken, {
        user_ids: [...selectedCompanionIds]
      });
      router.push(`/chats/${groupChat.chat_id}`);
    } catch {
      setGroupError('Не удалось создать групповой чат. Попробуйте ещё раз.');
      setIsCreatingGroup(false);
    }
  };

  return (
    <section className="page">
      <article className="hero-card">
        <h2 className="hero-card__title">Чаты</h2>
        <button
          className="profile-button profile-button--secondary"
          type="button"
          disabled={screenState !== 'success'}
          onClick={() => {
            setIsGroupFormOpen((isOpen) => !isOpen);
            setGroupError(null);
          }}
        >
          Создать групповой чат
        </button>
      </article>

      {isGroupFormOpen ? (
        <article className="surface-card surface-card--compact" aria-labelledby="group-chat-create-title">
          <h2 className="surface-card__title" id="group-chat-create-title">Новый групповой чат</h2>
          {companions.length === 0 ? (
            <p className="surface-card__copy">Нет доступных собеседников из прямых чатов.</p>
          ) : (
            <form className="group-chat-create" onSubmit={handleCreateGroup}>
              <p className="surface-card__copy">Выберите минимум двух собеседников.</p>
              <div className="group-chat-create__options">
                {companions.map((companion) => (
                  <label className="group-chat-create__option" key={companion.user_id}>
                    <input
                      checked={selectedCompanionIds.includes(companion.user_id)}
                      disabled={isCreatingGroup}
                      type="checkbox"
                      onChange={() => toggleCompanion(companion.user_id)}
                    />
                    <span>{companion.display_name}</span>
                  </label>
                ))}
              </div>
              {groupError !== null ? <p className="chat-room__composer-note" role="alert">{groupError}</p> : null}
              <button className="profile-button profile-button--primary" disabled={isCreatingGroup} type="submit">
                {isCreatingGroup ? 'Создаём…' : 'Создать чат'}
              </button>
            </form>
          )}
        </article>
      ) : null}

      {screenState === 'loading' ? (
        <article className="surface-card surface-card--compact empty-state-card" aria-live="polite">
          <p className="section-kicker">Загружаем чаты</p>
        </article>
      ) : null}

      {screenState === 'error' ? (
        <article className="surface-card surface-card--compact empty-state-card" role="alert">
          <p className="section-kicker">Не удалось загрузить чаты</p>
          <p className="surface-card__copy">{error}</p>
          <button className="profile-button profile-button--secondary" type="button" onClick={handleRetry}>
            Повторить
          </button>
        </article>
      ) : null}

      {screenState === 'empty' ? (
        <article className="surface-card surface-card--compact empty-state-card">
          <p className="section-kicker">Чатов пока нет</p>
          <h2 className="empty-state-card__title">Здесь появятся ваши обсуждения</h2>
          <Link className="profile-button profile-button--primary" href="/">
            Перейти к анкетам
          </Link>
        </article>
      ) : null}

      {screenState === 'success' ? (
        <section className="list-stack" aria-label="Список чатов">
          {isOffline ? <p className="chat-room__composer-note" role="status">Нет подключения. Список не обновляется.</p> : null}
          {refreshError ? <p className="chat-room__composer-note" role="status">Не удалось обновить чаты. Повторим автоматически.</p> : null}
          {chats.map((chat) => (
            <Link className="surface-card surface-card--compact chat-card chat-card--link" key={chat.chat_id} href={`/chats/${chat.chat_id}`}>
              <div className="chat-card__header">
                {chat.type === 'direct' ? (
                  <div>
                    <p className="surface-card__title">{chat.companion.display_name}</p>
                    <p className="chat-card__meta">
                      {chat.companion.age === null ? 'Возраст не указан' : `${chat.companion.age} лет`} ·{' '}
                      {chat.companion.city ?? 'Город не указан'}
                    </p>
                  </div>
                ) : (
                  <div>
                    <p className="surface-card__title">Групповой чат</p>
                    <p className="chat-card__meta">{chat.participant_count} участников</p>
                    <p className="chat-card__meta">
                      {chat.participants.map((participant) => participant.display_name ?? 'Имя не указано').join(' · ')}
                    </p>
                  </div>
                )}
                <div className="chat-card__preview">
                  <span className="chat-card__preview-time">
                    {chat.last_message === null
                      ? ''
                      : formatChatListTimestamp(chat.last_message.created_at)}
                  </span>
                  {chat.unread_count > 0 ? (
                    <span className="chat-card__unread" aria-label={`Непрочитанных сообщений: ${chat.unread_count}`}>
                      {chat.unread_count}
                    </span>
                  ) : null}
                </div>
              </div>
              <p className="chat-card__last-message">
                {chat.last_message === null
                  ? 'Сообщений пока нет'
                  : `${chat.last_message.sender_user_id === session?.userId ? 'Вы: ' : ''}${chat.last_message.content_text ?? 'Системное сообщение'}`}
              </p>
            </Link>
          ))}
        </section>
      ) : null}
    </section>
  );
}
