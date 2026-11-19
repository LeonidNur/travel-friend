'use client';

import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';

import { useTelegramAuthSession } from '@/components/TelegramAuthBootstrapProvider';
import { ChatListRow } from '@/components/ChatListRow';
import { ChatsListHeader } from '@/components/ChatsListHeader';
import { ChatsScreenStatus } from '@/components/ChatsScreenStatus';
import { GroupChatForm } from '@/components/GroupChatForm';
import { createBackendApiClient, type ChatResponse } from '@/lib/backend-api-client';
import { getChatsScreenState } from '@/lib/chat-runtime';
import {
  getAvailableGroupChatCompanions,
  normalizeGroupChatTitle,
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
  const [groupTitle, setGroupTitle] = useState('');
  const [groupError, setGroupError] = useState<string | null>(null);
  const [canRetryGroupCreation, setCanRetryGroupCreation] = useState(false);
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
      setCanRetryGroupCreation(false);
      return;
    }

    const normalizedTitle = normalizeGroupChatTitle(groupTitle);
    if (normalizedTitle.error !== null) {
      setGroupError(normalizedTitle.error);
      setCanRetryGroupCreation(false);
      return;
    }

    if (session === null || isCreatingGroup) {
      return;
    }

    setIsCreatingGroup(true);
    setGroupError(null);
    setCanRetryGroupCreation(false);

    try {
      const groupChat = await backendApiClient.createGroupChat(session.accessToken, {
        user_ids: [...selectedCompanionIds],
        title: normalizedTitle.title
      });
      router.push(`/chats/${groupChat.chat_id}`);
    } catch {
      setGroupError('Не удалось создать групповой чат. Попробуйте ещё раз.');
      setCanRetryGroupCreation(true);
      setIsCreatingGroup(false);
    }
  };

  if (isGroupFormOpen) {
    return <GroupChatForm companions={companions} selectedIds={selectedCompanionIds} title={groupTitle} error={groupError}
      isCreating={isCreatingGroup} canRetry={canRetryGroupCreation} onTitleChange={setGroupTitle} onToggle={toggleCompanion}
      onSubmit={handleCreateGroup} onBack={() => setIsGroupFormOpen(false)} />;
  }

  return (
    <section className="page chats-list-screen">
      <ChatsListHeader onCreate={screenState === 'success' ? () => {
            setIsGroupFormOpen((isOpen) => !isOpen);
            setGroupError(null);
            setCanRetryGroupCreation(false);
          } : undefined} />

      {screenState !== 'success' ? <ChatsScreenStatus state={screenState} onRetry={handleRetry} /> : null}

      {screenState === 'success' ? (
        <section className="list-stack" aria-label="Список чатов">
          {isOffline ? <p className="chat-room__composer-note" role="status">Нет подключения. Список не обновляется.</p> : null}
          {refreshError ? <p className="chat-room__composer-note" role="status">Не удалось обновить чаты. Повторим автоматически.</p> : null}
          {chats.map((chat) => <ChatListRow key={chat.chat_id} chat={chat} currentUserId={session?.userId} />)}
        </section>
      ) : null}
    </section>
  );
}
