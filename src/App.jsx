import React, { useEffect, useState } from 'react';

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

const EMPTY_FORM = {
  notificationType: 'NEW_CLAIM_NOTICE',
  channel: 'IN_APP',
  recipientPartyId: DEMO_PARTY_ID,
  subject: '',
  body: '',
  templateCode: 'CLAIM_NOTICE_STANDARD',
  scheduledAt: ''
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'X-EIA-Tenant': TENANT,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    let problem = {};
    try {
      problem = await response.json();
    } catch (ignored) {
      // The domain may return an empty error body if it never reached the API.
    }
    const error = new Error(problem.detail || `Request failed with HTTP ${response.status}`);
    error.code = problem.code;
    throw error;
  }
  return response.json();
}

function formatInstant(value) {
  if (!value) {
    return '—';
  }
  return new Date(value).toLocaleString();
}

export default function App() {
  const [notifications, setNotifications] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sendingId, setSendingId] = useState(null);

  async function load() {
    try {
      const data = await api('/api/v1/notifications');
      setNotifications(Array.isArray(data) ? data : []);
      setError(null);
    } catch (requestError) {
      setError(requestError);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setError(null);
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
      await api('/api/v1/notifications', { method: 'POST', body: JSON.stringify(payload) });
      setForm((current) => ({ ...current, subject: '', body: '', scheduledAt: '' }));
      await load();
    } catch (requestError) {
      setError(requestError);
    }
  }

  async function send(id) {
    setError(null);
    setSendingId(id);
    try {
      await api(`/api/v1/notifications/${id}/send`, { method: 'POST' });
      await load();
    } catch (requestError) {
      setError(requestError);
    } finally {
      setSendingId(null);
    }
  }

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <h1>Notifications</h1>
      <p>
        Notifications owns attention: it turns domain events into a message for the right person,
        on the right channel, at the right time. Sending requires an approved template.
      </p>

      {error && (
        <p role="alert" style={{ color: '#b00020' }}>
          {error.code ? `${error.code}: ` : ''}
          {error.message}
        </p>
      )}

      <form onSubmit={submit} style={{ display: 'grid', gap: 10, marginBottom: 28 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 8, alignItems: 'center' }}>
          <label htmlFor="notificationType">Notification type</label>
          <select
            id="notificationType"
            value={form.notificationType}
            onChange={(event) => update('notificationType', event.target.value)}
          >
            {NOTIFICATION_TYPES.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>

          <label htmlFor="channel">Channel</label>
          <select
            id="channel"
            value={form.channel}
            onChange={(event) => update('channel', event.target.value)}
          >
            {CHANNELS.map((channel) => (
              <option key={channel} value={channel}>{channel}</option>
            ))}
          </select>

          <label htmlFor="recipientPartyId">Recipient party ID</label>
          <input
            id="recipientPartyId"
            value={form.recipientPartyId}
            onChange={(event) => update('recipientPartyId', event.target.value)}
            required
          />

          <label htmlFor="subject">Subject</label>
          <input
            id="subject"
            value={form.subject}
            onChange={(event) => update('subject', event.target.value)}
            maxLength={300}
            required
          />

          <label htmlFor="body">Body</label>
          <textarea
            id="body"
            value={form.body}
            onChange={(event) => update('body', event.target.value)}
            rows={3}
            required
          />

          <label htmlFor="templateCode">Template code</label>
          <input
            id="templateCode"
            value={form.templateCode}
            onChange={(event) => update('templateCode', event.target.value)}
            placeholder="CLAIM_NOTICE_STANDARD"
          />

          <label htmlFor="scheduledAt">Scheduled at (optional)</label>
          <input
            id="scheduledAt"
            type="datetime-local"
            value={form.scheduledAt}
            onChange={(event) => update('scheduledAt', event.target.value)}
          />
        </div>
        <div>
          <button type="submit">Create notification</button>
        </div>
      </form>

      <table width="100%" cellPadding="8" style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th align="left">Number</th>
            <th align="left">Type</th>
            <th align="left">Channel</th>
            <th align="left">Status</th>
            <th align="left">Subject</th>
            <th align="left">Scheduled</th>
            <th align="left">Sent</th>
            <th align="left">Action</th>
          </tr>
        </thead>
        <tbody>
          {notifications.map((notification) => (
            <tr key={notification.id} style={{ borderTop: '1px solid #ddd' }}>
              <td>{notification.notificationNumber}</td>
              <td>{notification.notificationType}</td>
              <td>{notification.channel}</td>
              <td>{notification.status}</td>
              <td>{notification.subject}</td>
              <td>{formatInstant(notification.scheduledAt)}</td>
              <td>{formatInstant(notification.sentAt)}</td>
              <td>
                {['CREATED', 'QUEUED'].includes(notification.status) && (
                  <button
                    type="button"
                    onClick={() => send(notification.id)}
                    disabled={sendingId === notification.id}
                  >
                    {sendingId === notification.id ? 'Sending…' : 'Send'}
                  </button>
                )}
              </td>
            </tr>
          ))}
          {!loading && notifications.length === 0 && (
            <tr>
              <td colSpan={8}>No notifications yet.</td>
            </tr>
          )}
        </tbody>
      </table>
    </main>
  );
}
