'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { useTelegramAuthSession } from '@/components/TelegramAuthBootstrapProvider';
import { createBackendApiClient } from '@/lib/backend-api-client';
import {
  hydrateServerProfile,
  type ServerProfileState
} from '@/lib/current-user-profile-hydration';
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
  serverProfile: ServerProfileState;
};

const CurrentUserProfileContext = createContext<CurrentUserProfileContextValue | undefined>(undefined);

const backendApiClient = createBackendApiClient();

type ProfileHydrationState = Readonly<{
  accessToken: string;
  state: Exclude<ServerProfileState, { status: 'loading' }>;
}>;

export function CurrentUserProfileProvider({ children }: { children: React.ReactNode }) {
  const { session: authSession, status: authStatus } = useTelegramAuthSession();
  const [profileSession, setProfileSession] = useState(createCurrentUserProfileSession);
  const [hydrationState, setHydrationState] = useState<ProfileHydrationState | null>(null);
  const profile = useMemo(() => getCurrentUserProfile(profileSession), [profileSession]);

  useEffect(() => {
    if (authStatus !== 'authenticated' || authSession === null) {
      return;
    }

    let isCurrent = true;
    const accessToken = authSession.accessToken;

    void hydrateServerProfile({
      getProfile: backendApiClient.getProfile,
      token: accessToken
    }).then((state) => {
      if (isCurrent) {
        setHydrationState({ accessToken, state });
      }
    });

    return () => {
      isCurrent = false;
    };
  }, [authSession, authStatus]);

  const saveProfile = useCallback((nextProfile: UserProfile) => {
    setProfileSession((currentSession) => saveCurrentUserProfile(currentSession, nextProfile));
  }, []);

  const value = useMemo(() => {
    const serverProfile =
      authStatus === 'authenticated' &&
      authSession !== null &&
      hydrationState?.accessToken === authSession.accessToken
        ? hydrationState.state
        : { status: 'loading' as const };

    return { profile, saveProfile, serverProfile };
  }, [authSession, authStatus, hydrationState, profile, saveProfile]);

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
