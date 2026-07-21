import type { ChatMessage, ChatParticipant, MockChat } from '@/lib/types';
import { getBuddyById } from '@/lib/mock-buddies';
import { CURRENT_USER_ID } from '@/lib/mock-current-user';

export const CURRENT_USER_CHAT_PARTICIPANT_ID = CURRENT_USER_ID;

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
        text: 'Привет. Я как раз смотрю даты на конец августа, 7–8 дней и район ближе к старому городу.',
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
        sentAtLabel: '10:18'
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
      {
        id: 'message-system-interest-sent',
        kind: 'system',
        text: 'Интерес отправлен. Переписка станет доступна после взаимного интереса.',
        sentAtLabel: 'сегодня'
      }
    ]
  },
  {
    id: 'chat-sonya-yerevan',
    title: 'Тимур Сафонов',
    destination: 'Ереван',
    status: 'match',
    previewText: 'План готов: даты, жильё и спокойный маршрут по Еревану согласованы.',
    updatedLabel: 'сегодня',
    participants: [
      CURRENT_USER_PARTICIPANT,
      createBuddyParticipant('timur-safonov')
    ],
    messages: [
      createParticipantMessage({
        id: 'message-sonya-1',
        authorId: 'timur-safonov',
        text: 'Я бы начал с темпа поездки: хочется больше прогулок по городу или насыщенную программу?',
        sentAtLabel: 'сегодня'
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
