/**
 * Notification activity-event helpers.
 *
 * The platform event-ingest service exposes the append-only event stream for
 * one aggregate: `GET /api/v1/events/aggregate/{notificationId}?limit=50`
 * scoped by `X-EIA-Tenant`. An event is a fact that already happened; the
 * notification record remains the source of truth for its current channel,
 * recipient, template, and delivery state, and nothing in this timeline can
 * change the record.
 *
 * The response is `{ aggregateId, limit, items }`. Each item embeds the
 * canonical event envelope in `payload`; the notification facts live in its
 * `data` object. The helpers below accept the `{ items }` page (or a bare
 * array), tolerate a `payload` sent as the data object directly or as JSON
 * text, and sort newest first.
 */

export const ACTIVITY_LIMIT = 50;

/** Builds GET /api/v1/events/aggregate/{notificationId}?limit=… for one record. */
export function aggregateEventsEndpoint(notificationId, limit = ACTIVITY_LIMIT) {
  const id = String(notificationId || '').trim();
  if (!id) return '';
  return `/api/v1/events/aggregate/${encodeURIComponent(id)}?limit=${encodeURIComponent(limit)}`;
}

/** Accepts the `{ items }` page (or a bare array) and returns object rows. */
export function activityEvents(body) {
  const items = Array.isArray(body)
    ? body
    : body && Array.isArray(body.items)
      ? body.items
      : [];
  return items
    .filter((item) => item && typeof item === 'object')
    .slice()
    .sort(compareActivityEvents);
}

function eventTime(event) {
  const occurred = Date.parse(event && event.occurredAt);
  if (Number.isFinite(occurred)) return occurred;
  const received = Date.parse(event && event.receivedAt);
  return Number.isFinite(received) ? received : 0;
}

function numericVersion(value) {
  const version = Number(value);
  return Number.isFinite(version) ? version : -1;
}

/** Newest first; then highest aggregate version; then event id. */
export function compareActivityEvents(left, right) {
  const byTime = eventTime(right) - eventTime(left);
  if (byTime !== 0) return byTime;

  const byVersion = numericVersion(right && right.aggregateVersion)
    - numericVersion(left && left.aggregateVersion);
  if (byVersion !== 0) return byVersion;

  return String((left && left.eventId) || '').localeCompare(String((right && right.eventId) || ''));
}

const WORD_SEPARATOR = /[._\-\s]+/;

/** `notification` and `notifications` are the same vertical prefix. */
function singular(token) {
  const lower = String(token || '').toLowerCase();
  return lower.endsWith('s') ? lower.slice(0, -1) : lower;
}

/**
 * Turns `notifications.notification.created` into `Notification created` and
 * `notifications.notification.sent` into `Notification sent`. The leading
 * vertical is dropped only when it repeats the next segment, so the label
 * never stutters without hiding a meaningful word.
 */
export function readableEventType(eventType) {
  const tokens = String(eventType || '')
    .split(WORD_SEPARATOR)
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length === 0) return 'Notification event';

  const words = tokens.length > 1 && singular(tokens[0]) === singular(tokens[1])
    ? tokens.slice(1)
    : tokens;

  return words
    .map((word, index) => {
      const lower = word.toLowerCase();
      return index === 0 ? `${lower.charAt(0).toUpperCase()}${lower.slice(1)}` : lower;
    })
    .join(' ');
}

const PROCESSED_EVENT_STATUSES = ['PROCESSED', 'APPLIED', 'ACCEPTED', 'COMPLETE', 'COMPLETED', 'SUCCEEDED'];
const FAILED_EVENT_STATUSES = ['FAILED', 'REJECTED', 'ERROR', 'DEAD_LETTERED', 'DEAD_LETTER'];
const PENDING_EVENT_STATUSES = ['RECEIVED', 'PENDING', 'IN_PROGRESS', 'RETRY', 'RETRYING', 'HELD', 'QUARANTINED'];

/** Inbox status tone; the event status is not the notification status. */
export function eventStatusTone(status) {
  const value = String(status || '').toUpperCase();
  if (PROCESSED_EVENT_STATUSES.includes(value)) return 'green';
  if (FAILED_EVENT_STATUSES.includes(value)) return 'red';
  if (PENDING_EVENT_STATUSES.includes(value)) return 'amber';
  return 'blue';
}

const TIMESTAMP_FORMAT = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'UTC',
  timeZoneName: 'short'
});

/** Occurred-at in UTC, so a timeline row reads the same in every browser. */
export function formatEventTimestamp(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return TIMESTAMP_FORMAT.format(date);
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

/** The event `payload`; tolerates a JSON string or an absent payload. */
export function eventPayload(event) {
  let payload = event && event.payload;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      return {};
    }
  }
  return asObject(payload) || {};
}

/**
 * The canonical envelope nests notification facts in `payload.data`; some
 * projections send that data object directly. Both shapes are read.
 */
export function eventData(event) {
  const payload = eventPayload(event);
  const data = asObject(payload.data);
  return data ? { ...payload, ...data } : payload;
}

function text(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return '';
  return String(value).trim();
}

function readField(source, ...names) {
  for (const name of names) {
    const value = source[name];
    if (value !== null && value !== undefined && text(value) !== '') return text(value);
  }
  return '';
}

/** Keeps the notification type readable without hiding the exact code. */
export function readableNotificationType(value) {
  const type = text(value);
  return type ? type.replace(/_/g, ' ') : '';
}

/**
 * The notification version carried by this event: the record version in the
 * payload, falling back to the envelope's aggregate version.
 */
export function eventRecordVersion(event) {
  const data = eventData(event);
  const version = readField(data, 'version', 'notificationVersion', 'versionNumber');
  if (version) return version;
  const aggregateVersion = event && event.aggregateVersion;
  return aggregateVersion === null || aggregateVersion === undefined
    ? ''
    : String(aggregateVersion);
}

/**
 * The notification facts carried by this event's payload: channel, recipient,
 * type, and status (the payload status, or the transition when the event
 * carries one). Absent facts are omitted rather than rendered as blanks.
 */
export function payloadFacts(event) {
  const data = eventData(event);
  const facts = [];

  const channel = readField(data, 'channel');
  if (channel) facts.push({ key: 'channel', label: 'Channel', value: channel });

  const recipient = readField(data, 'recipientPartyId', 'recipientParty');
  if (recipient) facts.push({ key: 'recipient', label: 'Recipient', value: recipient });

  const notificationType = readableNotificationType(
    readField(data, 'notificationType', 'type', 'typeCode')
  );
  if (notificationType) {
    facts.push({ key: 'type', label: 'Type', value: notificationType });
  }

  const from = readField(data, 'from', 'fromStatus', 'previousStatus');
  const to = readField(data, 'to', 'toStatus', 'newStatus');
  const status = readField(data, 'status');
  if (from && to) {
    facts.push({ key: 'status', label: 'Status', value: `${from} → ${to}` });
  } else if (from) {
    facts.push({ key: 'status', label: 'Status', value: `${from} →` });
  } else if (to || status) {
    facts.push({ key: 'status', label: 'Status', value: to || status });
  }

  return facts;
}
