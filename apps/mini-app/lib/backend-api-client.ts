const BACKEND_API_PREFIX = '/api/backend';

export type OnboardingStatus = 'not_started' | 'in_progress' | 'completed';

export type TelegramAuthResponse = Readonly<{
  access_token: string;
  token_type: string;
  expires_at: string;
  user: Readonly<{
    id: string;
  }>;
  onboarding: Readonly<{
    status: OnboardingStatus;
  }>;
  profile_exists: boolean;
  travel_intent_exists: boolean;
}>;

export type ProfileResponse = Readonly<{
  id: string;
  user_id: string;
  display_name: string;
  birth_date: string | null;
  gender: string | null;
  city: string | null;
  bio: string | null;
  travel_style: Array<string | null>;
  interests: Array<string | null>;
  budget_level: string | null;
  comfort_level: string | null;
  created_at: string;
  updated_at: string;
}>;

export type ProfilePatchRequest = Readonly<{
  display_name?: string;
  birth_date?: string | null;
  gender?: string | null;
  city?: string | null;
  bio?: string | null;
  travel_style?: Array<string | null>;
  interests?: Array<string | null>;
  budget_level?: string | null;
  comfort_level?: string | null;
}>;

export type TravelIntentResponse = Readonly<{
  id: string;
  user_id: string;
  destination: string;
  date_from: string | null;
  date_to: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}>;

export type TravelIntentPutRequest = Readonly<{
  destination: string;
  date_from?: string | null;
  date_to?: string | null;
}>;

export type OnboardingPatchRequest = Readonly<{
  status: Exclude<OnboardingStatus, 'not_started'>;
}>;

export type OnboardingResponse = Readonly<{
  status: Exclude<OnboardingStatus, 'not_started'>;
}>;

export type DirectChatResponse = Readonly<{
  chat_id: string;
  type: 'direct';
  companion: Readonly<{
    user_id: string;
    display_name: string;
    age: number | null;
    city: string | null;
  }>;
  created_at: string;
}>;

export type TripListItemResponse = Readonly<{
  trip_id: string;
  chat_id: string;
  status: 'forming' | 'active' | 'completed' | 'cancelled';
  created_at: string;
  date_from: string | null;
  date_to: string | null;
  destination_status: 'empty' | 'confirmed' | 'review_required' | 'pending_analysis';
  dates_status: 'empty' | 'confirmed' | 'review_required' | 'pending_analysis';
  budget_status: 'empty' | 'confirmed' | 'review_required' | 'pending_analysis';
  transport_status: 'empty' | 'confirmed' | 'review_required' | 'pending_analysis';
  route_place_labels: string[];
}>;

export type ChatMessageResponse = Readonly<{
  message_id: string;
  chat_id: string;
  sequence_number: number;
  type: 'system' | 'user';
  sender_user_id: string | null;
  content_text: string | null;
  created_at: string;
}>;

export type ChatMessageCreateRequest = Readonly<{
  content_text: string;
}>;

export type DiscoverTravelIntentResponse = Readonly<{
  destination: string;
  date_from: string | null;
  date_to: string | null;
}>;

export type DiscoverCandidateResponse = Readonly<{
  user_id: string;
  display_name: string;
  age: number | null;
  city: string | null;
  bio: string | null;
  travel_style: string[];
  interests: string[];
  budget_level: string | null;
  comfort_level: string | null;
  travel_intent: DiscoverTravelIntentResponse;
}>;

export type DiscoverDecision = 'interested' | 'rejected';

export type DiscoverDecisionRequest = Readonly<{
  decision: DiscoverDecision;
}>;

export type DiscoverDecisionResponse = Readonly<{
  decision: DiscoverDecision;
  match_created: boolean;
  match_id: string | null;
}>;

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    super(getErrorMessage(status, body));
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

type RequestOptions = Readonly<{
  method: 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT';
  token?: string;
  body?: unknown;
}>;

export type BackendApiClient = Readonly<{
  authenticateWithTelegram: (initData: string) => Promise<TelegramAuthResponse>;
  getProfile: (token: string) => Promise<ProfileResponse | null>;
  patchProfile: (token: string, payload: ProfilePatchRequest) => Promise<ProfileResponse>;
  getTravelIntent: (token: string) => Promise<TravelIntentResponse | null>;
  putTravelIntent: (token: string, payload: TravelIntentPutRequest) => Promise<TravelIntentResponse>;
  deleteTravelIntent: (token: string) => Promise<void>;
  patchOnboarding: (token: string, payload: OnboardingPatchRequest) => Promise<OnboardingResponse>;
  getChats: (token: string) => Promise<DirectChatResponse[]>;
  getTrips: (token: string) => Promise<TripListItemResponse[]>;
  getChatMessages: (token: string, chatId: string) => Promise<ChatMessageResponse[]>;
  createChatMessage: (
    token: string,
    chatId: string,
    payload: ChatMessageCreateRequest
  ) => Promise<ChatMessageResponse>;
  getDiscoverCandidates: (token: string) => Promise<DiscoverCandidateResponse[]>;
  putDiscoverDecision: (
    token: string,
    targetUserId: string,
    payload: DiscoverDecisionRequest
  ) => Promise<DiscoverDecisionResponse>;
}>;

function getErrorMessage(status: number, body: unknown): string {
  if (isRecord(body) && typeof body.detail === 'string') {
    return body.detail;
  }

  return `Backend API request failed with status ${status}.`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function parseResponseBody(response: Response): Promise<unknown> {
  if (response.status === 204) {
    return undefined;
  }

  const text = await response.text();

  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export function createBackendApiClient(fetchImplementation: typeof fetch = fetch): BackendApiClient {
  async function request<T>(path: string, options: RequestOptions): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };

    if (options.token !== undefined) {
      headers.Authorization = `Bearer ${options.token}`;
    }

    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetchImplementation(`${BACKEND_API_PREFIX}${path}`, {
      method: options.method,
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) })
    });
    const body = await parseResponseBody(response);

    if (!response.ok) {
      throw new ApiError(response.status, body);
    }

    return body as T;
  }

  return {
    authenticateWithTelegram: (initData) =>
      request<TelegramAuthResponse>('/auth/telegram', {
        method: 'POST',
        body: { init_data: initData }
      }),
    getProfile: (token) => request<ProfileResponse | null>('/me/profile', { method: 'GET', token }),
    patchProfile: (token, payload) =>
      request<ProfileResponse>('/me/profile', { method: 'PATCH', token, body: payload }),
    getTravelIntent: (token) =>
      request<TravelIntentResponse | null>('/me/travel-intent', { method: 'GET', token }),
    putTravelIntent: (token, payload) =>
      request<TravelIntentResponse>('/me/travel-intent', { method: 'PUT', token, body: payload }),
    deleteTravelIntent: async (token) => {
      await request<void>('/me/travel-intent', { method: 'DELETE', token });
    },
    patchOnboarding: (token, payload) =>
      request<OnboardingResponse>('/me/onboarding', { method: 'PATCH', token, body: payload }),
    getChats: (token) => request<DirectChatResponse[]>('/chats', { method: 'GET', token }),
    getTrips: (token) => request<TripListItemResponse[]>('/trips', { method: 'GET', token }),
    getChatMessages: (token, chatId) =>
      request<ChatMessageResponse[]>(`/chats/${chatId}/messages`, { method: 'GET', token }),
    createChatMessage: (token, chatId, payload) =>
      request<ChatMessageResponse>(`/chats/${chatId}/messages`, { method: 'POST', token, body: payload }),
    getDiscoverCandidates: (token) =>
      request<DiscoverCandidateResponse[]>('/discover/candidates', { method: 'GET', token }),
    putDiscoverDecision: (token, targetUserId, payload) =>
      request<DiscoverDecisionResponse>(`/discover/decisions/${targetUserId}`, {
        method: 'PUT',
        token,
        body: payload
      })
  };
}
