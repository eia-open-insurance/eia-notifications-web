/**
 * Notification source-record linkage.
 *
 * A notification is delivered because a business record changed. The
 * notification carries a flat `sourceType`/`sourceId`/`sourceReference` link
 * to that record so the operator can trace the message back to the claim,
 * policy, contract, or payment that caused it. `sourceType` decides which
 * remote owns the record; `sourceReference` is the human label and never
 * replaces `sourceId` for a classified source.
 *
 * The type/id pair is all-or-nothing: a source is either classified by both a
 * type and a record id, or omitted. A reference may stand alone because the
 * backend keeps it as optional metadata.
 */
import { recordHref } from './navigation.js';

export const SOURCE_TYPES = [
  'DIRECT_CLAIM',
  'ASSUMED_CLAIM',
  'POLICY',
  'CONTRACT',
  'PAYMENT',
  'OTHER'
];

export const SOURCE_REFERENCE_MAX_LENGTH = 64;

/** Query keys for the notification-list source filter. */
export const SOURCE_FILTER_TYPE_PARAM = 'sourceType';
export const SOURCE_FILTER_ID_PARAM = 'sourceId';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SOURCE_LABELS = {
  DIRECT_CLAIM: 'Direct claim',
  ASSUMED_CLAIM: 'Assumed claim',
  POLICY: 'Policy',
  CONTRACT: 'Contract',
  PAYMENT: 'Payment',
  OTHER: 'Other source'
};

const SOURCE_ROUTES = {
  DIRECT_CLAIM: 'direct-claims',
  ASSUMED_CLAIM: 'assumed-claims',
  POLICY: 'policy',
  CONTRACT: 'contract',
  PAYMENT: 'payment'
};

/** Uppercases a known source type; blank and unknown values resolve to ''. */
export function normalizeSourceType(value) {
  const type = String(value || '').trim().toUpperCase();
  return SOURCE_TYPES.includes(type) ? type : '';
}

/** Readable source-type label, falling back to the raw value for unknown data. */
export function sourceTypeLabel(value) {
  const normalized = normalizeSourceType(value);
  if (SOURCE_LABELS[normalized]) return SOURCE_LABELS[normalized];
  return value ? String(value).replace(/_/g, ' ') : '';
}

/**
 * Reads the optional notification-list source filter from URL parameters.
 *
 * The API accepts only a complete classified pair. A partial or malformed
 * pair resolves to no filter and a readable error, so the workbench never
 * sends half a pair (which the API would reject as INVALID_SOURCE_FILTER).
 */
export function readSourceFilter(params) {
  const rawType = String(params?.get?.(SOURCE_FILTER_TYPE_PARAM) || '').trim();
  const rawId = String(params?.get?.(SOURCE_FILTER_ID_PARAM) || '').trim();

  if (!rawType && !rawId) return { filter: null, error: '' };
  if (!rawType) {
    return {
      filter: null,
      error: 'Select a source type before filtering by a source record id.'
    };
  }

  const sourceType = normalizeSourceType(rawType);
  if (!sourceType) {
    return {
      filter: null,
      error: `Source type '${rawType}' is not one of: ${SOURCE_TYPES.join(', ')}.`
    };
  }
  if (!rawId) {
    return {
      filter: null,
      error: `Enter the source record id for the ${sourceTypeLabel(sourceType)} source.`
    };
  }
  if (!UUID_PATTERN.test(rawId)) {
    return { filter: null, error: 'Source record id must be a UUID.' };
  }

  return { filter: { sourceType, sourceId: rawId }, error: '' };
}

/** Builds the queue endpoint for a source filter; both halves are required. */
export function sourceFilterEndpoint(filter) {
  if (!filter?.sourceType || !filter?.sourceId) return '/api/v1/notifications';
  const params = new URLSearchParams();
  params.set(SOURCE_FILTER_TYPE_PARAM, filter.sourceType);
  params.set(SOURCE_FILTER_ID_PARAM, filter.sourceId);
  return `/api/v1/notifications?${params.toString()}`;
}

/** True when a notification carries the exact source pair being filtered. */
export function matchesSourceFilter(notification, filter) {
  if (!filter?.sourceType || !filter?.sourceId) return false;
  return (
    normalizeSourceType(notification?.sourceType) === filter.sourceType
    && String(notification?.sourceId || '').trim().toLowerCase()
      === String(filter.sourceId).trim().toLowerCase()
  );
}

/**
 * Human reference for the source filter, resolved from the filtered queue.
 * The API filter is type/id only, so a reference is only available when a
 * returned notification carries it; the caller falls back to the short id.
 */
export function sourceFilterReference(notifications, filter) {
  if (!filter?.sourceType || !filter?.sourceId) return '';
  const row = (Array.isArray(notifications) ? notifications : []).find(
    (notification) => matchesSourceFilter(notification, filter)
  );
  return String(row?.sourceReference || '').trim();
}

/** True when the notification carries any part of a source link. */
export function hasSource(source) {
  return Boolean(
    source && (source.sourceType || source.sourceId || source.sourceReference)
  );
}

/**
 * Shell route owned by the source record, or '' when the type has no owning
 * remote (OTHER) or no record id was supplied. `OTHER` stays plain text.
 */
export function sourceHref(source) {
  if (!source || !source.sourceId) return '';
  const route = SOURCE_ROUTES[normalizeSourceType(source.sourceType)];
  return route ? recordHref(route, source.sourceId) : '';
}

/** Link/text label: the human reference, then a short id, then the type. */
export function sourceDisplayValue(source) {
  if (!source) return '';
  const reference = String(source.sourceReference || '').trim();
  if (reference) return reference;
  const id = String(source.sourceId || '').trim();
  if (id) return id.length > 8 ? `${id.slice(0, 8)}…` : id;
  return sourceTypeLabel(source.sourceType);
}

/**
 * Mirrors the Notifications API source-linkage rules so a hand-off fails fast
 * in the dialog: sourceType and sourceId go together, the id is a UUID, and
 * sourceReference is optional metadata limited to 64 characters.
 */
export function validateSourceFields(form) {
  const issues = [];
  const sourceType = normalizeSourceType(form.sourceType);
  const sourceId = String(form.sourceId || '').trim();
  const sourceReference = String(form.sourceReference || '').trim();

  if (sourceType && !sourceId) {
    issues.push(`Enter the source record id for the ${sourceTypeLabel(sourceType)} source.`);
  }
  if (!sourceType && sourceId) {
    issues.push('Select a source type before entering a source record id.');
  }
  if (sourceId && !UUID_PATTERN.test(sourceId)) {
    issues.push('Source record id must be a UUID.');
  }
  if (sourceReference.length > SOURCE_REFERENCE_MAX_LENGTH) {
    issues.push(`Source reference must be ${SOURCE_REFERENCE_MAX_LENGTH} characters or fewer.`);
  }
  return issues;
}

/**
 * Adds the supplied source parts to a create payload. Returns null when the
 * draft carries no source at all, so the payload stays unchanged for the
 * common no-source notification.
 */
export function sourcePayload(form) {
  const sourceType = normalizeSourceType(form.sourceType);
  const sourceId = String(form.sourceId || '').trim();
  const sourceReference = String(form.sourceReference || '').trim();
  const payload = {};
  if (sourceType) payload.sourceType = sourceType;
  if (sourceId) payload.sourceId = sourceId;
  if (sourceReference) payload.sourceReference = sourceReference;
  return Object.keys(payload).length > 0 ? payload : null;
}
