'use client';

import { useEffect, useState } from 'react';

import { TripsList } from '@/components/TripsList';
import { useTelegramAuthSession } from '@/components/TelegramAuthBootstrapProvider';
import { createBackendApiClient, type TripListItemResponse } from '@/lib/backend-api-client';
import { getTripListScreenState } from '@/lib/trip-list-runtime';

const backendApiClient = createBackendApiClient();

export default function TripsPage() {
  const { session } = useTelegramAuthSession();
  const [trips, setTrips] = useState<TripListItemResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (session === null) {
      return;
    }

    let isCurrent = true;
    void backendApiClient.getTrips(session.accessToken).then(
      (nextTrips) => {
        if (isCurrent) {
          setTrips(nextTrips);
          setIsLoading(false);
        }
      },
      () => {
        if (isCurrent) {
          setError('Не удалось загрузить поездки. Попробуйте открыть экран ещё раз.');
          setIsLoading(false);
        }
      }
    );

    return () => {
      isCurrent = false;
    };
  }, [reloadKey, session]);

  const screenState = getTripListScreenState({ isLoading, error, trips });
  const handleRetry = () => {
    setIsLoading(true);
    setError(null);
    setReloadKey((key) => key + 1);
  };

  return <TripsList state={screenState} trips={trips} onRetry={handleRetry} />;
}
