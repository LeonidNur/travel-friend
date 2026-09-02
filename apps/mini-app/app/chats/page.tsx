'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';

import { useTelegramAuthSession } from '@/components/TelegramAuthBootstrapProvider';
import { createBackendApiClient, type ChatResponse } from '@/lib/backend-api-client';
import { getChatsScreenState } from '@/lib/chat-runtime';
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
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [isGroupFormOpen, setIsGroupFormOpen] = useState(false);
  const [selectedCompanionIds, setSelectedCompanionIds] = useState<string[]>([]);
  const [groupError, setGroupError] = useState<string | null>(null);

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
  }, [session]);

  const screenState = getChatsScreenState({ isLoading, error, chats });
  const companions = getAvailableGroupChatCompanions(chats);

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
              </div>

            </Link>
          ))}
        </section>
      ) : null}
    </section>
  );
}
