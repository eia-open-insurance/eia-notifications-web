import React, { useEffect, useState } from 'react';
import './ui.css';

const TENANT = '11111111-1111-7111-8111-111111111111';
const DEMO_PARTY_ID = '0192f3a4-0000-7000-8000-000000000002';

const NOTIFICATION_TYPES = [
  'NEW_CLAIM_NOTICE',
  'CLAIM_ASSIGNED',
  'PAYMENT_AUTHORITY_REQUEST',
  'APPROVAL_REQUEST',
  'TASK_ASSIGNED',
  'MENTION'
];

const CHANNELS = ['IN_APP', 'EMAIL', 'SMS', 'PUSH', 'WEBHOOK', 'TASK', 'DIGEST'];

const SENDABLE_STATUSES = ['CREATED', 'QUEUED'];

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'delivery', label: 'Delivery' },
  { id: 'template', label: 'Template' }
];

const EMPTY_FORM = {
  notificationType: 'NEW_CLAIM_NOTICE',
  channel: 'IN_APP',
  recipientPartyId: DEMO_PARTY_ID,
  subject: '',
  body: '',
  templateCode: 'CLAIM_NOTICE_STANDARD',
  scheduledAt: ''
};

const OVERLAY_STYLE = {
  position: 'fixed',
  inset: 0,
  zIndex: 50,
  display: 'grid',
  placeItems: 'center',
  padding: 20,
  background: 'rgba(11, 46, 79, 0.52)'
};

const DIALOG_STYLE = {
  width: 'min(880px, 100%)',
  maxHeight: '90vh',
  overflow: 'auto',
  boxShadow: '0 24px 70px rgba(11, 46, 79, 0.28)'
};

function problemMessage(body, fallback) {
  if (!body) return fallback;
  const summary = body.detail || body.title || body.message || fallback;
  const errors = Array.isArray(body.errors) ? body.errors : Array.isArray(body.details) ? body.details : [];
  if (errors.length === 0) return summary;
  const details = errors
    .map((error) => `${error.field || 'request'}: ${error.message || error.code || 'is invalid'}`)
    .join('; ');
  return `${summary} (${details})`;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'X-EIA-Tenant': TENANT,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
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
    throw error;
  }
  return body;
}

function errorText(error) {
  if (!error) return '';
  return error.code ? `${error.code}: ${error.message}` : error.message;
}

function formatInstant(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

function shortId(value) {
  if (!value) return '—';
  const text = String(value);
  return text.length > 8 ? `${text.slice(0, 8)}…` : text;
}

function humanize(value) {
  if (!value) return '—';
  return String(value).replace(/_/g, ' ');
}

function statusTone(status) {
  if (['SENT', 'DELIVERED', 'READ', 'ACKNOWLEDGED', 'ACTIONED'].includes(status)) return 'green';
  if (['FAILED', 'EXPIRED', 'CANCELLED'].includes(status)) return 'red';
  if (['QUEUED', 'SUPPRESSED'].includes(status)) return 'amber';
  return 'blue';
}

function isSendable(status) {
  return SENDABLE_STATUSES.includes(status);
}

function Field({ label, htmlFor, className = '', children }) {
  return (
    <div className={`eia-field ${className}`.trim()}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
    </div>
  );
}

export default function App() {
  const [notifications, setNotifications] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [sending, setSending] = useState(false);
  const [detailNonce, setDetailNonce] = useState(0);

  const selectedRow = notifications.find((notification) => notification.id === selectedId) || null;
  const selected = detail && detail.id === selectedId ? detail : selectedRow;

  async function load(preferredId) {
    const data = await api('/api/v1/notifications');
    const rows = Array.isArray(data) ? data : [];
    setNotifications(rows);
    setSelectedId((current) => {
      if (preferredId && rows.some((notification) => notification.id === preferredId)) return preferredId;
      if (current && rows.some((notification) => notification.id === current)) return current;
      return rows[0]?.id || null;
    });
    return rows;
  }

  useEffect(() => {
    load()
      .catch((cause) => setError(errorText(cause)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    let alive = true;
    if (!selectedId) {
      setDetail(null);
      return undefined;
    }
    api(`/api/v1/notifications/${selectedId}`)
      .then((notification) => {
        if (alive) setDetail(notification);
      })
      .catch((cause) => {
        if (alive) setError(errorText(cause));
      });
    return () => {
      alive = false;
    };
  }, [selectedId, detailNonce]);

  useEffect(() => {
    if (!createOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !creating) {
        setCreateOpen(false);
        setError('');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [createOpen, creating]);

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function selectNotification(notification) {
    if (notification.id !== selectedId) setActiveTab('overview');
    setSelectedId(notification.id);
    setError('');
    setNotice('');
  }

  async function refresh() {
    setError('');
    setNotice('');
    try {
      await load(selectedId);
      if (selectedId) setDetailNonce((value) => value + 1);
    } catch (cause) {
      setError(errorText(cause));
    }
  }

  function openCreate() {
    setForm(EMPTY_FORM);
    setError('');
    setNotice('');
    setCreateOpen(true);
  }

  function closeCreate() {
    if (creating) return;
    setCreateOpen(false);
    setError('');
  }

  async function submit(event) {
    event.preventDefault();
    setError('');
    setNotice('');
    setCreating(true);
    const payload = {
      notificationType: form.notificationType,
      channel: form.channel,
      recipientPartyId: form.recipientPartyId,
      subject: form.subject,
      body: form.body,
      templateCode: form.templateCode || null,
      templateVersion: form.templateCode ? 1 : null,
      scheduledAt: form.scheduledAt ? new Date(form.scheduledAt).toISOString() : null
    };
    try {
      const created = await api('/api/v1/notifications', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      setForm((current) => ({ ...current, subject: '', body: '', scheduledAt: '' }));
      setCreateOpen(false);
      setNotice(
        created?.notificationNumber
          ? `Notification ${created.notificationNumber} created.`
          : 'Notification created.'
      );
      await load(created?.id);
      if (created?.id) {
        setSelectedId(created.id);
        setDetail(created);
        setActiveTab('overview');
      }
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setCreating(false);
    }
  }

  async function send(notification) {
    if (!notification || !isSendable(notification.status) || sending) return;
    setError('');
    setNotice('');
    setSending(true);
    try {
      const sent = await api(`/api/v1/notifications/${notification.id}/send`, { method: 'POST' });
      if (sent?.id) setDetail(sent);
      setNotice(
        sent?.notificationNumber
          ? `${sent.notificationNumber} sent.`
          : 'Notification sent.'
      );
      await load(notification.id);
      setDetailNonce((value) => value + 1);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setSending(false);
    }
  }

  function renderTab(notification) {
    if (activeTab === 'delivery') {
      return (
        <section
          id="panel-delivery"
          role="tabpanel"
          aria-labelledby="tab-delivery"
        >
          <div className="eia-section-title">
            <h2>Delivery</h2>
            <span className="eia-muted">Record-level delivery state</span>
          </div>
          <div className="eia-table-wrap">
            <table className="eia-table" data-testid="delivery-table">
              <thead>
                <tr>
                  <th>Channel</th>
                  <th>Status</th>
                  <th>Recipient</th>
                  <th>Scheduled</th>
                  <th>Sent</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{notification.channel || '—'}</td>
                  <td>
                    <span className={`eia-pill ${statusTone(notification.status)}`}>
                      {notification.status}
                    </span>
                  </td>
                  <td className="eia-mono">{shortId(notification.recipientPartyId)}</td>
                  <td>{formatInstant(notification.scheduledAt)}</td>
                  <td>{formatInstant(notification.sentAt)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="eia-muted" style={{ marginTop: 12 }}>
            The Notifications API exposes delivery at the record level. Per-attempt delivery history is
            not part of this API slice.
          </p>
        </section>
      );
    }

    if (activeTab === 'template') {
      return (
        <section
          id="panel-template"
          role="tabpanel"
          aria-labelledby="tab-template"
        >
          <div className="eia-section-title">
            <h2>Template</h2>
            <span className="eia-muted">
              {notification.templateCode ? 'Approved rendering source' : 'No template bound'}
            </span>
          </div>
          {notification.templateCode ? (
            <div className="eia-table-wrap">
              <table className="eia-table" data-testid="template-table">
                <thead>
                  <tr>
                    <th>Template code</th>
                    <th>Version</th>
                    <th>Channel</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="eia-mono">{notification.templateCode}</td>
                    <td>{notification.templateVersion ?? '—'}</td>
                    <td>{notification.channel || '—'}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : (
            <div className="eia-empty">
              No template bound. Sending requires an approved template (NTF-01, NTF-14).
            </div>
          )}
          <section className="eia-card" aria-label="Rendered content" style={{ marginTop: 16 }}>
            <h3>Rendered content</h3>
            <dl className="eia-kv" style={{ marginTop: 8 }}>
              <dt>Subject</dt>
              <dd>{notification.subject || '—'}</dd>
              <dt>Body</dt>
              <dd style={{ whiteSpace: 'pre-wrap' }}>{notification.body || '—'}</dd>
            </dl>
          </section>
        </section>
      );
    }

    return (
      <section
        id="panel-overview"
        role="tabpanel"
        aria-labelledby="tab-overview"
      >
        <div className="eia-grid eia-grid-2">
          <section className="eia-card" aria-label="Notification details">
            <h3>Notification details</h3>
            <dl className="eia-kv" style={{ marginTop: 8 }}>
              <dt>Notification number</dt>
              <dd className="eia-mono">{notification.notificationNumber}</dd>
              <dt>Type</dt>
              <dd>{humanize(notification.notificationType)}</dd>
              <dt>Recipient party</dt>
              <dd className="eia-mono">{notification.recipientPartyId || '—'}</dd>
              <dt>Channel</dt>
              <dd>{notification.channel || '—'}</dd>
              <dt>Status</dt>
              <dd>{notification.status || '—'}</dd>
              <dt>Created</dt>
              <dd>{formatInstant(notification.createdAt)}</dd>
              <dt>Updated</dt>
              <dd>{formatInstant(notification.updatedAt)}</dd>
              <dt>Version</dt>
              <dd>{notification.version ?? '—'}</dd>
            </dl>
          </section>
          <section className="eia-card" aria-label="Message body">
            <h3>Message body</h3>
            <p style={{ whiteSpace: 'pre-wrap', margin: '8px 0 0' }}>
              {notification.body || '—'}
            </p>
          </section>
        </div>
      </section>
    );
  }

  return (
    <main>
      <header className="eia-page-head">
        <div>
          <div className="eyebrow">Operations · Notifications</div>
          <h1>Notifications</h1>
          <p className="subtitle">
            Notifications owns attention: it turns domain events into a message for the right person,
            on the right channel, at the right time. Sending requires an approved template.
          </p>
        </div>
        <div className="eia-actions">
          <button type="button" className="eia-btn-ghost" onClick={refresh}>
            Refresh
          </button>
          <button type="button" onClick={openCreate} aria-haspopup="dialog">
            Create notification
          </button>
        </div>
      </header>

      {notice && <p role="status" style={{ margin: '0 0 12px' }}>{notice}</p>}
      {error && !createOpen && <p role="alert" style={{ margin: '0 0 12px' }}>{error}</p>}

      <div className="eia-record-layout">
        <aside className="eia-record-list" aria-label="Notification queue">
          <div className="eia-record-list-head">
            <strong>Notification queue</strong>
            <span className="eia-muted">{loading ? '…' : notifications.length}</span>
          </div>
          {notifications.map((notification) => {
            const isSelected = notification.id === selectedId;
            return (
              <button
                key={notification.id}
                type="button"
                className={isSelected ? 'selected' : ''}
                aria-current={isSelected ? 'true' : undefined}
                aria-label={`Open record ${notification.notificationNumber}`}
                onClick={() => selectNotification(notification)}
              >
                <span className="record-primary">{notification.notificationNumber}</span>
                <span className="record-secondary">{notification.subject}</span>
                <span className="record-secondary">
                  To {shortId(notification.recipientPartyId)} · {notification.channel}
                </span>
                <span>
                  <span className={`eia-pill ${statusTone(notification.status)}`}>
                    {notification.status}
                  </span>
                </span>
              </button>
            );
          })}
          {!loading && notifications.length === 0 && (
            <div className="empty">No notifications yet. Use Create notification to open the first record.</div>
          )}
          {loading && <div className="empty">Loading notifications…</div>}
        </aside>

        <section className="eia-record-panel" aria-label="Notification record">
          {selected ? (
            <>
              <div className="eia-record-title">
                <div>
                  <h2>{selected.notificationNumber}</h2>
                  <p className="eia-record-subtitle">{selected.subject}</p>
                  <p className="eia-record-subtitle">
                    <span
                      className={`eia-pill ${statusTone(selected.status)}`}
                      data-testid="notification-status"
                    >
                      {selected.status}
                    </span>
                    {' · '}Channel {selected.channel || '—'}
                    {' · '}Recipient {shortId(selected.recipientPartyId)}
                  </p>
                </div>
                <div className="eia-actions">
                  <button type="button" className="eia-btn-ghost" onClick={refresh} disabled={sending}>
                    Refresh record
                  </button>
                  <button
                    type="button"
                    onClick={() => send(selected)}
                    disabled={!isSendable(selected.status) || sending}
                    title={
                      isSendable(selected.status)
                        ? 'Send this notification'
                        : `Only CREATED or QUEUED notifications can be sent (current status ${selected.status}).`
                    }
                  >
                    {sending ? 'Sending…' : 'Send'}
                  </button>
                </div>
              </div>

              <div className="eia-summary-grid">
                <div className="eia-card">
                  <h3>Channel</h3>
                  <div className="value" data-testid="summary-channel">{selected.channel || '—'}</div>
                  <div className="eia-metric-label">Delivery channel</div>
                </div>
                <div className="eia-card">
                  <h3>Status</h3>
                  <div className="value" data-testid="summary-status">{selected.status || '—'}</div>
                  <div className="eia-metric-label">Notification lifecycle</div>
                </div>
                <div className="eia-card">
                  <h3>Scheduled</h3>
                  <div className="value" data-testid="summary-scheduled">
                    {formatInstant(selected.scheduledAt)}
                  </div>
                  <div className="eia-metric-label">Quiet hours or digest</div>
                </div>
                <div className="eia-card">
                  <h3>Sent</h3>
                  <div className="value" data-testid="summary-sent">{formatInstant(selected.sentAt)}</div>
                  <div className="eia-metric-label">First successful send</div>
                </div>
              </div>

              <nav className="eia-tabs" role="tablist" aria-label="Notification sections">
                {TABS.map((tab) => (
                  <button
                    key={tab.id}
                    id={`tab-${tab.id}`}
                    type="button"
                    role="tab"
                    className={`eia-tab${activeTab === tab.id ? ' active' : ''}`}
                    aria-selected={activeTab === tab.id}
                    aria-controls={`panel-${tab.id}`}
                    onClick={() => setActiveTab(tab.id)}
                  >
                    {tab.label}
                  </button>
                ))}
              </nav>

              {renderTab(selected)}
            </>
          ) : (
            <div className="eia-empty">
              <p style={{ marginTop: 0 }}>
                {loading
                  ? 'Loading the notification queue…'
                  : 'Select a notification from the queue or create the first notification.'}
              </p>
              {!loading && (
                <button type="button" onClick={openCreate} aria-haspopup="dialog">
                  Create notification
                </button>
              )}
            </div>
          )}
        </section>
      </div>

      {createOpen && (
        <div
          style={OVERLAY_STYLE}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !creating) closeCreate();
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-notification-title"
            className="eia-card"
            style={DIALOG_STYLE}
          >
            <div className="eia-record-title">
              <div>
                <h2 id="create-notification-title" style={{ margin: 0 }}>Create notification</h2>
                <p className="eia-record-subtitle">
                  Creates a notification draft. Sending requires an approved template and happens from
                  the record header.
                </p>
              </div>
              <button type="button" className="eia-btn-ghost" onClick={closeCreate} disabled={creating}>
                Close
              </button>
            </div>

            <form className="eia-form-grid" onSubmit={submit} style={{ marginTop: 16 }}>
              <Field label="Notification type" htmlFor="notificationType">
                <select
                  id="notificationType"
                  value={form.notificationType}
                  onChange={(event) => update('notificationType', event.target.value)}
                >
                  {NOTIFICATION_TYPES.map((type) => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              </Field>
              <Field label="Channel" htmlFor="channel">
                <select
                  id="channel"
                  value={form.channel}
                  onChange={(event) => update('channel', event.target.value)}
                >
                  {CHANNELS.map((channel) => (
                    <option key={channel} value={channel}>{channel}</option>
                  ))}
                </select>
              </Field>
              <Field label="Recipient party ID" htmlFor="recipientPartyId">
                <input
                  id="recipientPartyId"
                  value={form.recipientPartyId}
                  onChange={(event) => update('recipientPartyId', event.target.value)}
                  placeholder="Party UUID"
                  required
                  autoFocus
                />
              </Field>
              <Field label="Subject" htmlFor="subject" className="span-2">
                <input
                  id="subject"
                  value={form.subject}
                  onChange={(event) => update('subject', event.target.value)}
                  maxLength={300}
                  required
                />
              </Field>
              <Field label="Template code" htmlFor="templateCode">
                <input
                  id="templateCode"
                  value={form.templateCode}
                  onChange={(event) => update('templateCode', event.target.value)}
                  placeholder="CLAIM_NOTICE_STANDARD"
                />
              </Field>
              <Field label="Body" htmlFor="body" className="span-3">
                <textarea
                  id="body"
                  value={form.body}
                  onChange={(event) => update('body', event.target.value)}
                  rows={4}
                  required
                />
              </Field>
              <Field label="Scheduled at (optional)" htmlFor="scheduledAt">
                <input
                  id="scheduledAt"
                  type="datetime-local"
                  value={form.scheduledAt}
                  onChange={(event) => update('scheduledAt', event.target.value)}
                />
              </Field>

              <div className="eia-actions span-3" style={{ justifyContent: 'flex-end' }}>
                <button type="button" className="eia-btn-secondary" onClick={closeCreate} disabled={creating}>
                  Cancel
                </button>
                <button type="submit" disabled={creating}>
                  {creating ? 'Creating…' : 'Create notification'}
                </button>
              </div>
            </form>
            {error && <p role="alert" style={{ margin: '8px 0 0' }}>{error}</p>}
          </section>
        </div>
      )}
    </main>
  );
}
