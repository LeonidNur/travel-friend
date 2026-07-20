import type { TravelPreferences, UserProfile } from './types';

export const CURRENT_USER_ID = 'current-user';

export type CurrentUserProfile = UserProfile & {
  id: typeof CURRENT_USER_ID;
};

export const currentUserProfile: CurrentUserProfile = {
  id: CURRENT_USER_ID,
  name: 'Алина Морозова',
  age: 29,
  city: 'Санкт-Петербург',
  destinations: ['Тбилиси', 'Стамбул', 'Барселона'],
  dates: 'Гибкие, в пределах недели',
  interests: ['Музыка', 'Еда', 'Природа', 'Архитектура'],
  budgetLevel: 2,
  travelStyles: ['Городской', 'Познавательный / экскурсионный', 'Самостоятельный'],
  comfortLevel: 3
};

export const currentUserDiscoverProfile: TravelPreferences = {
  destinations: currentUserProfile.destinations,
  interests: currentUserProfile.interests,
  budgetLevel: currentUserProfile.budgetLevel,
  travelStyles: currentUserProfile.travelStyles,
  comfortLevel: currentUserProfile.comfortLevel
};
