'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { useTelegramAuthSession } from '@/components/TelegramAuthBootstrapProvider';
import {
  createBackendApiClient,
  type ProfileResponse,
  type TravelIntentResponse
} from '@/lib/backend-api-client';
import {
  hydrateServerProfile,
  type ServerProfileState
} from '@/lib/current-user-profile-hydration';
import {
  hydrateServerTravelIntent,
  type ServerTravelIntentState
} from '@/lib/current-user-travel-intent-hydration';
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
  setServerProfile: (profile: ProfileResponse) => void;
  serverTravelIntent: ServerTravelIntentState;
  setServerTravelIntent: (travelIntent: TravelIntentResponse) => void;
};

const CurrentUserProfileContext = createContext<CurrentUserProfileContextValue | undefined>(undefined);

const backendApiClient = createBackendApiClient();

type ProfileHydrationState = Readonly<{
  accessToken: string;
  state: Exclude<ServerProfileState, { status: 'loading' }>;
}>;

type TravelIntentHydrationState = Readonly<{
  accessToken: string;
  state: Exclude<ServerTravelIntentState, { status: 'loading' }>;
}>;

export function CurrentUserProfileProvider({ children }: { children: React.ReactNode }) {
  const { session: authSession, status: authStatus } = useTelegramAuthSession();
  const [profileSession, setProfileSession] = useState(createCurrentUserProfileSession);
  const [hydrationState, setHydrationState] = useState<ProfileHydrationState | null>(null);
  const [travelIntentHydrationState, setTravelIntentHydrationState] = useState<TravelIntentHydrationState | null>(null);
  const profile = useMemo(() => getCurrentUserProfile(profileSession), [profileSession]);

  useEffect(() => {
    if ((authStatus !== 'authenticated' && authStatus !== 'onboarding_required') || authSession === null) {
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

  useEffect(() => {
    if (authStatus !== 'onboarding_required' || authSession === null) {
      return;
    }

    let isCurrent = true;
    const accessToken = authSession.accessToken;

    void hydrateServerTravelIntent({
      getTravelIntent: backendApiClient.getTravelIntent,
      token: accessToken
    }).then((state) => {
      if (isCurrent) {
        setTravelIntentHydrationState({ accessToken, state });
      }
    });

    return () => {
      isCurrent = false;
    };
  }, [authSession, authStatus]);

  const saveProfile = useCallback((nextProfile: UserProfile) => {
    setProfileSession((currentSession) => saveCurrentUserProfile(currentSession, nextProfile));
  }, []);

  const setServerProfile = useCallback((profile: ProfileResponse) => {
    if (authSession === null) {
      return;
    }

    setHydrationState({ accessToken: authSession.accessToken, state: { status: 'loaded', profile } });
  }, [authSession]);

  const setServerTravelIntent = useCallback((travelIntent: TravelIntentResponse) => {
    if (authSession === null) {
      return;
    }

    setTravelIntentHydrationState({
      accessToken: authSession.accessToken,
      state: { status: 'loaded', travelIntent }
    });
  }, [authSession]);

  const value = useMemo(() => {
    const serverProfile =
      (authStatus === 'authenticated' || authStatus === 'onboarding_required') &&
      authSession !== null &&
      hydrationState?.accessToken === authSession.accessToken
        ? hydrationState.state
        : { status: 'loading' as const };
    const serverTravelIntent =
      authStatus === 'onboarding_required' &&
      authSession !== null &&
      travelIntentHydrationState?.accessToken === authSession.accessToken
        ? travelIntentHydrationState.state
        : { status: 'loading' as const };

    return {
      profile,
      saveProfile,
      serverProfile,
      setServerProfile,
      serverTravelIntent,
      setServerTravelIntent
    };
  }, [
    authSession,
    authStatus,
    hydrationState,
    profile,
    saveProfile,
    setServerProfile,
    setServerTravelIntent,
    travelIntentHydrationState
  ]);

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
