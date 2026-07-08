import type {
  BudgetLevel,
  ComfortLevel,
  InterestOption,
  TravelStyleOption
} from '@/lib/travel-preferences';
import {
  getAvatarInitials,
  getBudgetScale,
  getComfortLabel
} from '@/lib/travel-preferences';

export interface TravelBuddy {
  id: string;
  name: string;
  age: number;
  city: string;
  tagline: string;
  bio: string;
  destinations: string[];
  budgetLevel: BudgetLevel;
  interests: InterestOption[];
  travelStyles: TravelStyleOption[];
  dates: string;
  comfortLevel: ComfortLevel;
  compatibilityReason: string;
  compatibilityDetails: string[];
  likedYou: boolean;
  trustSignals: {
    title: string;
    note: string;
  }[];
}

export interface DiscoverCurrentUserProfile {
  destinations: string[];
  interests: InterestOption[];
  budgetLevel: BudgetLevel;
  travelStyles: TravelStyleOption[];
  comfortLevel: ComfortLevel;
}

export interface BuddyMatchSignals {
  matchedDestinations: string[];
  matchedInterests: InterestOption[];
  matchedTravelStyles: TravelStyleOption[];
  isBudgetMatch: boolean;
  isComfortMatch: boolean;
}

export const currentUserDiscoverProfile: DiscoverCurrentUserProfile = {
  destinations: ['Тбилиси', 'Стамбул', 'Барселона'],
  interests: ['Музыка', 'Еда', 'Природа', 'Архитектура'],
  budgetLevel: 2,
  travelStyles: ['Городской', 'Познавательный / экскурсионный', 'Самостоятельный'],
  comfortLevel: 3
};

export const mockBuddies: TravelBuddy[] = [
  {
    id: 'alina-morozova',
    name: 'Алина Морозова',
    age: 29,
    city: 'Санкт-Петербург',
    tagline: 'Люблю города у моря, локальную еду и планы без перегруза.',
    bio: 'Ищу попутчика для тёплых городских поездок на 5-8 дней. Люблю сочетать прогулки по районам, локальную еду и пару дней без спешки.',
    destinations: ['Стамбул', 'Тбилиси', 'Барселона'],
    budgetLevel: 2,
    interests: ['Еда', 'Архитектура', 'Музыка', 'Фотография'],
    travelStyles: ['Городской', 'Познавательный / экскурсионный', 'Самостоятельный'],
    dates: 'Конец августа или первая половина сентября',
    comfortLevel: 3,
    likedYou: true,
    compatibilityReason: 'Может подойти, если вам близки спокойный темп, городские прогулки и понятный бюджет.',
    compatibilityDetails: [
      'Похоже, вы оба ориентируетесь на сбалансированный маршрут без перегруза активностями.',
      'Есть пересечение по интересам к городской атмосфере, еде и комфортной самостоятельной поездке.'
    ],
    trustSignals: [
      {
        title: 'Telegram connected',
        note: 'Профиль открыт из Telegram Mini App.'
      },
      {
        title: 'Profile active',
        note: 'Анкета заполнена и выглядит как готовая к первому контакту.'
      }
    ]
  },
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
    likedYou: false,
    compatibilityReason: 'Может подойти, если нужен активный попутчик для короткой, но насыщенной поездки.',
    compatibilityDetails: [
      'Похоже на сценарий для тех, кто любит много впечатлений за короткое время.',
      'Есть шанс на совпадение по городскому формату и части культурных интересов, но темп поездки у него заметно активнее.'
    ],
    trustSignals: [
      {
        title: 'Telegram connected',
        note: 'Профиль привязан к Mini App.'
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
    dates: 'Середина сентября, 7-10 дней',
    comfortLevel: 3,
    likedYou: true,
    compatibilityReason: 'Может подойти, если вам важны природа, активный день и спокойный бытовой комфорт.',
    compatibilityDetails: [
      'Есть пересечение по интересу к природе и размеренному отдыху после активного дня.',
      'Формат поездки ближе к природному маршруту, поэтому совместимость зависит от ваших направлений и ожиданий.'
    ],
    trustSignals: [
      {
        title: 'Telegram connected',
        note: 'Открыт из Telegram Mini App.'
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
        title: 'Telegram connected',
        note: 'Профиль привязан к приложению.'
      },
      {
        title: 'Road trip plans',
        note: 'Маршрут и формат ещё обсуждаются, это ранний MVP placeholder.'
      }
    ]
  }
];

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
