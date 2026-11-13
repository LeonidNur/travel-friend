import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ANALYTICS_EVENT_NAMES,
  createAnalyticsClient,
  type AnalyticsEventName,
  type AnalyticsTransport
} from './analytics';

test('frontend contract contains exactly the approved 17 event names', () => {
  assert.equal(ANALYTICS_EVENT_NAMES.length, 17);
  assert.deepEqual(ANALYTICS_EVENT_NAMES, [
    'user_registered', 'onboarding_completed', 'app_opened', 'discover_candidate_viewed',
    'discover_decision_saved', 'match_created', 'chat_first_message_sent', 'chat_message_sent',
    'group_chat_created', 'trip_created', 'trip_opened', 'trip_draft_updated',
    'trip_proposal_created', 'trip_proposal_vote_cast', 'trip_proposal_accepted',
    'trip_proposal_rejected', 'trip_proposal_conflict'
  ]);
});

const safeEvent = {
  event: 'trip_opened',
  properties: { trip_ref: 'a'.repeat(64), trip_status: 'forming' }
} as const satisfies { event: AnalyticsEventName; properties: Record<string, string> };
const identity = {
  distinctId: 'd2b7c15c-2f99-4e29-b24e-0d7bbc1f7c43',
  identityKind: 'authenticated' as const
};
const occurrence = {
  eventId: 'a2b7c15c-2f99-4e29-b24e-0d7bbc1f7c43',
  timestamp: '2026-11-13T12:00:00.000Z'
};

function captureSafe(client: ReturnType<typeof createAnalyticsClient>) {
  client.capture(safeEvent.event, safeEvent.properties, occurrence);
}

function recordingTransport() {
  const events: unknown[] = [];
  const transport: AnalyticsTransport = { capture: (event) => events.push(event) };
  return { events, transport };
}

test('analytics is disabled by default and sends no events', () => {
  const { events, transport } = recordingTransport();
  const client = createAnalyticsClient({ transport });

  captureSafe(client);

  assert.deepEqual(events, []);
});

test('unknown or denied consent and absent transport fail closed', () => {
  const { events, transport } = recordingTransport();
  createAnalyticsClient({ ...identity, enabled: true, consent: 'unknown', transport }).capture(
    safeEvent.event,
    safeEvent.properties,
    occurrence
  );
  createAnalyticsClient({ ...identity, enabled: true, consent: 'granted' }).capture(
    safeEvent.event,
    safeEvent.properties,
    occurrence
  );
  createAnalyticsClient({ enabled: true, consent: 'granted', transport }).capture(
    safeEvent.event,
    safeEvent.properties,
    occurrence
  );

  assert.deepEqual(events, []);
});

test('anonymous identity can capture app_opened only', () => {
  const { events, transport } = recordingTransport();
  const client = createAnalyticsClient({
    enabled: true,
    consent: 'granted',
    distinctId: 'd2b7c15c-2f99-4e29-b24e-0d7bbc1f7c43',
    identityKind: 'anonymous',
    transport
  });

  client.capture('trip_opened', safeEvent.properties, occurrence);
  client.capture('app_opened', { app_surface: 'telegram_mini_app', entry_state: 'unauthenticated' }, occurrence);

  assert.equal(events.length, 1);
  assert.equal((events[0] as { event: string }).event, 'app_opened');
});

test('authorized manual capture sends one typed allowlisted event', () => {
  const { events, transport } = recordingTransport();
  const client = createAnalyticsClient({ ...identity, enabled: true, consent: 'granted', transport });

  captureSafe(client);

  assert.equal(events.length, 1);
  assert.equal((events[0] as { event: string }).event, 'trip_opened');
  assert.equal((events[0] as { eventId: string }).eventId, occurrence.eventId);
});

test('unknown event properties and direct or content PII are rejected', () => {
  const { events, transport } = recordingTransport();
  const client = createAnalyticsClient({ ...identity, enabled: true, consent: 'granted', transport });

  assert.doesNotThrow(() => client.capture('trip_opened', { trip_ref: 'a'.repeat(64), title: 'Rome' } as never, occurrence));
  assert.doesNotThrow(() => client.capture('chat_message_sent' as never, { chat_ref: 'a'.repeat(64), message_text: 'hello' } as never, occurrence));
  assert.doesNotThrow(() => client.capture('trip_opened', { trip_ref: 'raw-trip-id', trip_status: 'forming' } as never, occurrence));
  assert.deepEqual(events, []);
});

test('missing SDK and SDK failures never affect product behavior', () => {
  const absent = createAnalyticsClient({ ...identity, enabled: true, consent: 'granted' });
  assert.doesNotThrow(() => captureSafe(absent));

  const failing = createAnalyticsClient({
    enabled: true,
    consent: 'granted',
    ...identity,
    transport: { capture: () => { throw new Error('provider unavailable'); } }
  });
  assert.doesNotThrow(() => captureSafe(failing));
});
