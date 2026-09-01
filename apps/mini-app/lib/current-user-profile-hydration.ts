import type { BackendApiClient, ProfileResponse } from './backend-api-client';

export type ServerProfileState =
  | Readonly<{ status: 'loading' }>
  | Readonly<{ status: 'loaded'; profile: ProfileResponse | null }>
  | Readonly<{ status: 'error' }>;

type ServerProfileHydrationInput = Readonly<{
  getProfile: BackendApiClient['getProfile'];
  token: string;
}>;

function isValidBirthDate(value: string): boolean {
  const parts = value.split('-').map(Number);

  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part))) {
    return false;
  }

  const [year, month, day] = parts;
  const date = new Date(Date.UTC(year, month - 1, day));

  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function calculateAgeFromBirthDate(birthDate: string, now: Date = new Date()): number | null {
  if (!isValidBirthDate(birthDate)) {
    return null;
  }

  const [birthYear, birthMonth, birthDay] = birthDate.split('-').map(Number) as [number, number, number];
  const hasHadBirthday =
    now.getUTCMonth() + 1 > birthMonth ||
    (now.getUTCMonth() + 1 === birthMonth && now.getUTCDate() >= birthDay);

  return now.getUTCFullYear() - birthYear - (hasHadBirthday ? 0 : 1);
}

export async function hydrateServerProfile(
  input: ServerProfileHydrationInput
): Promise<Exclude<ServerProfileState, { status: 'loading' }>> {
  try {
    const profile = await input.getProfile(input.token);

    return { status: 'loaded', profile };
  } catch {
    return { status: 'error' };
  }
}
