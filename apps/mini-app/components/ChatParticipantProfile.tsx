'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { BuddyCard } from '@/components/BuddyCard';
import { useTelegramAuthSession } from '@/components/TelegramAuthBootstrapProvider';
import {
  ApiError,
  createBackendApiClient,
  type ChatParticipantProfileResponse
} from '@/lib/backend-api-client';
import {
  getChatParticipantProfileScreenState
} from '@/lib/chat-participant-profile-runtime';
import { toDiscoverCardCandidate } from '@/lib/discover-runtime';

const backendApiClient = createBackendApiClient();

interface ChatParticipantProfileProps {
  chatId: string;
  userId: string;
}

export function ChatParticipantProfile({ chatId, userId }: ChatParticipantProfileProps) {
  const { session } = useTelegramAuthSession();
  const [profile, setProfile] = useState<ChatParticipantProfileResponse | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (session === null) {
      return;
    }

    let isCurrent = true;
    void backendApiClient.getChatParticipantProfile(session.accessToken, chatId, userId).then(
      (nextProfile) => {
        if (isCurrent) {
          setProfile(nextProfile);
          setIsLoading(false);
        }
      },
      (error: unknown) => {
        if (isCurrent) {
          setProfile(null);
          setErrorStatus(error instanceof ApiError ? error.status : 0);
          setIsLoading(false);
        }
      }
    );

    return () => {
      isCurrent = false;
    };
  }, [chatId, reloadKey, session, userId]);

  const screenState = getChatParticipantProfileScreenState({ isLoading, errorStatus, profile });
  if (screenState === 'loading') {
    return <ProfileNotice title="Загружаем профиль" message="Получаем данные участника чата." />;
  }
  if (screenState === 'not_found') {
    return <ProfileNotice title="Профиль недоступен" message="Этот участник или чат больше недоступен." />;
  }
  if (screenState === 'error' || profile === null) {
    return <ProfileNotice
      title="Не удалось загрузить профиль"
      message="Попробуйте открыть профиль ещё раз."
      onRetry={() => {
        setProfile(null);
        setErrorStatus(null);
        setIsLoading(true);
        setReloadKey((key) => key + 1);
      }}
    />;
  }

  return (
    <section className="page">
      <div className="profile-header">
        <Link className="profile-button profile-button--secondary profile-back-button" href={`/chats/${chatId}`}>
          Назад к чату
        </Link>
        <span className="profile-status">Участник чата</span>
      </div>
      <BuddyCard buddy={toDiscoverCardCandidate(profile)} />
    </section>
  );
}

function ProfileNotice({
  title,
  message,
  onRetry
}: Readonly<{ title: string; message: string; onRetry?: () => void }>) {
  return (
    <section className="page" aria-live="polite">
      <article className="surface-card surface-card--compact empty-state-card">
        <h2 className="empty-state-card__title">{title}</h2>
        <p className="surface-card__copy">{message}</p>
        {onRetry ? <button className="profile-button profile-button--secondary" type="button" onClick={onRetry}>Повторить</button> : null}
        <Link className="profile-button profile-button--secondary" href="/chats">Вернуться к чатам</Link>
      </article>
    </section>
  );
}
