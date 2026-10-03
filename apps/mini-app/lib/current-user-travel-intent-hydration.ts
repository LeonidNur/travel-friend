import type { BackendApiClient, TravelIntentResponse } from './backend-api-client';

export type ServerTravelIntentState =
  | Readonly<{ status: 'loading' }>
  | Readonly<{ status: 'loaded'; travelIntent: TravelIntentResponse | null }>
  | Readonly<{ status: 'error' }>
  | Readonly<{ status: 'invariant_error' }>;

type ServerTravelIntentHydrationInput = Readonly<{
  getTravelIntent: BackendApiClient['getTravelIntent'];
  token: string;
}>;

export function getTravelIntentHydrationToken(input: Readonly<{
  authStatus: string;
  accessToken: string | null;
  hydratedAccessToken: string | null;
}>): string | null {
  if (
    (input.authStatus !== 'authenticated' && input.authStatus !== 'onboarding_required') ||
    input.accessToken === null ||
    input.hydratedAccessToken === input.accessToken
  ) {
    return null;
  }

  return input.accessToken;
}

export async function hydrateServerTravelIntent(
  input: ServerTravelIntentHydrationInput
): Promise<Exclude<ServerTravelIntentState, { status: 'loading' }>> {
  try {
    const travelIntent = await input.getTravelIntent(input.token);
    return { status: 'loaded', travelIntent };
  } catch {
    return { status: 'error' };
  }
}

export function requireActiveTravelIntent(
  state: Exclude<ServerTravelIntentState, { status: 'loading' }>
): Exclude<ServerTravelIntentState, { status: 'loading' } | { status: 'loaded'; travelIntent: null }> {
  return state.status === 'loaded' && state.travelIntent === null ? { status: 'invariant_error' } : state;
}
