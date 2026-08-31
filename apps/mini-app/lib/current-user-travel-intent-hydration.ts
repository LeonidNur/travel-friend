import type { BackendApiClient, TravelIntentResponse } from './backend-api-client';

export type ServerTravelIntentState =
  | Readonly<{ status: 'loading' }>
  | Readonly<{ status: 'loaded'; travelIntent: TravelIntentResponse | null }>
  | Readonly<{ status: 'error' }>;

type ServerTravelIntentHydrationInput = Readonly<{
  getTravelIntent: BackendApiClient['getTravelIntent'];
  token: string;
}>;

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
