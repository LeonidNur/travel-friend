import type { DiscoverCandidateResponse } from './backend-api-client';
import {
  fromCanonicalProfileLevel,
  getBudgetScale,
  getComfortLabel
} from './travel-preferences';

export type DiscoverCardCandidate = Readonly<{
  userId: string;
  displayName: string;
  age: number | null;
  city: string | null;
  bio: string | null;
  travelStyle: string[];
  interests: string[];
  budgetLevel: string | null;
  comfortLevel: string | null;
  travelIntent: Readonly<{
    destination: string;
    dateFrom: string | null;
    dateTo: string | null;
  }>;
}>;

export type DiscoverState = Readonly<{
  candidates: DiscoverCandidateResponse[];
  currentIndex: number;
  loading: boolean;
  loadError: boolean;
  submitting: boolean;
  decisionError: boolean;
}>;

export type DiscoverAction =
  | Readonly<{ type: 'load_started' }>
  | Readonly<{ type: 'load_succeeded'; candidates: DiscoverCandidateResponse[] }>
  | Readonly<{ type: 'load_failed' }>
  | Readonly<{ type: 'decision_started' }>
  | Readonly<{ type: 'decision_succeeded' }>
  | Readonly<{ type: 'decision_failed' }>;

export function toDiscoverCardCandidate(candidate: DiscoverCandidateResponse): DiscoverCardCandidate {
  return {
    userId: candidate.user_id,
    displayName: candidate.display_name,
    age: candidate.age,
    city: candidate.city,
    bio: candidate.bio,
    travelStyle: candidate.travel_style,
    interests: candidate.interests,
    budgetLevel: candidate.budget_level,
    comfortLevel: candidate.comfort_level,
    travelIntent: {
      destination: candidate.travel_intent.destination,
      dateFrom: candidate.travel_intent.date_from,
      dateTo: candidate.travel_intent.date_to
    }
  };
}

export function getDiscoverLevelLabels(
  budgetLevel: string | null,
  comfortLevel: string | null
): Readonly<{ budget: string | null; comfort: string | null }> {
  const canonicalBudgetLevel = fromCanonicalProfileLevel(budgetLevel);
  const canonicalComfortLevel = fromCanonicalProfileLevel(comfortLevel);

  return {
    budget: canonicalBudgetLevel === null ? null : getBudgetScale(canonicalBudgetLevel),
    comfort: canonicalComfortLevel === null ? null : getComfortLabel(canonicalComfortLevel)
  };
}

export function createInitialDiscoverState(): DiscoverState {
  return {
    candidates: [],
    currentIndex: 0,
    loading: true,
    loadError: false,
    submitting: false,
    decisionError: false
  };
}

export function getCurrentDiscoverCandidate(state: DiscoverState): DiscoverCandidateResponse | null {
  return state.candidates[state.currentIndex] ?? null;
}

export function discoverReducer(state: DiscoverState, action: DiscoverAction): DiscoverState {
  switch (action.type) {
    case 'load_started':
      return { ...state, loading: true, loadError: false };
    case 'load_succeeded':
      return {
        ...state,
        candidates: action.candidates,
        currentIndex: 0,
        loading: false,
        loadError: false,
        decisionError: false
      };
    case 'load_failed':
      return { ...state, loading: false, loadError: true };
    case 'decision_started':
      return state.submitting ? state : { ...state, submitting: true, decisionError: false };
    case 'decision_succeeded':
      return {
        ...state,
        currentIndex: state.currentIndex + 1,
        submitting: false,
        decisionError: false
      };
    case 'decision_failed':
      return { ...state, submitting: false, decisionError: true };
  }
}
