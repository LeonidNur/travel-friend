import type { ChatMessage, ChatParticipant, ChatStatus, MockChat } from '@/lib/types';
import { getBuddyById } from '@/lib/mock-buddies';

export const CURRENT_USER_CHAT_PARTICIPANT_ID = 'current-user';

export const CHAT_STATUS_LABELS: Record<ChatStatus, string> = {
  match: 'Мэтч',
  interest_sent: 'Интерес отправлен',
  draft: 'Черновик обсуждения'
};

const CURRENT_USER_PARTICIPANT: ChatParticipant = {
  id: CURRENT_USER_CHAT_PARTICIPANT_ID,
  name: 'Алина',
  age: 29,
  city: 'Санкт-Петербург',
  isCurrentUser: true
};

function createBuddyParticipant(buddyProfileId: string): ChatParticipant {
  const buddy = getBuddyById(buddyProfileId);

  if (!buddy) {
    throw new Error(`Buddy profile "${buddyProfileId}" not found for mock chat participant.`);
  }

  return {
    id: buddyProfileId,
    buddyProfileId: buddy.id,
    name: buddy.name,
    age: buddy.age,
    city: buddy.city
  };
}

function createParticipantMessage(message: Omit<ChatMessage, 'kind'> & { authorId: string }): ChatMessage {
  return {
    ...message,
    kind: 'participant'
  };
}

export const mockChats: MockChat[] = [
  {
    id: 'chat-amina-tbilisi',
    title: 'Мария Иванова',
    destination: 'Грузия',
    status: 'match',
    previewText: 'Можно начать с обсуждения дат, района для жилья и общего бюджета на поездку.',
    updatedLabel: 'только что',
    participants: [
      CURRENT_USER_PARTICIPANT,
      createBuddyParticipant('maria-ivanova')
    ],
    messages: [
      createParticipantMessage({
        id: 'message-amina-1',
        authorId: 'maria-ivanova',
        text: 'Привет. Я как раз смотрю даты на конец августа и район ближе к старому городу.',
        sentAtLabel: '10:12'
      }),
      createParticipantMessage({
        id: 'message-you-1',
        authorId: CURRENT_USER_CHAT_PARTICIPANT_ID,
        text: 'Мне подходит. Я бы ещё сверила бюджет на жильё и короткий список мест, которые точно хотим успеть.',
        sentAtLabel: '10:16'
      }),
      {
        id: 'message-system-trip-planning',
        kind: 'system',
        text: 'Начато совместное планирование поездки.',
        sentAtLabel: '10:18',
        actionLabel: 'Открыть план поездки',
        actionHref: '/trips'
      },
      createParticipantMessage({
        id: 'message-amina-2',
        authorId: 'maria-ivanova',
        text: 'Супер, давай сначала соберём маршрут по районам и поймём, сколько ночей закладываем.',
        sentAtLabel: '10:21'
      })
    ]
  },
  {
    id: 'chat-ilya-istanbul',
    title: 'Егор Беляев',
    destination: 'Турция',
    status: 'interest_sent',
    previewText: 'Пока это заготовка: здесь позже будет удобно договориться о перелёте и планах на выходные.',
    updatedLabel: 'сегодня',
    participants: [
      CURRENT_USER_PARTICIPANT,
      createBuddyParticipant('egor-belyaev')
    ],
    messages: [
      createParticipantMessage({
        id: 'message-ilya-1',
        authorId: 'egor-belyaev',
        text: 'Если интерес взаимный подтвердится, можно сразу обсудить район для жилья и удобный перелёт.',
        sentAtLabel: 'вчера'
      })
    ]
  },
  {
    id: 'chat-sonya-yerevan',
    title: 'Тимур Сафонов',
    destination: 'Ереван',
    status: 'draft',
    previewText: 'Черновик подсказывает тему для старта: бюджет, темп поездки и интерес к музеям или прогулкам.',
    updatedLabel: 'сегодня',
    participants: [
      CURRENT_USER_PARTICIPANT,
      createBuddyParticipant('timur-safonov')
    ],
    messages: [
      createParticipantMessage({
        id: 'message-sonya-1',
        authorId: 'timur-safonov',
        text: 'Я бы начала с темпа поездки: хочется больше прогулок по городу или насыщенную программу?',
        sentAtLabel: 'сегодня'
      })
    ]
  },
  {
    id: 'chat-timur-baku',
    title: 'Тимур',
    destination: 'Баку',
    status: 'match',
    previewText: 'Есть взаимный интерес. Когда появится backend, здесь можно будет быстро сверить маршрут и даты.',
    updatedLabel: 'вчера',
    participants: [
      CURRENT_USER_PARTICIPANT,
      {
        id: 'timur',
        name: 'Тимур',
        age: 32,
        city: 'Санкт-Петербург'
      },
      {
        id: 'olga',
        name: 'Ольга',
        age: 28,
        city: 'Минск'
      }
    ],
    messages: [
      createParticipantMessage({
        id: 'message-timur-1',
        authorId: 'timur',
        text: 'Я могу собрать первый черновик по маршруту и посмотреть, где удобнее жить.',
        sentAtLabel: 'вчера'
      }),
      createParticipantMessage({
        id: 'message-olga-1',
        authorId: 'olga',
        text: 'Мне важно, чтобы был спокойный темп. Потом уже можно добавить музеи и еду по районам.',
        sentAtLabel: 'вчера'
      })
    ]
  }
];

export type LocalChatMessage = ChatMessage;

export function getChatById(id: string) {
  return mockChats.find((chat) => chat.id === id);
}

export function getChatParticipantById(chat: MockChat, participantId?: string) {
  if (!participantId) {
    return undefined;
  }

  return chat.participants.find((participant) => participant.id === participantId);
}

export function getChatCompanion(chat: MockChat) {
  return chat.participants.find((participant) => !participant.isCurrentUser);
}

export function isDirectChat(chat: MockChat) {
  return chat.participants.filter((participant) => !participant.isCurrentUser).length === 1;
}

export function getChatTitle(chat: MockChat) {
  const companion = getChatCompanion(chat);

  return companion?.name ?? chat.title;
}
