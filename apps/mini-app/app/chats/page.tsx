'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { useTelegramAuthSession } from '@/components/TelegramAuthBootstrapProvider';
import { createBackendApiClient, type DirectChatResponse } from '@/lib/backend-api-client';
import { getChatsScreenState } from '@/lib/chat-runtime';

const backendApiClient = createBackendApiClient();

export default function ChatsPage() {
  const { session } = useTelegramAuthSession();
  const [chats, setChats] = useState<DirectChatResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <section className="page">
      <article className="hero-card">
        <h2 className="hero-card__title">Чаты</h2>
      </article>

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
                <div>
                  <p className="surface-card__title">{chat.companion.display_name}</p>
                  <p className="chat-card__meta">
                    {chat.companion.age === null ? 'Возраст не указан' : `${chat.companion.age} лет`} ·{' '}
                    {chat.companion.city ?? 'Город не указан'}
                  </p>
                </div>
              </div>

            </Link>
          ))}
        </section>
      ) : null}
    </section>
  );
}
