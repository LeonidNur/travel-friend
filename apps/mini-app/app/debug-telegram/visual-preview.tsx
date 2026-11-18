'use client';

import { useState } from 'react';
import Link from 'next/link';
import { BuddyCard } from '@/components/BuddyCard';
import { BottomNavigation } from '@/components/BottomNavigation';
import { DiscoverMatchFeedback } from '@/components/DiscoverMatchFeedback';
import { DiscoverStatePanel } from '@/components/DiscoverStatePanel';
import { OnboardingProfileForm } from '@/components/OnboardingProfileScreen';
import { OnboardingTravelIntentForm } from '@/components/OnboardingTravelIntentScreen';
import { ProfileContent } from '@/components/ProfileScreen';
import { GroupChatForm } from '@/components/GroupChatForm';
import { ChatListRow } from '@/components/ChatListRow';
import { ChatsListHeader } from '@/components/ChatsListHeader';
import { ChatsScreenStatus } from '@/components/ChatsScreenStatus';
import { ChatRoom } from '@/components/ChatRoom';
import { TripsPreview, tripsPreviewOptions } from './trips-preview';
import type { ChatResponse, ChatMessageResponse } from '@/lib/backend-api-client';
import type { ProfileResponse } from '@/lib/backend-api-client';

const profile: ProfileResponse = {
  id: 'preview-profile', user_id: 'preview-user', display_name: 'Кирилл', birth_date: '2000-01-01',
  gender: null, city: 'Москва', bio: 'Люблю длинные маршруты и новые города.',
  travel_style: ['Городской'], interests: ['Музыка', 'Кино'], budget_level: '2', comfort_level: '3',
  created_at: '', updated_at: ''
};

const candidate = {
  userId: 'preview-candidate', displayName: 'Кирилл', age: 18, city: 'Москва',
  bio: 'Привет! Я люблю активный отдых.', travelStyle: ['Городской', 'Активный'],
  interests: ['Еда', 'Музыка', 'Аниме', 'Спорт'], budgetLevel: '2', comfortLevel: '3',
  travelIntent: { destination: 'Турция', dateFrom: null, dateTo: null }
};

const directChat: ChatResponse = { chat_id: 'preview-chat', type: 'direct', companion: { user_id: 'friend', display_name: 'Александра', age: 24, city: 'Санкт-Петербург' }, created_at: '', last_message: { sequence_number: 1, type: 'user', sender_user_id: 'friend', content_text: 'Давайте обсудим поездку', created_at: '2026-01-01T15:42:00Z' }, unread_count: 1 };
const groupChat: ChatResponse = { chat_id: 'preview-group', type: 'group', title: null, participants: [{ user_id: 'friend', display_name: 'Александра' }, { user_id: 'friend2', display_name: 'Максим' }], participant_count: 3, created_at: '', last_message: null, unread_count: 0 };
const previewMessages: ChatMessageResponse[] = [{ message_id: '1', chat_id: 'preview-chat', sequence_number: 1, type: 'user', sender_user_id: 'friend', content_text: 'Предлагаю обсудить маршрут и даты поездки.', created_at: '2026-01-01T15:42:00Z' }, { message_id: '2', chat_id: 'preview-chat', sequence_number: 2, type: 'user', sender_user_id: 'me', content_text: 'Давайте обсудим!', created_at: '2026-01-01T15:43:00Z' }];

export default function VisualPreview() {
  const [view, setView] = useState('discover');
  const [selectedChatIds, setSelectedChatIds] = useState<string[]>([]);
  const [previewGroupTitle, setPreviewGroupTitle] = useState('');
  return (
    <>
      <label style={{ display: 'block', position: 'fixed', top: 0, right: 0, zIndex: 100, background: '#fff' }}>
        UI preview (без API){' '}
        <select value={view} onChange={(event) => setView(event.target.value)}>
          <option value="discover">Discover</option>
          <option value="discover-expanded">Discover: раскрытая</option>
          <option value="discover-next">Discover: следующий кандидат</option>
          <option value="discover-loading">Discover: загрузка</option>
          <option value="discover-load-error">Discover: ошибка загрузки</option>
          <option value="discover-empty">Discover: нет кандидатов</option>
          <option value="discover-error">Discover: ошибка решения</option>
          <option value="discover-match">Discover: мэтч</option>
          <option value="profile-view">Профиль: просмотр</option>
          <option value="profile-edit">Профиль: редактирование</option>
          <option value="profile-saved">Профиль: сохранено</option>
          <option value="profile-validation">Профиль: валидация</option>
          <option value="profile-saving">Профиль: сохранение</option>
          <option value="profile-error">Профиль: ошибка</option>
          <option value="chats-list">Чаты: список</option><option value="chats-empty">Чаты: пусто</option><option value="chats-loading">Чаты: загрузка</option><option value="chats-error">Чаты: ошибка загрузки</option><option value="chats-group">Чаты: создание группы</option><option value="chats-group-empty">Чаты: нет участников</option><option value="chats-group-validation">Чаты: ошибка выбора</option><option value="chats-group-creating">Чаты: создаём</option><option value="chats-group-error">Чаты: ошибка создания</option><option value="chats-direct">Чаты: direct</option><option value="chats-room-group">Чаты: группа</option><option value="chats-send-error">Чаты: ошибка отправки</option>
          {tripsPreviewOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          <option value="profile">Onboarding: профиль</option>
          <option value="travel_style">Onboarding: стиль</option>
          <option value="first_trip">Onboarding: поездка</option>
        </select>
      </label>
      {view.startsWith('trips-') ? <TripsPreview view={view} onChange={setView} /> : null}
      {view.startsWith('discover') ? <div className="app-shell"><div className="app-content__frame">
        {view === 'discover' || view === 'discover-expanded' || view === 'discover-next' ? <BuddyCard key={view} buddy={view === 'discover-next' ? { ...candidate, userId: 'preview-next', displayName: 'Александра', age: 24, city: 'Санкт-Петербург' } : candidate} initialExpanded={view === 'discover-expanded'} onDismiss={() => undefined} onInterested={() => undefined} /> : null}
        {view === 'discover-loading' ? <DiscoverStatePanel title="Загружаем анкеты" message="Подбираем следующего кандидата." /> : null}
        {view === 'discover-load-error' ? <DiscoverStatePanel error title="Не удалось загрузить анкеты" message="Проверьте подключение и попробуйте ещё раз." action={<button type="button" className="discover-state__action" onClick={() => setView('discover')}>Повторить</button>} /> : null}
        {view === 'discover-empty' ? <DiscoverStatePanel title="Кандидаты закончились" message="Сейчас новых кандидатов нет." action={<Link className="discover-state__action" href="/chats">К чатам</Link>} /> : null}
        {view === 'discover-error' ? <DiscoverStatePanel error title="Не удалось отправить решение" message="Кирилл · Подходит" action={<button type="button" className="discover-state__action" onClick={() => setView('discover')}>Повторить</button>} /> : null}
        {view === 'discover-match' ? <DiscoverMatchFeedback displayName="Кирилл" onDismiss={() => setView('discover')} /> : null}
      </div><BottomNavigation pathname="/" /></div> : null}
      {view.startsWith('profile-') ? <div className="app-shell"><div className="app-content__frame"><ProfileContent key={view}
        serverProfile={{ status: 'loaded', profile }} serverTravelIntent={{ status: 'loaded', travelIntent: { id: 'preview-intent', user_id: profile.user_id, destination: 'Грузия', date_from: null, date_to: null, status: 'active', created_at: '', updated_at: '', archived_at: null } }}
        setServerProfile={() => undefined} reloadServerProfile={() => undefined} setServerTravelIntent={() => undefined} reloadServerTravelIntent={() => undefined}
        token={null} initialView={view.slice('profile-'.length) as 'view' | 'edit' | 'saved' | 'validation' | 'saving' | 'error'} /></div><BottomNavigation pathname="/profile" /></div> : null}
      {view.startsWith('chats-') ? <div className="app-shell"><div className="app-content__frame">
        {view === 'chats-list' ? <section className="page"><ChatsListHeader onCreate={() => setView('chats-group')} /><section className="list-stack" aria-label="Список чатов"><ChatListRow chat={directChat} currentUserId="me" /><ChatListRow chat={groupChat} currentUserId="me" /></section></section> : null}
        {view === 'chats-empty' || view === 'chats-loading' || view === 'chats-error' ? <section className="page"><ChatsListHeader disabled={view !== 'chats-empty'} onCreate={() => setView('chats-group-empty')} /><ChatsScreenStatus state={view === 'chats-empty' ? 'empty' : view === 'chats-loading' ? 'loading' : 'error'} error="Не удалось загрузить чаты." onRetry={() => setView('chats-list')} /></section> : null}
        {view.startsWith('chats-group') ? <GroupChatForm companions={view === 'chats-group-empty' ? [] : [{ user_id: 'friend', display_name: 'Александра' }, { user_id: 'friend2', display_name: 'Максим' }]} selectedIds={selectedChatIds} title={previewGroupTitle} error={view === 'chats-group-validation' ? 'Выберите минимум двух собеседников.' : view === 'chats-group-error' ? 'Не удалось создать групповой чат. Попробуйте ещё раз.' : null} isCreating={view === 'chats-group-creating'} canRetry={view === 'chats-group-error'} onTitleChange={setPreviewGroupTitle} onToggle={(id) => setSelectedChatIds((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id])} onSubmit={(event) => event.preventDefault()} onBack={() => setView('chats-list')} /> : null}
        {view === 'chats-direct' || view === 'chats-room-group' || view === 'chats-send-error' ? <ChatRoom key={view} chatId="preview-chat" preview={{ chat: view === 'chats-room-group' ? groupChat : directChat, messages: previewMessages, userId: 'me', sendError: view === 'chats-send-error' ? 'Не удалось отправить сообщение. Попробуйте ещё раз.' : undefined }} /> : null}
      </div>{!['chats-direct', 'chats-room-group', 'chats-send-error'].includes(view) ? <BottomNavigation pathname="/chats" /> : null}</div> : null}
      {view === 'profile' || view === 'travel_style' ? (
        <OnboardingProfileForm key={view} profile={profile} step={view} onboardingStatus="in_progress" token={null}
          onProfileSaved={() => undefined} onOnboardingStarted={() => undefined} onBack={() => setView('profile')}
          onContinue={() => setView(view === 'profile' ? 'travel_style' : 'first_trip')} />
      ) : null}
      {view === 'first_trip' ? (
        <OnboardingTravelIntentForm profile={profile} travelIntent={null} onboardingStatus="in_progress" token={null}
          onProfileSaved={() => undefined} onTravelIntentSaved={() => undefined} onOnboardingCompleted={() => undefined} />
      ) : null}
    </>
  );
}
