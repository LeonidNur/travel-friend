'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';

import {
  createCurrentUserProfileSession,
  getCurrentUserProfile,
  saveCurrentUserProfile
} from '@/lib/current-user-profile-session';
import type { CurrentUserProfile } from '@/lib/mock-current-user';
import type { UserProfile } from '@/lib/types';

type CurrentUserProfileContextValue = {
  profile: CurrentUserProfile;
  saveProfile: (profile: UserProfile) => void;
};

const CurrentUserProfileContext = createContext<CurrentUserProfileContextValue | undefined>(undefined);

export function CurrentUserProfileProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState(createCurrentUserProfileSession);
  const profile = useMemo(() => getCurrentUserProfile(session), [session]);

  const saveProfile = useCallback((nextProfile: UserProfile) => {
    setSession((currentSession) => saveCurrentUserProfile(currentSession, nextProfile));
  }, []);

  const value = useMemo(
    () => ({ profile, saveProfile }),
    [profile, saveProfile]
  );

  return (
    <CurrentUserProfileContext.Provider value={value}>
      {children}
    </CurrentUserProfileContext.Provider>
  );
}

export function useCurrentUserProfile() {
  const context = useContext(CurrentUserProfileContext);

  if (!context) {
    throw new Error('useCurrentUserProfile must be used within CurrentUserProfileProvider.');
  }

  return context;
}
