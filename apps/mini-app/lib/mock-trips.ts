import { CURRENT_USER_CHAT_PARTICIPANT_ID, getChatById } from '@/lib/mock-chats';
import type { Trip } from '@/lib/types';

const mockTrips: Trip[] = [
  {
    id: 'trip-maria-georgia',
    chatId: 'chat-amina-tbilisi',
    participantIds: [CURRENT_USER_CHAT_PARTICIPANT_ID, 'maria-ivanova'],
    status: 'planning',
    categories: {
      direction: {
        status: 'confirmed',
        summary: 'Грузия: Тбилиси и окрестности.'
      },
      dates: {
        status: 'needs_decision',
        summary: 'Конец августа; нужно выбрать 7 или 8 дней.'
      },
      budget: {
        status: 'needs_decision',
        summary: 'Сверяем общий бюджет на жильё и еду.'
      },
      transport: {
        status: 'empty',
        summary: 'Перелёт и трансфер пока не обсуждались.'
      },
      accommodation: {
        status: 'needs_decision',
        summary: 'Выбираем район рядом со Старым городом.'
      },
      activities: {
        status: 'needs_decision',
        summary: 'Собираем короткий маршрут по районам.'
      },
      notes: {
        status: 'confirmed',
        summary: 'Нужен спокойный темп с прогулками и местной едой.'
      }
    }
  },
  {
    id: 'trip-timur-yerevan',
    chatId: 'chat-sonya-yerevan',
    participantIds: [CURRENT_USER_CHAT_PARTICIPANT_ID, 'timur-safonov'],
    status: 'draft',
    categories: {
      direction: {
        status: 'confirmed',
        summary: 'Армения: Ереван.'
      },
      dates: {
        status: 'empty',
        summary: 'Даты ещё не обсуждались.'
      },
      budget: {
        status: 'needs_decision',
        summary: 'Нужно обсудить бюджет поездки.'
      },
      transport: {
        status: 'empty',
        summary: 'Транспорт пока не обсуждался.'
      },
      accommodation: {
        status: 'empty',
        summary: 'Жильё пока не обсуждалось.'
      },
      activities: {
        status: 'needs_decision',
        summary: 'Нужно выбрать между прогулками и насыщенной программой.'
      },
      notes: {
        status: 'needs_decision',
        summary: 'Открытый вопрос: спокойный или насыщенный темп поездки.'
      }
    }
  }
];

function validateMockTrips(trips: readonly Trip[]): void {
  const usedChatIds = new Set<string>();

  for (const trip of trips) {
    const chat = getChatById(trip.chatId);

    if (!chat) {
      throw new Error(`Chat "${trip.chatId}" not found for mock trip "${trip.id}".`);
    }

    if (usedChatIds.has(trip.chatId)) {
      throw new Error(`Chat "${trip.chatId}" is used by more than one mock trip.`);
    }

    usedChatIds.add(trip.chatId);

    const chatParticipantIds = new Set(chat.participants.map((participant) => participant.id));
    const tripParticipantIds = new Set(trip.participantIds);

    if (trip.participantIds.length !== tripParticipantIds.size) {
      throw new Error(`Duplicate participant ids found in mock trip "${trip.id}".`);
    }

    for (const participantId of tripParticipantIds) {
      if (!chatParticipantIds.has(participantId)) {
        throw new Error(
          `Participant "${participantId}" from mock trip "${trip.id}" not found in chat "${trip.chatId}".`
        );
      }
    }

    const hasMatchingParticipantSets =
      tripParticipantIds.size === chatParticipantIds.size &&
      [...chatParticipantIds].every((participantId) => tripParticipantIds.has(participantId));

    if (!hasMatchingParticipantSets) {
      throw new Error(`Participants for mock trip "${trip.id}" do not match chat "${trip.chatId}".`);
    }
  }
}

validateMockTrips(mockTrips);

export function getTrips(): readonly Trip[] {
  return mockTrips;
}

export function getTripById(id: string): Trip | undefined {
  return mockTrips.find((trip) => trip.id === id);
}

export function getTripByChatId(chatId: string): Trip | undefined {
  return mockTrips.find((trip) => trip.chatId === chatId);
}
