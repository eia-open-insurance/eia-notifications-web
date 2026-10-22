/**
 * Delivery-attempt helpers for the notifications remote.
 *
 * `GET /api/v1/notifications/{id}/attempts` is the per-attempt delivery
 * history. The domain returns a list (or, in some projections, an object with
 * an `items`/`attempts` list); each entry carries the attempt number, the
 * provider that simulated delivery, its status, the provider-issued reference,
 * when it was attempted, and the failure text when it failed. The helpers here
 * normalize that shape so the record screen never depends on one projection
 * spelling and never crashes on an unexpected payload.
 */

const LOCAL_PROVIDER_CODES = new Set([
  'LOCAL',
  'LOCAL_SIMULATED',
  'LOCAL_SIMULATOR',
  'SIMULATED',
  'SIMULATOR',
  'IN_MEMORY'
]);

const DELIVERED_STATUSES = ['DELIVERED', 'SENT', 'ACKNOWLEDGED', 'READ'];
const FAILED_STATUSES = [
  'FAILED',
  'FAILURE',
  'ERROR',
  'BOUNCED',
  'REJECTED',
  'UNDELIVERABLE',
  'TIMED_OUT',
  'TIMEOUT'
];
const PENDING_STATUSES = [
  'QUEUED',
  'PENDING',
  'SENDING',
  'RETRYING',
  'PROCESSING',
  'SIMULATED'
];

export function attemptsEndpoint(notificationId) {
  return `/api/v1/notifications/${encodeURIComponent(notificationId)}/attempts`;
}

function text(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function firstText(...values) {
  for (const value of values) {
    const normalized = text(value);
    if (normalized) return normalized;
  }
  return '';
}

function attemptContainer(body) {
  if (Array.isArray(body)) return body;
  if (!body || typeof body !== 'object') return [];
  for (const key of ['items', 'attempts', 'content', 'results', 'data']) {
    if (Array.isArray(body[key])) return body[key];
  }
  return [];
}

export function attemptProvider(item) {
  if (!item || typeof item !== 'object') return '';
  const nested = item.provider && typeof item.provider === 'object' ? item.provider : null;
  return firstText(
    nested?.code,
    nested?.name,
    item.providerCode,
    item.providerName,
    item.provider,
    item.providerId,
    item.channelProvider
  );
}

export function attemptReference(item) {
  if (!item || typeof item !== 'object') return '';
  return firstText(
    item.providerReference,
    item.providerRef,
    item.reference,
    item.externalReference
  );
}

export function attemptStatus(item) {
  if (!item || typeof item !== 'object') return 'UNKNOWN';
  const status = firstText(item.status, item.outcome, item.deliveryStatus);
  if (status) return status.toUpperCase();
  if (item.success === true) return 'DELIVERED';
  if (item.success === false) return 'FAILED';
  return 'UNKNOWN';
}

export function attemptError(item) {
  if (!item || typeof item !== 'object') return '';
  const nested = item.error && typeof item.error === 'object' ? item.error : null;
  return firstText(
    typeof item.error === 'string' ? item.error : '',
    item.errorMessage,
    item.failureReason,
    item.failureDetail,
    item.errorDetail,
    nested?.message,
    nested?.detail,
    item.errorCode,
    nested?.code
  );
}

export function attemptTime(item) {
  if (!item || typeof item !== 'object') return '';
  return firstText(
    item.attemptedAt,
    item.attemptedAtUtc,
    item.attemptAt,
    item.attemptedOn,
    item.createdAt,
    item.occurredAt
  );
}

function attemptNumber(item, index) {
  const candidate = Number(
    item?.attemptNumber ?? item?.attemptNo ?? item?.attempt ?? item?.sequence ?? item?.number
  );
  return Number.isInteger(candidate) && candidate > 0 ? candidate : index + 1;
}

export function attemptStatusTone(status) {
  const value = String(status || '').toUpperCase();
  if (DELIVERED_STATUSES.includes(value)) return 'green';
  if (FAILED_STATUSES.includes(value)) return 'red';
  if (PENDING_STATUSES.includes(value)) return 'amber';
  return 'blue';
}

export function providerCode(provider) {
  const value = text(provider);
  return value;
}

/**
 * True for the local simulator codes. A missing provider is treated as local
 * simulation because this slice has no production provider adapter.
 */
export function isLocalSimulatedProvider(provider) {
  const code = providerCode(provider).toUpperCase().replace(/[\s-]+/g, '_');
  if (!code) return true;
  return LOCAL_PROVIDER_CODES.has(code) || code.includes('SIMULAT');
}

export function providerLabel(provider) {
  if (isLocalSimulatedProvider(provider)) return 'Local simulated delivery';
  return providerCode(provider).replace(/_/g, ' ');
}

function normalizeAttempt(item, index) {
  const number = attemptNumber(item, index);
  return {
    key: firstText(item?.id, item?.attemptId) || `attempt-${number}-${index}`,
    attemptNumber: number,
    provider: attemptProvider(item),
    providerLabel: providerLabel(attemptProvider(item)),
    status: attemptStatus(item),
    providerReference: attemptReference(item),
    attemptedAt: attemptTime(item),
    error: attemptError(item),
    order: index
  };
}

/**
 * Normalizes the attempts response into ascending attempt-number order. Errors
 * in one entry never discard the rest of the history.
 */
export function deliveryAttempts(body) {
  return attemptContainer(body)
    .filter((item) => item && typeof item === 'object')
    .map(normalizeAttempt)
    .sort((left, right) => left.attemptNumber - right.attemptNumber || left.order - right.order);
}
