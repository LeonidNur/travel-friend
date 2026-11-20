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

const ownProfileFixture: ProfileResponse = {
  ...profile, display_name: 'Алексей', birth_date: '1998-10-02', city: 'Санкт-Петербург',
  bio: 'Люблю длинные маршруты, новые города, локальную кухню и активный отдых. Ищу попутчиков для насыщенных поездок.',
  interests: ['Книги', 'Вечеринки'], travel_style: ['Городской', 'Активный']
};

const candidate = {
  userId: 'preview-candidate', displayName: 'Кирилл', age: 18, city: 'Москва',
  bio: 'Привет! Я люблю активный отдых.', travelStyle: ['Городской', 'Активный', 'Событийный'],
  interests: ['Еда', 'Музыка', 'Аниме', 'Спорт'], budgetLevel: '2', comfortLevel: '3',
  travelIntent: { destination: 'Турция', dateFrom: null, dateTo: null }
};
const longName = 'АлександраКонстантинопольскаяВладимировна';
const longCity = 'СанктПетербургскаяАгломерацияЛенинградскойОбласти';
const longCandidate = { ...candidate, displayName: longName, city: longCity,
  travelIntent: { ...candidate.travelIntent, destination: longCity } };

const directChat: ChatResponse = { chat_id: 'preview-chat', type: 'direct', companion: { user_id: 'friend', display_name: 'Александра', age: 24, city: 'Санкт-Петербург' }, created_at: '', last_message: { sequence_number: 1, type: 'user', sender_user_id: 'friend', content_text: 'Давайте обсудим поездку', created_at: '2026-01-01T15:42:00Z' }, unread_count: 1 };
const groupChat: ChatResponse = { chat_id: 'preview-group', type: 'group', title: null, participants: [{ user_id: 'friend', display_name: 'Александра' }, { user_id: 'friend2', display_name: 'Максим' }], participant_count: 3, created_at: '', last_message: null, unread_count: 0 };
const longChat = { ...directChat, companion: { ...directChat.companion, display_name: longName, city: longCity } };
const lastMessage = directChat.last_message;
const chatListFixtures: ChatResponse[] = [
  { ...directChat, last_message: lastMessage ? { ...lastMessage, sender_user_id: 'me', created_at: '2026-11-18T15:42:00Z' } : null, unread_count: 0 },
  { ...groupChat, title: 'Александра, Кирилл, Максим', last_message: lastMessage ? { ...lastMessage, content_text: 'Предложение группы', created_at: '2026-11-18T15:42:00Z' } : null, unread_count: 1 },
  { ...directChat, chat_id: 'preview-long-chat', companion: { user_id: 'long-name', display_name: 'Константин с очень длинным именем', age: null, city: null }, last_message: null, unread_count: 0 }
];
const previewMessages: ChatMessageResponse[] = [
  { message_id: '1', chat_id: 'preview-chat', sequence_number: 1, type: 'user', sender_user_id: 'friend', content_text: 'Предлагаю сначала встретиться в центре, обсудить длинный маршрут Москва → Нижний Новгород → Казань → Тбилиси и проверить даты всех участников.', created_at: '2026-01-01T15:42:00Z' },
  { message_id: '2', chat_id: 'preview-chat', sequence_number: 2, type: 'user', sender_user_id: 'me', content_text: 'Давайте обсудим маршрут и даты поездки.', created_at: '2026-01-01T15:42:00Z' }
];
const longMessages = [{ ...previewMessages[0], content_text: `Маршрут: ${longCity.repeat(3)}` }, previewMessages[1]];
const groupMessages = previewMessages.map((message) => ({
  ...message, chat_id: 'preview-group', ...(message.sender_user_id !== 'me' ? {
    sender_user_id: 'friend2', content_text: 'Предлагаю обсудить маршрут Сидней → Тасмания → Мельбурн → Кэрнс и проверить даты всех участников.'
  } : {})
}));

export default function VisualPreview() {
  const [capture, setCapture] = useState(false);
  const [view, setView] = useState('discover');
  const [selectedChatIds, setSelectedChatIds] = useState<string[]>(['friend', 'friend2']);
  const [previewGroupTitle, setPreviewGroupTitle] = useState('');
  const [onboardingStep, onboardingState] = view.split(':');
  const isChatRoom = view.startsWith('chats-room-') || view.startsWith('chats-trip-') || ['chats-direct', 'chats-send-error'].includes(view);
  const isGroupRoom = view === 'chats-room-group';
  const isLongRoom = view === 'chats-room-long';
  const shownCandidate = view === 'discover-long' ? longCandidate : view === 'discover-next'
    ? { ...candidate, userId: 'preview-next', displayName: 'Александра', age: 24, city: 'Санкт-Петербург' }
    : candidate;
  const isOnboarding = ['profile', 'travel_style', 'first_trip'].includes(onboardingStep);
  const onboardingProfile = onboardingState === 'validation' || !onboardingState
    ? { ...profile, display_name: '', city: null, birth_date: null, travel_style: [], interests: [],
        bio: 'Люблю длинные маршруты, новые города, локальную кухню и активный отдых. Ищу попутчиков для насыщенных поездок.' }
    : profile;
  return (
    <>
      <div className="preview-controls" data-capture={capture}
        onKeyDown={(event) => { if (event.key === 'Escape') setCapture(false); }}>
      <label>
        UI preview (без API){' '}
        <select value={view} onChange={(event) => setView(event.target.value)}>
          <option value="discover">Discover</option>
          <option value="discover-expanded">Discover: раскрытая</option>
          <option value="discover-next">Discover: следующий кандидат</option>
          <option value="discover-long">Discover: длинные значения</option>
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
          <option value="chats-room-loading">Чат: загрузка</option><option value="chats-room-not-found">Чат: не найден</option><option value="chats-room-error">Чат: ошибка загрузки</option>
          <option value="chats-room-empty">Чат: без сообщений</option><option value="chats-room-sending">Чат: отправка</option>
          <option value="chats-room-long">Чат: длинные значения</option>
          <option value="chats-trip-existing">Чат: поездка существует</option><option value="chats-trip-creating">Чат: создание поездки</option>
          <option value="chats-trip-error">Чат: ошибка создания поездки</option>
          {tripsPreviewOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          {([['profile', 'профиль'], ['travel_style', 'стиль'], ['first_trip', 'поездка']] as const).map(([step, label]) =>
            <optgroup label={`Onboarding: ${label}`} key={step}>
              <option value={step}>Onboarding: {label}</option>
              {['dirty', 'validation', 'saving', 'saved', 'error', ...(step === 'first_trip' ? ['completing', 'completion-error'] : [])].map((state) =>
                <option key={state} value={`${step}:${state}`}>{label} · {state}</option>)}
            </optgroup>)}
        </select>
      </label>
      <button type="button" onClick={() => setCapture(true)}>Режим снимка</button>
      </div>
      <style jsx global>{`
        .preview-controls { position: fixed; inset: 0 0 auto auto; z-index: 100; background: white; }
        .preview-controls[data-capture='true'] { opacity: 0; pointer-events: none; }
        body:has(.preview-controls[data-capture='true']) nextjs-portal { display: none; }
      `}</style>
      {view.startsWith('trips-') ? <TripsPreview view={view} onChange={setView} /> : null}
      {view.startsWith('discover') ? <div className="app-shell"><div className="app-content__frame discover-page">
        {['discover', 'discover-expanded', 'discover-next', 'discover-long'].includes(view) ? <BuddyCard key={view} buddy={shownCandidate} initialExpanded={view === 'discover-expanded'} ownPreferences={{ destinations: ['Грузия'], interests: ['Аниме', 'Спорт'], travelStyle: ['Активный', 'Событийный'] }} onDismiss={() => undefined} onInterested={() => undefined} /> : null}
        {view === 'discover-loading' ? <DiscoverStatePanel title="Загружаем анкеты" message="Подбираем следующего кандидата." /> : null}
        {view === 'discover-load-error' ? <DiscoverStatePanel error title="Не удалось загрузить анкеты" message="Проверьте подключение и попробуйте ещё раз." action={<button type="button" className="discover-state__action" onClick={() => setView('discover')}>Повторить</button>} /> : null}
        {view === 'discover-empty' ? <DiscoverStatePanel title="Кандидаты закончились" message="Сейчас новых кандидатов нет." action={<Link className="discover-state__action" href="/chats">К чатам</Link>} /> : null}
        {view === 'discover-error' ? <DiscoverStatePanel error title="Не удалось отправить решение" message="Кирилл, 18 · Подходит" action={<button type="button" className="discover-state__action" onClick={() => setView('discover')}>Повторить</button>} /> : null}
        {view === 'discover-match' ? <DiscoverMatchFeedback chatId="preview-chat" displayName="Александра" onDismiss={() => setView('discover')} /> : null}
      </div><BottomNavigation pathname="/" /></div> : null}
      {view.startsWith('profile-') ? <div className="app-shell"><div className="app-content__frame"><ProfileContent key={view}
        serverProfile={{ status: 'loaded', profile: view === 'profile-view' ? ownProfileFixture : {
          ...ownProfileFixture, bio: 'Люблю путешествия, новые города и активный отдых.',
          display_name: view === 'profile-validation' ? '' : ownProfileFixture.display_name,
          birth_date: view === 'profile-validation' ? '2099-10-02' : ownProfileFixture.birth_date
        } }} serverTravelIntent={{ status: 'loaded', travelIntent: { id: 'preview-intent', user_id: profile.user_id, destination: 'Грузия', date_from: null, date_to: null, status: 'active', created_at: '', updated_at: '', archived_at: null } }}
        setServerProfile={() => undefined} reloadServerProfile={() => undefined} setServerTravelIntent={() => undefined} reloadServerTravelIntent={() => undefined}
        token={null} initialView={view.slice('profile-'.length) as 'view' | 'edit' | 'saved' | 'validation' | 'saving' | 'error'} /></div><BottomNavigation pathname="/profile" /></div> : null}
      {view.startsWith('chats-') ? <div className="app-shell"><div className="app-content__frame">
        {view === 'chats-list' ? <section className="page chats-list-screen"><ChatsListHeader onCreate={() => setView('chats-group')} /><section className="list-stack" aria-label="Список чатов">{chatListFixtures.map((chat) => <ChatListRow key={chat.chat_id} chat={chat} currentUserId="me" />)}</section></section> : null}
        {view === 'chats-empty' || view === 'chats-loading' || view === 'chats-error' ? <section className="page chats-list-screen"><ChatsListHeader /><ChatsScreenStatus state={view === 'chats-empty' ? 'empty' : view === 'chats-loading' ? 'loading' : 'error'} onRetry={() => setView('chats-list')} /></section> : null}
        {view.startsWith('chats-group') ? <GroupChatForm companions={view === 'chats-group-empty' ? [] : [{ user_id: 'friend', display_name: 'Александра', age: 24, city: 'Санкт-Петербург' }, { user_id: 'friend2', display_name: 'Максим', age: 27, city: 'Москва' }, { user_id: 'friend3', display_name: 'Екатерина', age: null, city: null }]} selectedIds={view === 'chats-group-validation' ? selectedChatIds.slice(0, 1) : selectedChatIds} title={previewGroupTitle} error={view === 'chats-group-validation' ? 'Выберите минимум двух собеседников.' : view === 'chats-group-error' ? 'Не удалось создать групповой чат. Попробуйте ещё раз.' : null} isCreating={view === 'chats-group-creating'} canRetry={view === 'chats-group-error'} onTitleChange={setPreviewGroupTitle} onToggle={(id) => setSelectedChatIds((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id])} onSubmit={(event) => event.preventDefault()} onBack={() => setView('chats-list')} /> : null}
        {isChatRoom ? <ChatRoom key={view} chatId={isGroupRoom ? groupChat.chat_id : directChat.chat_id}
          preview={{ chat: isGroupRoom ? groupChat : isLongRoom ? longChat : directChat,
          messages: isGroupRoom ? groupMessages : isLongRoom ? longMessages : previewMessages, userId: 'me',
          hasOlder: isGroupRoom, tripId: isGroupRoom || view === 'chats-trip-existing' ? 'preview-trip' : undefined,
          tripRoute: isGroupRoom ? ['Сидней', 'Тасмания', 'Мельбурн', 'Кэрнс']
            : view === 'chats-trip-existing' ? ['Москва', 'Санкт-Петербург'] : undefined,
          creatingTrip: view === 'chats-trip-creating',
          tripError: view === 'chats-trip-error' ? 'Незавершённая поездка уже существует, но её не удалось открыть. Попробуйте ещё раз.' : undefined,
          roomState: view === 'chats-room-loading' ? 'loading' : view === 'chats-room-not-found' ? 'not_found' : view === 'chats-room-error' ? 'error' : 'loaded',
          empty: view === 'chats-room-empty', sending: view === 'chats-room-sending', sendError: view === 'chats-send-error' ? 'Не удалось отправить сообщение. Попробуйте ещё раз.' : undefined }} /> : null}
      </div>{!isChatRoom ? <BottomNavigation pathname="/chats" /> : null}</div> : null}
      {isOnboarding && (onboardingStep === 'profile' || onboardingStep === 'travel_style') ? (
        <OnboardingProfileForm key={view} profile={onboardingProfile} step={onboardingStep} onboardingStatus="in_progress" token={null}
          previewState={onboardingState as 'validation' | 'saving' | 'saved' | 'error' | undefined}
          onProfileSaved={() => undefined} onOnboardingStarted={() => undefined} onBack={() => setView('profile')}
          onContinue={() => setView(onboardingStep === 'profile' ? 'travel_style' : 'first_trip')} />
      ) : null}
      {isOnboarding && onboardingStep === 'first_trip' ? (
        <OnboardingTravelIntentForm key={view} profile={{ ...profile, budget_level: '3', comfort_level: '4' }}
          travelIntent={onboardingState ? {
            id: 'preview-trip-intent', user_id: profile.user_id, status: 'active',
            destination: onboardingState === 'validation' ? '' : 'Грузия',
            date_from: '2026-10-12',
            date_to: onboardingState === 'validation' ? '2026-10-10' : '2026-10-19',
            created_at: '', updated_at: '', archived_at: null
          } : null} onboardingStatus="in_progress" token={null}
          previewState={onboardingState as 'validation' | 'saving' | 'saved' | 'error' | 'completing' | 'completion-error' | undefined}
          onProfileSaved={() => undefined} onTravelIntentSaved={() => undefined} onOnboardingCompleted={() => undefined} />
      ) : null}
    </>
  );
}
