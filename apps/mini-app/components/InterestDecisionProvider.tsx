'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

import {
  setInterestDecision as setInitialInterestDecision,
  type InterestDecisions
} from '@/lib/interest-decisions';
import { CURRENT_USER_ID } from '@/lib/mock-current-user';
import {
  createDraftTrip,
  getActiveTripByChatId,
  getTripById,
  getTrips
} from '@/lib/mock-trips';
import type { InterestDecision, MockChat, Trip } from '@/lib/types';

interface InterestDecisionContextValue {
  decisions: InterestDecisions;
  trips: readonly Trip[];
  getDecision: (buddyId: string) => InterestDecision | undefined;
  getTrip: (tripId: string) => Trip | undefined;
  getActiveTrip: (chatId: string) => Trip | undefined;
  setDecision: (buddyId: string, decision: InterestDecision) => void;
  startPlanning: (chat: MockChat) => Trip | undefined;
}

const InterestDecisionContext = createContext<InterestDecisionContextValue | undefined>(undefined);

export function InterestDecisionProvider({ children }: { children: React.ReactNode }) {
  const [decisions, setDecisions] = useState<InterestDecisions>({});
  const initialTrips = getTrips();
  const tripsRef = useRef<readonly Trip[]>(initialTrips);
  const [trips, setTrips] = useState<readonly Trip[]>(initialTrips);

  const getDecision = useCallback(
    (buddyId: string) => decisions[buddyId],
    [decisions]
  );

  const setDecision = useCallback((buddyId: string, decision: InterestDecision) => {
    if (buddyId === CURRENT_USER_ID) {
      return;
    }

    setDecisions((currentDecisions) =>
      setInitialInterestDecision(currentDecisions, buddyId, decision)
    );
  }, []);

  const getTrip = useCallback(
    (tripId: string) => getTripById(tripId, trips),
    [trips]
  );

  const getActiveTrip = useCallback(
    (chatId: string) => getActiveTripByChatId(chatId, trips),
    [trips]
  );

  const startPlanning = useCallback((chat: MockChat) => {
    if (chat.status !== 'match') {
      return undefined;
    }

    const currentTrips = tripsRef.current;
    const activeTrip = getActiveTripByChatId(chat.id, currentTrips);

    if (activeTrip) {
      return activeTrip;
    }

    const draftTrip = createDraftTrip(chat, currentTrips, `session-trip-${chat.id}`);
    const nextTrips = [...currentTrips, draftTrip];

    tripsRef.current = nextTrips;
    setTrips(nextTrips);

    return draftTrip;
  }, []);

  const value = useMemo(
    () => ({
      decisions,
      trips,
      getDecision,
      getTrip,
      getActiveTrip,
      setDecision,
      startPlanning
    }),
    [decisions, trips, getDecision, getTrip, getActiveTrip, setDecision, startPlanning]
  );

  return (
    <InterestDecisionContext.Provider value={value}>
      {children}
    </InterestDecisionContext.Provider>
  );
}

export function useInterestDecisions() {
  const context = useContext(InterestDecisionContext);

  if (!context) {
    throw new Error('useInterestDecisions must be used within InterestDecisionProvider.');
  }

  return context;
}

export function useTripSession() {
  const { trips, getTrip, getActiveTrip, startPlanning } = useInterestDecisions();

  return { trips, getTrip, getActiveTrip, startPlanning };
}
