import type { DiscoverCandidateResponse } from './backend-api-client';

export type DiscoverPublicProfileState = 'error' | 'loading' | 'loaded' | 'unavailable';

type DiscoverPublicProfileStateInput = Readonly<{
  isLoading: boolean;
  hasError: boolean;
  candidate: DiscoverCandidateResponse | null;
}>;

export function findDiscoverCandidateById(
  candidates: readonly DiscoverCandidateResponse[],
  candidateId: string
): DiscoverCandidateResponse | null {
  return candidates.find((candidate) => candidate.user_id === candidateId) ?? null;
}

export function getDiscoverPublicProfileState({
  isLoading,
  hasError,
  candidate
}: DiscoverPublicProfileStateInput): DiscoverPublicProfileState {
  if (isLoading) {
    return 'loading';
  }

  if (hasError) {
    return 'error';
  }

  return candidate === null ? 'unavailable' : 'loaded';
}
