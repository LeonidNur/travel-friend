/** Manual, opt-in analytics boundary. The app uses the disabled default and wires no events. */

export type AnalyticsEventProperties = {
  user_registered: { registration_method: 'telegram'; app_surface: 'telegram_mini_app' };
  onboarding_completed: { completion_path: 'profile_and_travel_intent'; app_surface: 'telegram_mini_app' };
  app_opened: { app_surface: 'telegram_mini_app'; entry_state: 'authenticated' | 'unauthenticated' };
  discover_candidate_viewed: { candidate_ref: string; position_bucket: 'first' | 'later' };
  discover_decision_saved: { decision: 'interested' | 'rejected'; candidate_ref: string };
  match_created: { match_ref: string; chat_type: 'direct' | 'group' };
  chat_first_message_sent: { chat_ref: string; chat_type: 'direct' | 'group' };
  chat_message_sent: { chat_ref: string; chat_type: 'direct' | 'group' };
  group_chat_created: { chat_ref: string; participant_count_bucket: '3' | '4_5' | '6_plus' };
  trip_created: { trip_ref: string; chat_ref: string; chat_type: 'direct' | 'group'; initial_state: 'empty' };
  trip_opened: { trip_ref: string; trip_status: 'forming' | 'confirmed' | 'cancelled' };
  trip_draft_updated: {
    trip_ref: string;
    draft_version_bucket: '1' | '2_5' | '6_plus';
    changed_scope_groups: Array<'route' | 'dates' | 'budget' | 'accommodation' | 'transport' | 'itinerary' | 'notes'>;
  };
  trip_proposal_created: {
    trip_ref: string;
    proposal_ref: string;
    proposal_status: 'pending' | 'blocked';
    scope_group_count_bucket: '1' | '2_5' | '6_plus';
    has_prerequisites: boolean;
  };
  trip_proposal_vote_cast: {
    trip_ref: string;
    proposal_ref: string;
    vote: 'accept' | 'reject';
    voter_count_bucket: '2' | '3_5' | '6_plus';
  };
  trip_proposal_accepted: { trip_ref: string; proposal_ref: string; participant_count_bucket: '2' | '3_5' | '6_plus' };
  trip_proposal_rejected: { trip_ref: string; proposal_ref: string; participant_count_bucket: '2' | '3_5' | '6_plus' };
  trip_proposal_conflict: { conflict_kind: 'scope_overlap'; trip_ref: string };
};

export type AnalyticsEventName = keyof AnalyticsEventProperties;
export type FrontendAnalyticsEventName =
  | 'app_opened'
  | 'discover_candidate_viewed'
  | 'trip_opened'
  | 'trip_proposal_conflict';
export type AnalyticsEvent = Readonly<{
  event: AnalyticsEventName;
  distinctId: string;
  eventId: string;
  timestamp: string;
  properties: Readonly<Record<string, unknown>>;
}>;

export interface AnalyticsTransport {
  capture(event: AnalyticsEvent): void;
}

export type AnalyticsConsent = 'unknown' | 'denied' | 'granted';

export interface AnalyticsOptions {
  /** Explicit test/future opt-in; the application does not set this to true. */
  enabled?: boolean;
  /** Missing, unknown or denied consent always suppresses capture. */
  consent?: AnalyticsConsent;
  /** Authenticated backend UUID, or an anonymous UUID for app_opened only. */
  distinctId?: string;
  identityKind?: 'authenticated' | 'anonymous';
  transport?: AnalyticsTransport;
}

export interface AnalyticsClient {
  capture<EventName extends FrontendAnalyticsEventName>(
    event: EventName,
    properties: AnalyticsEventProperties[EventName],
    occurrence: Readonly<{ eventId: string; timestamp: string }>
  ): void;
}

const allowedKeys: Readonly<Record<AnalyticsEventName, readonly string[]>> = {
  user_registered: ['registration_method', 'app_surface'],
  onboarding_completed: ['completion_path', 'app_surface'],
  app_opened: ['app_surface', 'entry_state'],
  discover_candidate_viewed: ['candidate_ref', 'position_bucket'],
  discover_decision_saved: ['decision', 'candidate_ref'],
  match_created: ['match_ref', 'chat_type'],
  chat_first_message_sent: ['chat_ref', 'chat_type'],
  chat_message_sent: ['chat_ref', 'chat_type'],
  group_chat_created: ['chat_ref', 'participant_count_bucket'],
  trip_created: ['trip_ref', 'chat_ref', 'chat_type', 'initial_state'],
  trip_opened: ['trip_ref', 'trip_status'],
  trip_draft_updated: ['trip_ref', 'draft_version_bucket', 'changed_scope_groups'],
  trip_proposal_created: ['trip_ref', 'proposal_ref', 'proposal_status', 'scope_group_count_bucket', 'has_prerequisites'],
  trip_proposal_vote_cast: ['trip_ref', 'proposal_ref', 'vote', 'voter_count_bucket'],
  trip_proposal_accepted: ['trip_ref', 'proposal_ref', 'participant_count_bucket'],
  trip_proposal_rejected: ['trip_ref', 'proposal_ref', 'participant_count_bucket'],
  trip_proposal_conflict: ['conflict_kind', 'trip_ref']
};
export const ANALYTICS_EVENT_NAMES = Object.freeze(Object.keys(allowedKeys) as AnalyticsEventName[]);

const pseudonymousRef = /^[a-f0-9]{64}$/;
const frontendEvents: readonly FrontendAnalyticsEventName[] = [
  'app_opened', 'discover_candidate_viewed', 'trip_opened', 'trip_proposal_conflict'
];
const enumValues: Readonly<Record<string, readonly string[]>> = {
  app_surface: ['telegram_mini_app'],
  entry_state: ['authenticated', 'unauthenticated'],
  position_bucket: ['first', 'later'],
  trip_status: ['forming', 'confirmed', 'cancelled'],
  conflict_kind: ['scope_overlap']
};

function validateProperties<EventName extends AnalyticsEventName>(
  event: EventName,
  properties: AnalyticsEventProperties[EventName]
): Readonly<Record<string, unknown>> {
  if (!frontendEvents.includes(event as FrontendAnalyticsEventName)) {
    throw new TypeError('Event is not owned by the frontend');
  }
  if (properties === null || typeof properties !== 'object' || Array.isArray(properties)) {
    throw new TypeError('Invalid analytics properties');
  }
  const values = properties as Record<string, unknown>;
  const keys = Object.keys(values);
  if (keys.length !== allowedKeys[event].length || keys.some((key) => !allowedKeys[event].includes(key))) {
    throw new TypeError('Analytics property is not allowlisted');
  }
  for (const key of keys) {
    const value = values[key];
    if (/(_ref)$/.test(key) && (typeof value !== 'string' || !pseudonymousRef.test(value))) {
      throw new TypeError('Analytics entity references must be pseudonymous hashes');
    }
    if (typeof value === 'string' && /(message|text|route|destination|title|name|token|telegram|url)/i.test(key)) {
      throw new TypeError('Potentially identifying analytics property is not allowed');
    }
    if (enumValues[key] && (typeof value !== 'string' || !enumValues[key].includes(value))) {
      throw new TypeError('Analytics enum is not allowlisted');
    }
    if (Array.isArray(value) && value.some((item) => typeof item !== 'string')) {
      throw new TypeError('Analytics arrays may contain only safe enums');
    }
  }
  return Object.freeze({ ...values });
}

export function createAnalyticsClient(options: AnalyticsOptions = {}): AnalyticsClient {
  const validIdentity = typeof options.distinctId === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(options.distinctId)
    && (options.identityKind === undefined || options.identityKind === 'authenticated' || options.identityKind === 'anonymous');
  const enabled = options.enabled === true
    && options.consent === 'granted'
    && options.transport !== undefined
    && validIdentity;
  return {
    capture(event, properties, occurrence) {
      if (!enabled) return;
      if (options.identityKind === 'anonymous' && event !== 'app_opened') return;
      try {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(occurrence.eventId)) {
          throw new TypeError('Analytics event ID must be a UUID');
        }
        if (!occurrence.timestamp.endsWith('Z') || !Number.isFinite(Date.parse(occurrence.timestamp))) {
          throw new TypeError('Analytics timestamp must be a valid UTC value');
        }
        const safeProperties = validateProperties(event, properties);
        options.transport?.capture({
          event,
          distinctId: options.distinctId as string,
          eventId: occurrence.eventId,
          timestamp: occurrence.timestamp,
          properties: safeProperties
        });
      } catch {
        // Analytics must never affect a product interaction.
      }
    }
  };
}

/** Explicit production default; no SDK, provider configuration or network client is initialized. */
export const analytics = createAnalyticsClient();
