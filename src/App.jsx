import React, { useEffect, useRef, useState } from 'react';
import './ui.css';
import ActivityTimeline from './ActivityTimeline.jsx';
import EntityPicker from './EntityPicker.jsx';
import { navigate, recordHref } from './navigation.js';
import { partyEndpoint, partyRecordLabel } from './party.js';
import { activityEvents, aggregateEventsEndpoint } from './events.js';

const TENANT = '11111111-1111-7111-8111-111111111111';
const DEMO_PARTY_ID = '0192f3a4-0000-7000-8000-000000000002';
const PARTY_SEARCH_ENDPOINT = '/api/v1/parties/search';
const SEARCH_LIMIT = 10;
const QUEUE_FILTER_PLACEHOLDER = 'Filter notifications by number, subject, recipient, channel, or status…';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NOTIFICATION_TYPES = [
  'NEW_CLAIM_NOTICE',
  'CLAIM_ASSIGNED',
  'DUNNING_NOTICE',
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
  { id: 'template', label: 'Template' },
  { id: 'activity', label: 'Activity' }
];

const EMPTY_ACTIVITY = { recordId: '', items: [], loading: false, error: '' };

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

/**
 * Seeds a create draft from `?new=1` prefill parameters. Only values the form
 * can represent are accepted: an unknown type or channel, and a recipient that
 * is not a UUID, fall back to the form defaults so a stale or hand-written
 * link still opens a valid draft. The prefill is opt-in per create open and is
 * never applied to a record link or an already-edited form.
 */
function readPrefillSeed(params) {
  const form = { ...EMPTY_FORM };
  let recipientPicked = false;

  const notificationType = (params.get('notificationType') || '').trim();
  if (NOTIFICATION_TYPES.includes(notificationType)) form.notificationType = notificationType;

  const channel = (params.get('channel') || '').trim();
  if (CHANNELS.includes(channel)) form.channel = channel;

  const recipientPartyId = (params.get('recipientPartyId') || '').trim();
  if (UUID_PATTERN.test(recipientPartyId)) {
    form.recipientPartyId = recipientPartyId;
    recipientPicked = true;
  }

  const subject = (params.get('subject') || '').trim();
  if (subject) form.subject = subject;

  const body = (params.get('body') || '').trim();
  if (body) form.body = body;

  const templateCode = (params.get('templateCode') || '').trim();
  if (templateCode) form.templateCode = templateCode;
  else if (notificationType === 'DUNNING_NOTICE') form.templateCode = '';

  return { form, recipientPicked };
}

function readUrlState() {
  if (typeof window === 'undefined') return { record: '', create: false, prefill: null };
  const params = new URLSearchParams(window.location.search);
  const create = params.get('new') === '1';
  return {
    record: params.get('record') || '',
    create,
    prefill: create ? readPrefillSeed(params) : null
  };
}

/**
 * The remote is mounted either at the shell route (/notifications) or
 * directly at the dev-server root (/). Only treat the URL as notification
 * state on those routes so a cross-link to /party is not read as a record.
 */
function onNotificationsRoute() {
  if (typeof window === 'undefined') return false;
  const path = window.location.pathname.replace(/\/+$/, '');
  return path === '' || path === '/' || path.endsWith('/notifications');
}

/**
 * Keeps the address bar in step with the selected notification and the
 * create dialog. `notify: false` leaves routing to the shell; the workbench
 * already applied the same state locally.
 */
function writeUrl({ record = '', create = false, replace = false } = {}) {
  if (typeof window === 'undefined' || !onNotificationsRoute()) return;
  const base = recordHref(window.location.pathname || '/', record);
  const target = create ? `${base}${record ? '&' : '?'}new=1` : base;
  if (target === `${window.location.pathname}${window.location.search}`) return;
  navigate(target, { replace, notify: false });
}

function partyLabel(item) {
  return [item?.label, item?.secondary].filter(Boolean).join(' · ');
}

function filterNotifications(notifications, filter) {
  const term = filter.trim().toLowerCase();
  if (!term) return notifications;
  return notifications.filter((notification) =>
    [
      notification.notificationNumber,
      notification.subject,
      notification.recipientPartyId,
      notification.channel,
      humanize(notification.channel),
      notification.status,
      notification.notificationType,
      humanize(notification.notificationType)
    ].some((value) => String(value || '').toLowerCase().includes(term))
  );
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
  const [queueFilter, setQueueFilter] = useState('');
  const [recipientPicked, setRecipientPicked] = useState(false);
  const [recipientLabel, setRecipientLabel] = useState('');
  const [recipientParties, setRecipientParties] = useState({});
  const [activity, setActivity] = useState(EMPTY_ACTIVITY);
  const [activityNonce, setActivityNonce] = useState(0);

  const notificationsRef = useRef([]);
  const createOpenRef = useRef(false);
  const applyingUrlRef = useRef(false);
  const activityRequestRef = useRef(0);

  const selectedRow = notifications.find((notification) => notification.id === selectedId) || null;
  const selected = detail && detail.id === selectedId ? detail : selectedRow;
  const filteredNotifications = filterNotifications(notifications, queueFilter);
  // Never show one notification's events under another notification's header
  // while a selection change is still in flight.
  const activityView = !selected
    ? EMPTY_ACTIVITY
    : activity.recordId === selected.id
      ? activity
      : { recordId: selected.id, items: [], loading: true, error: '' };

  function recipientLabelFor(notification) {
    if (!notification?.recipientPartyId) return '';
    return recipientParties[notification.recipientPartyId]
      || (notification.recipientPartyId === form.recipientPartyId ? recipientLabel : '');
  }

  async function load(preferredId) {
    const data = await api('/api/v1/notifications');
    const rows = Array.isArray(data) ? data : [];
    notificationsRef.current = rows;
    setNotifications(rows);
    setSelectedId((current) => {
      if (preferredId && rows.some((notification) => notification.id === preferredId)) return preferredId;
      if (current && rows.some((notification) => notification.id === current)) return current;

      const { record } = readUrlState();
      if (record && onNotificationsRoute()) {
        const match = rows.find(
          (notification) => notification.id === record || notification.notificationNumber === record
        );
        if (match) return match.id;
        if (UUID_PATTERN.test(record)) return record;
        return current;
      }

      return rows[0]?.id || null;
    });
    return rows;
  }

  function rememberNotification(notification) {
    if (!notification?.id) return;
    const merge = (rows) => {
      if (rows.some((row) => row.id === notification.id)) {
        return rows.map((row) => (row.id === notification.id ? { ...row, ...notification } : row));
      }
      return [notification, ...rows];
    };
    notificationsRef.current = merge(notificationsRef.current);
    setNotifications((current) => merge(current));
  }

  /**
   * Record discovery for a `?record=` deep link that is not in the loaded
   * queue. The notifications search projection resolves a notification
   * number, then the component selects the returned record id.
   */
  async function discoverNotificationId(record) {
    const body = await api(
      `/api/v1/notifications/search?q=${encodeURIComponent(record)}&limit=${SEARCH_LIMIT}`
    );
    const items = Array.isArray(body) ? body : Array.isArray(body?.items) ? body.items : [];
    const match = items.find(
      (item) => item.id === record
        || item.label === record
        || String(item.href || '').endsWith(`record=${record}`)
    ) || items[0];
    return match?.id || null;
  }

  /**
   * Seeds the create draft from URL prefill values, or resets it to the form
   * defaults when there is no prefill. Only called when a create dialog is
   * being opened, never while the user is editing one.
   */
  function seedCreateForm(seed) {
    setForm(seed?.form ? { ...seed.form } : { ...EMPTY_FORM });
    setRecipientPicked(Boolean(seed?.recipientPicked));
    setRecipientLabel('');
  }

  /**
   * Applies ?record= and ?new=1. Links from global search open a record by id;
   * a notification number is resolved through the search projection so a
   * deep link does not silently fall back to the first queue row.
   */
  async function applyUrlState(rows, { initial = false } = {}) {
    if (!onNotificationsRoute()) return;
    const { record, create, prefill } = readUrlState();

    if (create) {
      // The initial mount already seeded and opened the dialog from the URL.
      // Later re-applications only seed a closed dialog, so a popstate never
      // overwrites a draft the user has already edited.
      if (!initial && !createOpenRef.current) seedCreateForm(prefill);
      setCreateOpen(true);
      setError('');
      return;
    }

    if (!record) {
      if (!initial) {
        setCreateOpen(false);
        setError('');
      }
      return;
    }

    setCreateOpen(false);
    if (applyingUrlRef.current) return;

    const queue = Array.isArray(rows) && rows.length > 0 ? rows : notificationsRef.current;
    const known = queue.find(
      (notification) => notification.id === record || notification.notificationNumber === record
    );
    if (known) {
      setSelectedId(known.id);
      setActiveTab('overview');
      setError('');
      return;
    }

    applyingUrlRef.current = true;
    try {
      let notificationId = UUID_PATTERN.test(record) ? record : null;
      if (!notificationId) notificationId = await discoverNotificationId(record);
      if (notificationId) {
        setSelectedId(notificationId);
        setActiveTab('overview');
        setError('');
      } else {
        setError(`Notification “${record}” was not found in the notification queue.`);
        setSelectedId((current) => current || notificationsRef.current[0]?.id || null);
      }
    } catch (cause) {
      setError(`Notification ${record} could not be loaded: ${errorText(cause)}`);
      setSelectedId((current) => current || notificationsRef.current[0]?.id || null);
    } finally {
      applyingUrlRef.current = false;
    }
  }

  useEffect(() => {
    notificationsRef.current = notifications;
  }, [notifications]);

  useEffect(() => {
    createOpenRef.current = createOpen;
  }, [createOpen]);

  useEffect(() => {
    let alive = true;
    const onPopState = () => {
      applyUrlState(notificationsRef.current);
    };
    window.addEventListener('popstate', onPopState);

    if (onNotificationsRoute()) {
      const { create, prefill } = readUrlState();
      if (create) {
        seedCreateForm(prefill);
        setCreateOpen(true);
      }
    }

    load()
      .then((rows) => {
        if (!alive) return;
        setLoading(false);
        applyUrlState(rows, { initial: true });
      })
      .catch((cause) => {
        if (!alive) return;
        setLoading(false);
        setError(errorText(cause));
      });

    return () => {
      alive = false;
      window.removeEventListener('popstate', onPopState);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    if (!selectedId) {
      setDetail(null);
      return undefined;
    }
    api(`/api/v1/notifications/${selectedId}`)
      .then((notification) => {
        if (alive) {
          setDetail(notification);
          rememberNotification(notification);
        }
      })
      .catch((cause) => {
        if (alive) setError(errorText(cause));
      });
    return () => {
      alive = false;
    };
  }, [selectedId, detailNonce]);

  /**
   * Activity is derived from the platform event stream, keyed by the
   * notification id that owns the aggregate. It loads as soon as a record is
   * selected and stays card-local: a slow or unavailable event service never
   * blocks the notification record or changes its state.
   */
  useEffect(() => {
    const recordId = selectedId || '';
    const requestId = activityRequestRef.current + 1;
    activityRequestRef.current = requestId;

    if (!recordId) {
      setActivity(EMPTY_ACTIVITY);
      return undefined;
    }

    let alive = true;
    setActivity({ recordId, items: [], loading: true, error: '' });

    api(aggregateEventsEndpoint(recordId))
      .then((body) => {
        if (!alive || activityRequestRef.current !== requestId) return;
        setActivity({
          recordId,
          items: activityEvents(body),
          loading: false,
          error: ''
        });
      })
      .catch(() => {
        if (!alive || activityRequestRef.current !== requestId) return;
        setActivity({
          recordId,
          items: [],
          loading: false,
          error: 'Activity timeline is temporarily unavailable.'
        });
      });

    return () => {
      alive = false;
    };
  }, [selectedId, activityNonce]);

  const selectedRecipientPartyId = selected?.recipientPartyId || '';

  /**
   * Resolves the recipient through the Party API after the notification is
   * already on screen. A 404 or an unavailable Party service never blocks
   * rendering: the cross-links fall back to the short UUID.
   */
  useEffect(() => {
    if (!selectedRecipientPartyId) return undefined;
    let alive = true;
    api(partyEndpoint(selectedRecipientPartyId))
      .then((party) => {
        if (!alive) return;
        const label = partyRecordLabel(party);
        if (!label) return;
        setRecipientParties((current) => (
          current[selectedRecipientPartyId] === label
            ? current
            : { ...current, [selectedRecipientPartyId]: label }
        ));
      })
      .catch(() => {
        // Party lookup is an enhancement; the notification still renders.
      });
    return () => {
      alive = false;
    };
  }, [selectedRecipientPartyId]);

  useEffect(() => {
    if (!createOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !creating) {
        setCreateOpen(false);
        setError('');
        writeUrl({ record: selectedId || '' });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [createOpen, creating, selectedId]);

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function openParty(partyId) {
    if (!partyId) return;
    navigate(recordHref('party', partyId));
  }

  function selectNotification(notification) {
    if (notification.id !== selectedId) setActiveTab('overview');
    setSelectedId(notification.id);
    setError('');
    setNotice('');
    writeUrl({ record: notification.id });
  }

  async function refresh() {
    setError('');
    setNotice('');
    try {
      await load(selectedId);
      if (selectedId) {
        setDetailNonce((value) => value + 1);
        setActivityNonce((value) => value + 1);
      }
    } catch (cause) {
      setError(errorText(cause));
    }
  }

  function openCreate() {
    seedCreateForm(null);
    setError('');
    setNotice('');
    setCreateOpen(true);
    writeUrl({ record: selectedId || '', create: true });
  }

  function closeCreate() {
    if (creating) return;
    setCreateOpen(false);
    setError('');
    writeUrl({ record: selectedId || '' });
  }

  async function submit(event) {
    event.preventDefault();
    setError('');
    setNotice('');
    if (!form.recipientPartyId) {
      setError('Select a recipient party before creating the notification.');
      return;
    }
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
        rememberNotification(created);
        setActiveTab('overview');
        writeUrl({ record: created.id });
      } else {
        writeUrl({ record: selectedId || '' });
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
      setActivityNonce((value) => value + 1);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setSending(false);
    }
  }

  function renderTab(notification) {
    const recipientId = notification.recipientPartyId;
    const recipientText = recipientId
      ? recipientLabelFor(notification) || shortId(recipientId)
      : '—';

    if (activeTab === 'activity') {
      return (
        <section
          id="panel-activity"
          role="tabpanel"
          aria-labelledby="tab-activity"
        >
          <div className="eia-section-title">
            <h2>Activity</h2>
            <span className="eia-muted">Newest first · derived from platform events</span>
          </div>
          <ActivityTimeline
            items={activityView.items}
            loading={activityView.loading}
            error={activityView.error}
            onRefresh={() => setActivityNonce((value) => value + 1)}
          />
        </section>
      );
    }

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
                  <td className="eia-mono">
                    {recipientId ? (
                      <a
                        href={recordHref('party', recipientId)}
                        onClick={(event) => {
                          event.preventDefault();
                          openParty(recipientId);
                        }}
                      >
                        {recipientText}
                      </a>
                    ) : '—'}
                  </td>
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
              <dd className="eia-mono">
                {recipientId ? (
                  <a
                    href={recordHref('party', recipientId)}
                    onClick={(event) => {
                      event.preventDefault();
                      openParty(recipientId);
                    }}
                    data-testid="overview-recipient-link"
                  >
                    {recipientText}
                  </a>
                ) : '—'}
              </dd>
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

        <section
          className="eia-context-panel"
          aria-label="Why this matters"
          data-testid="why-this-matters"
        >
          <h4>Why this matters</h4>
          <p>
            A notification is a delivery artifact, not a business fact. The approved template,
            channel, and status govern delivery — how and when the message is sent — and the
            notification never changes the source record that triggered it. The source business
            record is not exposed in this API slice, so this workbench cannot link to it or invent a
            link.
          </p>
          {recipientId && (
            <div className="links">
              <a
                href={recordHref('party', recipientId)}
                onClick={(event) => {
                  event.preventDefault();
                  openParty(recipientId);
                }}
                data-testid="context-recipient-link"
              >
                Recipient party record · {recipientText}
              </a>
            </div>
          )}
        </section>

        <section
          className="eia-card"
          aria-label="Related records"
          data-testid="related-records"
          style={{ marginTop: 14 }}
        >
          <h3>Related records</h3>
          <p className="eia-muted" style={{ marginTop: 4 }}>
            The only related record this API slice exposes is the recipient party. The source
            business record — the claim, policy, or payment that caused the notification — is not
            exposed, so it is deliberately absent instead of being guessed.
          </p>
          {recipientId ? (
            <div className="eia-related-list">
              <a
                className="eia-related-record"
                href={recordHref('party', recipientId)}
                onClick={(event) => {
                  event.preventDefault();
                  openParty(recipientId);
                }}
                data-testid="related-recipient-party-link"
              >
                Recipient · <b>{recipientText}</b>
              </a>
            </div>
          ) : (
            <div className="eia-empty" data-testid="related-records-empty" style={{ marginTop: 10 }}>
              No related records are available for this notification.
            </div>
          )}
        </section>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
          <div
            className="eia-queue-search"
            role="search"
            aria-label="Filter the notification queue"
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <div className="eia-search-box" style={{ height: 38, flex: 1 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
                <path d="m20 20-3.4-3.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <input
                type="search"
                value={queueFilter}
                onChange={(event) => setQueueFilter(event.target.value)}
                placeholder={QUEUE_FILTER_PLACEHOLDER}
                aria-label="Filter notifications by number, subject, recipient, channel, or status"
                autoComplete="off"
                data-testid="notification-filter"
              />
            </div>
            {queueFilter && (
              <button type="button" className="eia-btn-ghost" onClick={() => setQueueFilter('')}>
                Clear
              </button>
            )}
          </div>

          <aside className="eia-record-list" aria-label="Notification queue">
            <div className="eia-record-list-head">
              <strong>Notification queue</strong>
              <span className="eia-muted" data-testid="queue-filter-count">
                {loading
                  ? '…'
                  : queueFilter
                    ? `${filteredNotifications.length} of ${notifications.length} notifications`
                    : notifications.length}
              </span>
            </div>
            {loading && <div className="empty">Loading notifications…</div>}
            {!loading && notifications.length === 0 && (
              <div className="empty">No notifications yet. Use Create notification to open the first record.</div>
            )}
            {!loading && notifications.length > 0 && filteredNotifications.length === 0 && (
              <div className="empty" data-testid="queue-filter-empty">
                No notifications match “{queueFilter.trim()}”. Clear the filter to see the full queue.
              </div>
            )}
            {filteredNotifications.map((notification) => {
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
                    To {recipientLabelFor(notification) || shortId(notification.recipientPartyId)}
                    {' · '}
                    {notification.channel}
                  </span>
                  <span>
                    <span className={`eia-pill ${statusTone(notification.status)}`}>
                      {notification.status}
                    </span>
                  </span>
                </button>
              );
            })}
          </aside>
        </div>

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
                    {' · '}Recipient{' '}
                    {selected.recipientPartyId ? (
                      <a
                        href={recordHref('party', selected.recipientPartyId)}
                        onClick={(event) => {
                          event.preventDefault();
                          openParty(selected.recipientPartyId);
                        }}
                        data-testid="record-recipient-link"
                      >
                        {recipientLabelFor(selected) || shortId(selected.recipientPartyId)}
                      </a>
                    ) : '—'}
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
              <div className="eia-field span-3">
                <label>Recipient party</label>
                <EntityPicker
                  endpoint={PARTY_SEARCH_ENDPOINT}
                  value={recipientPicked ? form.recipientPartyId : ''}
                  valueLabel={recipientPicked ? recipientLabel : ''}
                  onChange={(id, item) => {
                    setForm((current) => ({ ...current, recipientPartyId: id || '' }));
                    setRecipientPicked(Boolean(id));
                    setRecipientLabel(item ? partyLabel(item) : '');
                  }}
                />
                <span className="eia-muted" style={{ fontSize: 10 }}>
                  {recipientPicked
                    ? 'Selected recipient party.'
                    : 'The seeded demo recipient is used until a party is selected here.'}
                </span>
              </div>
              {form.recipientPartyId && (
                <section
                  className="eia-card span-3"
                  aria-label="Selected recipient party"
                >
                  <h3>Recipient party</h3>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 10,
                      flexWrap: 'wrap'
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <a
                        href={recordHref('party', form.recipientPartyId)}
                        onClick={(event) => {
                          event.preventDefault();
                          openParty(form.recipientPartyId);
                        }}
                      >
                        <b data-testid="recipient-party-label">
                          {recipientPicked
                            ? recipientLabel || shortId(form.recipientPartyId)
                            : `Demo recipient ${shortId(DEMO_PARTY_ID)}`}
                        </b>
                      </a>
                      <div className="eia-mono">{form.recipientPartyId}</div>
                    </div>
                    <a
                      href={recordHref('party', form.recipientPartyId)}
                      onClick={(event) => {
                        event.preventDefault();
                        openParty(form.recipientPartyId);
                      }}
                      data-testid="recipient-party-link"
                    >
                      Open party record
                    </a>
                  </div>
                </section>
              )}
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
