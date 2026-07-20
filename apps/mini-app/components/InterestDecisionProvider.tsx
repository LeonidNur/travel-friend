'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';

import {
  setInterestDecision as setInitialInterestDecision,
  type InterestDecisions
} from '@/lib/interest-decisions';
import { CURRENT_USER_ID } from '@/lib/mock-current-user';
import type { InterestDecision } from '@/lib/types';

interface InterestDecisionContextValue {
  decisions: InterestDecisions;
  getDecision: (buddyId: string) => InterestDecision | undefined;
  setDecision: (buddyId: string, decision: InterestDecision) => void;
}

const InterestDecisionContext = createContext<InterestDecisionContextValue | undefined>(undefined);

export function InterestDecisionProvider({ children }: { children: React.ReactNode }) {
  const [decisions, setDecisions] = useState<InterestDecisions>({});

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

  const value = useMemo(
    () => ({ decisions, getDecision, setDecision }),
    [decisions, getDecision, setDecision]
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
