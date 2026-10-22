/**
 * Shared HTTP plumbing for the notifications remote.
 *
 * Every call is tenant scoped. Problem responses (`application/problem+json`)
 * are converted to an Error that keeps the stable API code and HTTP status so
 * a screen can show `CODE: message` and react to a conflict without parsing
 * the text again.
 */
export const TENANT = '11111111-1111-7111-8111-111111111111';

export function problemMessage(body, fallback) {
  if (!body) return fallback;
  const summary = body.detail || body.title || body.message || fallback;
  const errors = Array.isArray(body.errors) ? body.errors : Array.isArray(body.details) ? body.details : [];
  if (errors.length === 0) return summary;
  const details = errors
    .map((error) => `${error.field || 'request'}: ${error.message || error.code || 'is invalid'}`)
    .join('; ');
  return `${summary} (${details})`;
}

export async function api(path, options = {}) {
  // `tenant: false` marks public master data (for example the people
  // directory), which the gateway serves without tenant scoping.
  const { tenant = true, ...init } = options;
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(tenant ? { 'X-EIA-Tenant': TENANT } : {}),
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {})
    }
  });
  let body = null;
  try {
    body = await response.json();
  } catch (ignored) {
    // The domain may return an empty error body if it never reached the API.
  }
  if (!response.ok) {
    const error = new Error(problemMessage(body, `Request failed with HTTP ${response.status}`));
    error.code = body?.code;
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

export function errorText(error) {
  if (!error) return '';
  return error.code ? `${error.code}: ${error.message}` : error.message;
}
