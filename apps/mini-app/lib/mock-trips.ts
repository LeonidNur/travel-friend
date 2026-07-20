import { CURRENT_USER_CHAT_PARTICIPANT_ID, mockChats } from '@/lib/mock-chats';
import type { MockChat, Trip, TripCategories } from '@/lib/types';

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
    status: 'ready',
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

function isActiveTripStatus(status: Trip['status']): boolean {
  return status === 'draft' || status === 'planning';
}

export function validateMockTrips(trips: readonly Trip[], chats: readonly MockChat[] = mockChats): void {
  const activeTripCountsByChatId = new Map<string, number>();
  const chatsById = new Map(chats.map((chat) => [chat.id, chat]));

  for (const trip of trips) {
    const chat = chatsById.get(trip.chatId);

    if (!chat) {
      throw new Error(`Chat "${trip.chatId}" not found for mock trip "${trip.id}".`);
    }

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

    if (isActiveTripStatus(trip.status)) {
      const activeTripCount = (activeTripCountsByChatId.get(trip.chatId) ?? 0) + 1;

      if (activeTripCount > 1) {
        throw new Error(`Chat "${trip.chatId}" has more than one active mock trip.`);
      }

      activeTripCountsByChatId.set(trip.chatId, activeTripCount);
    }
  }
}

validateMockTrips(mockTrips);

export function getTrips(): readonly Trip[] {
  return mockTrips;
}

export function getTripById(id: string, trips: readonly Trip[] = mockTrips): Trip | undefined {
  return trips.find((trip) => trip.id === id);
}

export function getTripsByChatId(chatId: string, trips: readonly Trip[] = mockTrips): readonly Trip[] {
  return trips.filter((trip) => trip.chatId === chatId);
}

export function getActiveTripByChatId(chatId: string, trips: readonly Trip[] = mockTrips): Trip | undefined {
  const activeTrips = getTripsByChatId(chatId, trips).filter((trip) => isActiveTripStatus(trip.status));

  if (activeTrips.length > 1) {
    throw new Error(`Chat "${chatId}" has more than one active trip.`);
  }

  return activeTrips[0];
}

function createDraftTripCategories(destination: string): TripCategories {
  return {
    direction: {
      status: 'needs_decision',
      summary: `Нужно подтвердить направление: ${destination}.`
    },
    dates: {
      status: 'needs_decision',
      summary: 'Нужно обсудить даты поездки.'
    },
    budget: {
      status: 'empty',
      summary: 'Бюджет пока не обсуждался.'
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
      status: 'empty',
      summary: 'Активности пока не обсуждались.'
    },
    notes: {
      status: 'empty',
      summary: 'Заметок пока нет.'
    }
  };
}

export function createDraftTrip(
  chat: MockChat,
  trips: readonly Trip[],
  tripId: string
): Trip {
  if (chat.status !== 'match') {
    throw new Error(`Chat "${chat.id}" cannot start planning before a match.`);
  }

  if (getActiveTripByChatId(chat.id, trips)) {
    throw new Error(`Chat "${chat.id}" already has an active trip.`);
  }

  if (getTripById(tripId, trips)) {
    throw new Error(`Trip "${tripId}" already exists.`);
  }

  return {
    id: tripId,
    chatId: chat.id,
    participantIds: chat.participants.map((participant) => participant.id),
    status: 'draft',
    categories: createDraftTripCategories(chat.destination)
  };
}
