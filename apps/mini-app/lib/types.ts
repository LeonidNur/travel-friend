import type { InterestOption, TravelStyleOption } from '@/lib/travel-preferences';

export type BudgetLevel = 1 | 2 | 3 | 4;

export type ComfortLevel = 1 | 2 | 3 | 4;

export type TravelPreferences = {
  destinations: string[];
  interests: InterestOption[];
  budgetLevel: BudgetLevel;
  travelStyles: TravelStyleOption[];
  comfortLevel: ComfortLevel;
};

export type UserProfile = TravelPreferences & {
  name: string;
  age: number;
  city: string;
  dates: string;
};

export type BuddyProfile = UserProfile & {
  id: string;
  tagline: string;
  bio: string;
  compatibilityReason: string;
  compatibilityDetails: string[];
  likedYou: boolean;
  trustSignals: {
    title: string;
    note: string;
  }[];
};

export type InterestDecision = 'match' | 'interest-sent' | 'rejected';

export type ChatStatus = 'match' | 'interest_sent' | 'draft';

export type ChatParticipant = {
  id: string;
  name: string;
  age: number;
  city: string;
  isCurrentUser?: boolean;
  buddyProfileId?: string;
};

export type ChatMessage = {
  id: string;
  kind: 'participant' | 'system';
  authorId?: string;
  text: string;
  sentAtLabel: string;
  actionLabel?: string;
  actionHref?: string;
};

export type MockChat = {
  id: string;
  title: string;
  destination: string;
  status: ChatStatus;
  previewText: string;
  updatedLabel: string;
  participants: ChatParticipant[];
  messages: ChatMessage[];
};
