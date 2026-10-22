import React from 'react';
import {
  attemptStatusTone,
  providerLabel
} from './attempts.js';

function formatAttemptInstant(value) {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString();
}

/**
 * The per-attempt delivery history for one notification. The card is rendered
 * from state loaded as soon as a record is opened; loading, empty, and error
 * states stay inside the Delivery tab and never block the record header or the
 * record-level delivery table.
 */
export default function DeliveryAttempts({
  notification,
  items = [],
  loading = false,
  error = '',
  onRefresh
}) {
  const status = notification?.status ? String(notification.status) : '';
  const countLabel = loading
    ? '…'
    : `${items.length} ${items.length === 1 ? 'attempt' : 'attempts'}`;
  const emptyText = status === 'CREATED'
    ? 'No delivery attempts yet. This notification is still CREATED and has not been sent, so no attempt exists. The first attempt is recorded when the send transition runs.'
    : 'No delivery attempts yet. No send attempt has been recorded for this notification. The first attempt is recorded when the send transition runs.';

  return (
    <section
      className="eia-card eia-delivery-attempts"
      data-testid="notification-attempts"
      aria-label="Delivery attempts"
    >
      <div className="eia-toolbar" style={{ marginBottom: 6 }}>
        <div>
          <h3 style={{ margin: 0 }}>Delivery attempts</h3>
          <span className="eia-muted" style={{ fontSize: 11 }}>
            Attempt history from the local delivery simulator · oldest first
          </span>
        </div>
        <span className="spacer" />
        <span className="eia-muted" data-testid="attempts-count">{countLabel}</span>
        <button
          type="button"
          className="eia-btn-secondary"
          data-testid="attempts-refresh"
          onClick={() => {
            if (onRefresh) onRefresh();
          }}
          disabled={loading}
          aria-label="Refresh delivery attempts"
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <p
        className="eia-muted eia-delivery-attempts-note"
        data-testid="attempts-provider-note"
        style={{ margin: 0 }}
      >
        Delivery is simulated locally: attempts are recorded by the local simulated provider, which
        also issues the provider reference. No production provider adapter (email/SMTP, SMS gateway,
        push, or webhook) is wired into this slice.
      </p>

      {loading ? (
        <p className="eia-muted" data-testid="attempts-loading" style={{ margin: '12px 0 0' }}>
          Loading delivery attempts…
        </p>
      ) : error ? (
        <p className="eia-muted" data-testid="attempts-error" style={{ margin: '12px 0 0' }}>
          {error}
        </p>
      ) : items.length === 0 ? (
        <div className="eia-empty" data-testid="attempts-empty" style={{ marginTop: 12 }}>
          {emptyText}
        </div>
      ) : (
        <div className="eia-table-wrap" style={{ marginTop: 12 }}>
          <table className="eia-table" data-testid="attempts-table">
            <thead>
              <tr>
                <th>Attempt</th>
                <th>Provider</th>
                <th>Status</th>
                <th>Provider reference</th>
                <th>Attempted</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {items.map((attempt) => (
                <tr key={attempt.key} data-testid="attempt-row">
                  <td className="eia-mono" data-testid="attempt-number">
                    #{attempt.attemptNumber}
                  </td>
                  <td data-testid="attempt-provider">
                    <span>{attempt.providerLabel || providerLabel(attempt.provider)}</span>
                    {attempt.provider && (
                      <div className="eia-mono" data-testid="attempt-provider-code">
                        {attempt.provider}
                      </div>
                    )}
                  </td>
                  <td>
                    <span
                      className={`eia-pill ${attemptStatusTone(attempt.status)}`}
                      data-testid="attempt-status"
                    >
                      {attempt.status}
                    </span>
                  </td>
                  <td
                    className="eia-mono"
                    data-testid="attempt-reference"
                    title={attempt.providerReference || undefined}
                  >
                    {attempt.providerReference || '—'}
                  </td>
                  <td>
                    <time
                      className="eia-attempt-time"
                      data-testid="attempt-time"
                      dateTime={attempt.attemptedAt || undefined}
                      title={attempt.attemptedAt || undefined}
                    >
                      {formatAttemptInstant(attempt.attemptedAt)}
                    </time>
                  </td>
                  <td
                    className={attempt.error ? 'eia-attempt-error' : ''}
                    data-testid="attempt-error"
                    title={attempt.error || undefined}
                  >
                    {attempt.error || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
