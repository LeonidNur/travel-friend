import type { InterestOption, TravelStyleOption } from './travel-preferences';
import {
  getAvatarInitials,
  getBudgetScale,
  getComfortLabel
} from './travel-preferences';
import { CURRENT_USER_ID, currentUserDiscoverProfile } from './mock-current-user';
import type { BuddyProfile, TravelPreferences } from './types';

export type TravelBuddy = BuddyProfile;

export type DiscoverCurrentUserProfile = TravelPreferences;

export interface BuddyMatchSignals {
  matchedDestinations: string[];
  matchedInterests: InterestOption[];
  matchedTravelStyles: TravelStyleOption[];
  isBudgetMatch: boolean;
  isComfortMatch: boolean;
}

export const mockBuddies: BuddyProfile[] = [
  {
    id: 'timur-safonov',
    name: 'Тимур Сафонов',
    age: 33,
    city: 'Казань',
    tagline: 'За насыщенные city-break поездки: еда, музыка и длинные пешие маршруты.',
    bio: 'Ищу компанию для короткого, но плотного city-break. Нравятся новые кварталы, локальная еда, вечерняя музыка и фото-точки без тургрупп.',
    destinations: ['Белград', 'Берлин', 'Ереван'],
    budgetLevel: 3,
    interests: ['Еда', 'Музыка', 'Вечеринки', 'Архитектура'],
    travelStyles: ['Городской', 'Активный / спортивный', 'Событийный / фестивали'],
    dates: 'Любые длинные выходные в ближайшие 2 месяца',
    comfortLevel: 2,
    likedYou: true,
    compatibilityReason: 'Может подойти, если нужен активный попутчик для короткой, но насыщенной поездки.',
    compatibilityDetails: [
      'Похоже на сценарий для тех, кто любит много впечатлений за короткое время.',
      'Есть шанс на совпадение по городскому формату и части культурных интересов, но темп поездки у него заметно активнее.'
    ],
    trustSignals: [
      {
        title: 'Demo profile',
        note: 'Демонстрационный профиль: Telegram-идентичность не подтверждена.'
      },
      {
        title: 'Safety placeholder',
        note: 'Проверки и бейджи доверия появятся в следующих итерациях MVP.'
      }
    ]
  },
  {
    id: 'maria-ivanova',
    name: 'Мария Иванова',
    age: 27,
    city: 'Москва',
    tagline: 'Хочу в природу, но без жёсткого аскетизма и с хорошей логистикой.',
    bio: 'Планирую поездку с природой, длинными прогулками и красивыми видами, но с нормальным жильём и понятным трансфером. Нравится ранний старт и спокойный вечер.',
    destinations: ['Алтай', 'Дагестан', 'Грузия'],
    budgetLevel: 2,
    interests: ['Природа', 'Спорт', 'Фотография', 'Еда'],
    travelStyles: ['Лесной / природный', 'Активный / спортивный', 'Медитативный / ретрит'],
    dates: 'Конец августа, 7–8 дней',
    comfortLevel: 3,
    likedYou: true,
    compatibilityReason: 'Может подойти, если вам важны природа, активный день и спокойный бытовой комфорт.',
    compatibilityDetails: [
      'Есть пересечение по интересу к природе и размеренному отдыху после активного дня.',
      'Формат поездки ближе к природному маршруту, поэтому совместимость зависит от ваших направлений и ожиданий.'
    ],
    trustSignals: [
      {
        title: 'Demo profile',
        note: 'Демонстрационный профиль: Telegram-идентичность не подтверждена.'
      },
      {
        title: 'Comfort preferences set',
        note: 'Указан уровень комфорта, чтобы заранее снизить бытовые расхождения.'
      }
    ]
  },
  {
    id: 'egor-belyaev',
    name: 'Егор Беляев',
    age: 31,
    city: 'Екатеринбург',
    tagline: 'Люблю road trip, красивые трассы и планы, которые можно гибко менять по дороге.',
    bio: 'Ищу попутчицу или попутчика для road trip на машине: несколько точек, хорошая музыка, виды и минимум гонки по чеклисту.',
    destinations: ['Черногория', 'Турция', 'Армения'],
    budgetLevel: 3,
    interests: ['Кино', 'Музыка', 'Природа', 'Технологии'],
    travelStyles: ['Автомобильный / road trip', 'Самостоятельный', 'Лесной / природный'],
    dates: 'Октябрь, до 10 дней',
    comfortLevel: 4,
    likedYou: false,
    compatibilityReason: 'Может подойти, если для вас важны гибкий маршрут и комфорт в дороге.',
    compatibilityDetails: [
      'Формат подходит тем, кто любит самостоятельные решения и не хочет жёсткий тайминг.',
      'Есть частичное пересечение по интересам, но комфорт и направления стоит сверять отдельно.'
    ],
    trustSignals: [
      {
        title: 'Demo profile',
        note: 'Демонстрационный профиль: Telegram-идентичность не подтверждена.'
      },
      {
        title: 'Road trip plans',
        note: 'Маршрут и формат ещё обсуждаются, это ранний MVP placeholder.'
      }
    ]
  }
];

export function assertDiscoverCandidateFixtures(
  buddies: readonly BuddyProfile[],
  currentUserId: string = CURRENT_USER_ID
): void {
  const buddyIds = new Set<string>();

  for (const buddy of buddies) {
    if (buddy.id === currentUserId) {
      throw new Error(`Current user id "${currentUserId}" cannot be a Discover candidate.`);
    }

    if (buddyIds.has(buddy.id)) {
      throw new Error(`Duplicate buddy id "${buddy.id}" found in Discover fixtures.`);
    }

    buddyIds.add(buddy.id);
  }
}

assertDiscoverCandidateFixtures(mockBuddies);

export function getDiscoverCandidates(
  buddies: readonly BuddyProfile[] = mockBuddies,
  currentUserId: string = CURRENT_USER_ID
): BuddyProfile[] {
  return buddies.filter((buddy) => buddy.id !== currentUserId);
}

function findSharedValues<T extends string>(currentValues: readonly T[], buddyValues: readonly T[]) {
  return buddyValues.filter((value) => currentValues.includes(value));
}

export function getBuddyById(id: string) {
  return mockBuddies.find((buddy) => buddy.id === id) ?? null;
}

export function getBuddyMatchSignals(
  buddy: TravelBuddy,
  currentUser: DiscoverCurrentUserProfile = currentUserDiscoverProfile
): BuddyMatchSignals {
  return {
    matchedDestinations: findSharedValues(currentUser.destinations, buddy.destinations),
    matchedInterests: findSharedValues(currentUser.interests, buddy.interests),
    matchedTravelStyles: findSharedValues(currentUser.travelStyles, buddy.travelStyles),
    isBudgetMatch: currentUser.budgetLevel === buddy.budgetLevel,
    isComfortMatch: currentUser.comfortLevel === buddy.comfortLevel
  };
}

export { getAvatarInitials as getBuddyInitials, getBudgetScale, getComfortLabel };
export { currentUserDiscoverProfile };
