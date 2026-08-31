import type { BudgetLevel, ComfortLevel } from '@/lib/types';

export const PROFILE_LEVEL_VALUES = ['1', '2', '3', '4'] as const;

export type CanonicalProfileLevel = (typeof PROFILE_LEVEL_VALUES)[number];

export const INTEREST_OPTIONS = [
  'Кино',
  'Книги',
  'Игры',
  'Аниме',
  'Музыка',
  'Спорт',
  'Еда',
  'Вечеринки',
  'Музеи',
  'История',
  'Природа',
  'Фотография',
  'Архитектура',
  'Языки',
  'Технологии'
] as const;

export const TRAVEL_STYLE_OPTIONS = [
  'Пассивный / пляжный',
  'Активный / спортивный',
  'Познавательный / экскурсионный',
  'Оздоровительный / санаторный',
  'Развлекательный',
  'Горный',
  'Лесной / природный',
  'Городской',
  'Сельский / агротуризм',
  'Водный / море и реки',
  'Зимний / лыжи и сноуборд',
  'Экстремальный',
  'Событийный / фестивали',
  'Круизный',
  'Автомобильный / road trip',
  'Самостоятельный',
  'Пакетный / турпакет',
  'Виртуальный / игры и кино',
  'Медитативный / ретрит',
  'Волонтёрский',
  'Этнический',
  'Интеллектуальный'
] as const;

export const BUDGET_OPTIONS = [
  { level: 1, label: '$', description: 'Экономно' },
  { level: 2, label: '$$', description: 'Комфортно, без лишнего' },
  { level: 3, label: '$$$', description: 'Выше среднего' },
  { level: 4, label: '$$$$', description: 'Премиум' }
] as const;

export const COMFORT_OPTIONS = [
  { level: 1, label: 'Уровень 1', description: 'Максимально просто, хостелы и минимум удобств' },
  { level: 2, label: 'Уровень 2', description: 'Базовый комфорт: чисто, безопасно, без люкса' },
  { level: 3, label: 'Уровень 3', description: 'Хороший комфорт: удобное жильё и меньше компромиссов' },
  { level: 4, label: 'Уровень 4', description: 'Высокий комфорт: отели, приватность, удобная логистика' }
] as const;

export type InterestOption = (typeof INTEREST_OPTIONS)[number];
export type TravelStyleOption = (typeof TRAVEL_STYLE_OPTIONS)[number];

const PROFILE_LEVEL_BY_VALUE: Readonly<Record<CanonicalProfileLevel, BudgetLevel>> = {
  '1': 1,
  '2': 2,
  '3': 3,
  '4': 4
};

export function toCanonicalProfileLevel(
  level: BudgetLevel | ComfortLevel | null
): CanonicalProfileLevel | null {
  return level === null ? null : String(level) as CanonicalProfileLevel;
}

export function fromCanonicalProfileLevel(value: string | null): BudgetLevel | null {
  return value !== null && value in PROFILE_LEVEL_BY_VALUE
    ? PROFILE_LEVEL_BY_VALUE[value as CanonicalProfileLevel]
    : null;
}

export function getAvatarInitials(name: string) {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  if (parts.length === 0) {
    return 'TF';
  }

  return parts.map((part) => part[0]?.toUpperCase() ?? '').join('');
}

export function getBudgetScale(level: BudgetLevel) {
  return '$'.repeat(level);
}

export function getBudgetLabel(level: BudgetLevel) {
  return BUDGET_OPTIONS.find((option) => option.level === level)?.description ?? '';
}

export function getComfortLabel(level: ComfortLevel) {
  return COMFORT_OPTIONS.find((option) => option.level === level)?.description ?? '';
}

export function toggleMultiValue<T extends string>(values: readonly T[], value: T): T[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}
