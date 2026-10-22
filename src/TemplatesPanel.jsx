import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, errorText } from './api.js';

const TEMPLATES_ENDPOINT = '/api/v1/notifications/templates';
const TEMPLATE_CHANNELS = ['IN_APP', 'EMAIL', 'SMS', 'PUSH', 'WEBHOOK', 'TASK', 'DIGEST'];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCALE_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
const FILTER_PLACEHOLDER = 'Filter templates by code, version, locale, channel, status, or approval…';
const VERSION_HISTORY_LIMIT = 5;

const EMPTY_FORM = {
  code: '',
  version: '1',
  locale: 'en-US',
  channel: '',
  body: ''
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
  width: 'min(720px, 100%)',
  maxHeight: '90vh',
  overflow: 'auto',
  boxShadow: '0 24px 70px rgba(11, 46, 79, 0.28)'
};

function templateRows(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.items)) return body.items;
  if (Array.isArray(body?.templates)) return body.templates;
  if (Array.isArray(body?.content)) return body.content;
  if (Array.isArray(body?.data)) return body.data;
  return [];
}

/**
 * A create/approve/retire response is normally the template itself, but a
 * domain wrapper is accepted so the table can update before the list reload.
 */
function unwrapTemplate(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  if (body.template && typeof body.template === 'object') return body.template;
  if (body.id || body.templateCode || body.code) return body;
  return null;
}

function codeOf(template) {
  return template?.templateCode || template?.code || '';
}

function versionOf(template) {
  const version = template?.templateVersion ?? template?.version;
  return version === 0 || version ? String(version) : '—';
}

function numericVersionOf(template) {
  const raw = template?.templateVersion ?? template?.version;
  if (raw === null || raw === undefined || String(raw).trim() === '') return null;
  const version = Number(raw);
  return Number.isInteger(version) && version >= 1 ? version : null;
}

function nextVersionOf(template) {
  const version = numericVersionOf(template);
  return String(version === null ? 1 : version + 1);
}

function bodyOf(template) {
  if (template?.bodyTemplate !== undefined && template.bodyTemplate !== null) {
    return String(template.bodyTemplate);
  }
  return template?.body ? String(template.body) : '';
}

/**
 * Seeds the create form from an existing row. The new template keeps the same
 * code, locale, channel, and body, but always targets the next whole version so
 * the creation stays a new revision of the same template rather than an edit.
 */
function draftFromTemplate(template) {
  return {
    code: codeOf(template),
    version: nextVersionOf(template),
    locale: template.locale || EMPTY_FORM.locale,
    channel: template.channel || '',
    body: bodyOf(template)
  };
}

function versionHistoryFor(templates, source) {
  const code = String(codeOf(source) || '').trim();
  if (!code) return [];
  return templates
    .filter((template) => String(codeOf(template) || '').trim() === code)
    .map((template) => ({ template, version: numericVersionOf(template) }))
    .sort((left, right) => {
      if (left.version === null && right.version === null) return 0;
      if (left.version === null) return 1;
      if (right.version === null) return -1;
      if (right.version !== left.version) return right.version - left.version;
      return String(left.template.locale || '').localeCompare(String(right.template.locale || ''));
    });
}

/**
 * The dialog keeps the history short: newest first, with the version being
 * copied from always present even when it falls outside the newest rows.
 */
function shortVersionHistory(templates, source) {
  const all = versionHistoryFor(templates, source);
  if (all.length <= VERSION_HISTORY_LIMIT) {
    return { rows: all, total: all.length, trimmed: false, sourceAppended: false };
  }
  const sourceId = source?.id;
  const sourceEntry = all.find((entry) => (
    sourceId ? entry.template.id === sourceId : entry.template === source
  ));
  const rows = all.slice(0, VERSION_HISTORY_LIMIT);
  const sourceAppended = Boolean(sourceEntry) && !rows.some((entry) => entry === sourceEntry);
  if (sourceAppended) rows.push(sourceEntry);
  return { rows, total: all.length, trimmed: true, sourceAppended };
}

function statusOf(template) {
  return String(template?.status || 'DRAFT').toUpperCase();
}

function isApproved(template) {
  return template?.approved === true || Boolean(template?.approvedBy) || Boolean(template?.approvedAt);
}

function statusTone(status) {
  if (status === 'ACTIVE') return 'green';
  if (status === 'RETIRED') return 'gray';
  if (status === 'DRAFT') return 'blue';
  return 'amber';
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

function labelOf(template) {
  const code = codeOf(template) || 'template';
  const version = versionOf(template);
  return version === '—' ? code : `${code} v${version}`;
}

function filterTemplates(templates, filter) {
  const term = filter.trim().toLowerCase();
  if (!term) return templates;
  return templates.filter((template) => {
    const status = statusOf(template);
    return [
      codeOf(template),
      versionOf(template),
      template.locale,
      template.channel,
      humanize(status),
      status,
      isApproved(template) ? 'approved yes' : 'not approved no',
      template.approvedBy,
      template.body,
      template.bodyTemplate
    ].some((value) => String(value || '').toLowerCase().includes(term));
  });
}

function validateTemplateForm(form) {
  const messages = [];
  const code = form.code.trim();
  if (!code) messages.push('Code is required.');
  else if (code.length > 64) messages.push('Code must be 64 characters or fewer.');

  const version = Number(form.version);
  if (!String(form.version).trim() || !Number.isInteger(version) || version < 1) {
    messages.push('Version must be a whole number of 1 or more.');
  }

  const locale = form.locale.trim();
  if (!locale) messages.push('Locale is required.');
  else if (locale.length > 35 || !LOCALE_PATTERN.test(locale)) {
    messages.push('Locale must be a BCP 47 tag such as en-US.');
  }

  if (!form.body.trim()) messages.push('Body is required.');

  return messages;
}

function Field({ label, htmlFor, className = '', children }) {
  return (
    <div className={`eia-field ${className}`.trim()}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
    </div>
  );
}

/**
 * Template registry and approval gate.
 *
 * A template is created as DRAFT. Approval records the approver UUID and
 * activates it; retirement is allowed for DRAFT and ACTIVE rows. Every action
 * reloads the registry so a 409 caused by a concurrent transition is resolved
 * from the server's actual state rather than a stale row.
 */
export default function TemplatesPanel() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [filter, setFilter] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [newVersionSource, setNewVersionSource] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [approveTarget, setApproveTarget] = useState(null);
  const [approverId, setApproverId] = useState('');
  const [approving, setApproving] = useState(false);
  const [retiringId, setRetiringId] = useState('');
  const aliveRef = useRef(true);

  const filteredTemplates = useMemo(() => filterTemplates(templates, filter), [templates, filter]);
  const versionHistory = useMemo(
    () => (
      newVersionSource
        ? shortVersionHistory(templates, newVersionSource)
        : { rows: [], total: 0, trimmed: false, sourceAppended: false }
    ),
    [templates, newVersionSource]
  );

  useEffect(() => {
    aliveRef.current = true;
    setLoading(true);
    api(TEMPLATES_ENDPOINT)
      .then((body) => {
        if (!aliveRef.current) return;
        setTemplates(templateRows(body));
      })
      .catch((cause) => {
        if (!aliveRef.current) return;
        setError(errorText(cause));
      })
      .finally(() => {
        if (aliveRef.current) setLoading(false);
      });
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!createOpen && !approveTarget) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      if (creating || approving) return;
      setCreateOpen(false);
      setNewVersionSource(null);
      setApproveTarget(null);
      setApproverId('');
      setError('');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [createOpen, approveTarget, creating, approving]);

  /**
   * Reloads the registry without discarding the error an action just set. That
   * keeps a 409 visible while the table catches up to the winning transition.
   */
  async function reloadTemplates() {
    try {
      const body = await api(TEMPLATES_ENDPOINT);
      if (aliveRef.current) setTemplates(templateRows(body));
      return true;
    } catch (cause) {
      if (aliveRef.current) {
        setError((current) => current || `Templates could not be reloaded. ${errorText(cause)}`);
      }
      return false;
    }
  }

  function mergeTemplate(template) {
    if (!template?.id) return;
    setTemplates((rows) => {
      if (rows.some((row) => row.id === template.id)) {
        return rows.map((row) => (row.id === template.id ? { ...row, ...template } : row));
      }
      return [template, ...rows];
    });
  }

  async function refresh() {
    setError('');
    setNotice('');
    setLoading(true);
    await reloadTemplates();
    setLoading(false);
  }

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function openCreate() {
    setForm({ ...EMPTY_FORM });
    setNewVersionSource(null);
    setError('');
    setNotice('');
    setCreateOpen(true);
  }

  /**
   * Opens the same create dialog in new-version mode. The source row stays in
   * state so the dialog can explain what it is based on and show the compact
   * same-code history; the form itself is fully editable.
   */
  function openNewVersion(template) {
    setForm(draftFromTemplate(template));
    setNewVersionSource(template);
    setError('');
    setNotice('');
    setCreateOpen(true);
  }

  function closeCreate() {
    if (creating) return;
    setCreateOpen(false);
    setNewVersionSource(null);
    setError('');
  }

  async function createTemplate(event) {
    event.preventDefault();
    setError('');
    setNotice('');
    const messages = validateTemplateForm(form);
    if (messages.length > 0) {
      setError(messages.join(' '));
      return;
    }

    const code = form.code.trim();
    const version = Number(form.version);
    const basedOn = newVersionSource;
    setCreating(true);
    try {
      const body = await api(TEMPLATES_ENDPOINT, {
        method: 'POST',
        body: JSON.stringify({
          templateCode: code,
          templateVersion: version,
          locale: form.locale.trim(),
          channel: form.channel || null,
          bodyTemplate: form.body.trim()
        })
      });
      const created = unwrapTemplate(body);
      if (created) mergeTemplate(created);
      setCreateOpen(false);
      setNewVersionSource(null);
      setForm({ ...EMPTY_FORM });
      setNotice(
        basedOn
          ? `Template ${code} v${version} created as DRAFT based on v${versionOf(basedOn)}.`
          : `Template ${code} v${version} created as DRAFT.`
      );
    } catch (cause) {
      // Validation and duplicate (409) responses stay in the dialog so the
      // user can correct the draft without losing the prefilled fields.
      setError(errorText(cause));
    } finally {
      setCreating(false);
      await reloadTemplates();
    }
  }

  function openApprove(template) {
    if (statusOf(template) !== 'DRAFT') return;
    setError('');
    setNotice('');
    setApproverId('');
    setApproveTarget(template);
  }

  function closeApprove() {
    if (approving) return;
    setApproveTarget(null);
    setApproverId('');
    setError('');
  }

  async function submitApproval(event) {
    event.preventDefault();
    if (!approveTarget) return;
    setError('');
    setNotice('');

    const approver = approverId.trim();
    if (!approver) {
      setError('Approver UUID is required.');
      return;
    }
    if (!UUID_PATTERN.test(approver)) {
      setError('Approver must be a valid UUID.');
      return;
    }

    setApproving(true);
    try {
      const body = await api(
        `${TEMPLATES_ENDPOINT}/${encodeURIComponent(approveTarget.id)}/approve`,
        { method: 'POST', body: JSON.stringify({ approvedBy: approver }) }
      );
      const approved = unwrapTemplate(body);
      if (approved) mergeTemplate(approved);
      setNotice(`Template ${labelOf(approveTarget)} approved.`);
      setApproveTarget(null);
      setApproverId('');
    } catch (cause) {
      setError(errorText(cause));
      // A conflict means another user already moved the template on. Close the
      // dialog and let the reload below show the winning state.
      if (cause?.status === 409) {
        setApproveTarget(null);
        setApproverId('');
      }
    } finally {
      setApproving(false);
      await reloadTemplates();
    }
  }

  async function retire(template) {
    const status = statusOf(template);
    if (status !== 'DRAFT' && status !== 'ACTIVE') return;
    setError('');
    setNotice('');
    setRetiringId(template.id);
    try {
      const body = await api(
        `${TEMPLATES_ENDPOINT}/${encodeURIComponent(template.id)}/retire`,
        { method: 'POST' }
      );
      const retired = unwrapTemplate(body);
      if (retired) mergeTemplate(retired);
      setNotice(`Template ${labelOf(template)} retired.`);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setRetiringId('');
      await reloadTemplates();
    }
  }

  return (
    <section aria-label="Notification templates" data-testid="templates-section">
      <div className="eia-section-title">
        <h2 style={{ margin: 0 }}>Template registry</h2>
        <span className="eia-muted">ACTIVE + approved sends only</span>
      </div>

      <section
        className="eia-context-panel"
        aria-label="Template approval gate"
        data-testid="template-approval-gate"
        style={{ marginTop: 0 }}
      >
        <h4>Approval gate</h4>
        <p>
          <b>Only ACTIVE approved templates can send notifications.</b> A new template starts as
          DRAFT. Approval records the approver UUID and activates it; RETIRED templates stay in the
          registry for audit but can no longer send. The send path re-checks the template on every
          send (NTF-01, NTF-14).
        </p>
      </section>

      <div className="eia-toolbar" style={{ marginTop: 14 }}>
        <div className="eia-search-box" style={{ height: 38, flex: '1 1 320px' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
            <path d="m20 20-3.4-3.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={FILTER_PLACEHOLDER}
            aria-label="Filter templates by code, version, locale, channel, status, or approval"
            autoComplete="off"
            data-testid="template-filter"
          />
        </div>
        {filter && (
          <button type="button" className="eia-btn-ghost" onClick={() => setFilter('')}>
            Clear
          </button>
        )}
        <span className="eia-muted" data-testid="template-filter-count">
          {loading
            ? '…'
            : filter
              ? `${filteredTemplates.length} of ${templates.length} templates`
              : `${templates.length} templates`}
        </span>
        <div className="eia-actions" style={{ marginLeft: 'auto' }}>
          <button type="button" className="eia-btn-ghost" onClick={refresh} disabled={loading || creating}>
            Refresh
          </button>
          <button type="button" onClick={openCreate} aria-haspopup="dialog">
            Create template
          </button>
        </div>
      </div>

      {notice && <p role="status" style={{ margin: '0 0 12px' }}>{notice}</p>}
      {error && !createOpen && !approveTarget && (
        <p role="alert" style={{ margin: '0 0 12px' }}>{error}</p>
      )}

      {loading ? (
        <div className="eia-empty">Loading templates…</div>
      ) : templates.length === 0 ? (
        <div className="eia-empty">
          No templates yet. Use Create template to add the first DRAFT.
        </div>
      ) : filteredTemplates.length === 0 ? (
        <div className="eia-empty" data-testid="template-filter-empty">
          No templates match “{filter.trim()}”. Clear the filter to see the full registry.
        </div>
      ) : (
        <div className="eia-table-wrap">
          <table className="eia-table" data-testid="templates-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Version</th>
                <th>Locale</th>
                <th>Channel</th>
                <th>Status</th>
                <th>Approved</th>
                <th>Updated</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredTemplates.map((template) => {
                const status = statusOf(template);
                const approved = isApproved(template);
                const canApprove = status === 'DRAFT';
                const canRetire = status === 'DRAFT' || status === 'ACTIVE';
                const rowKey = template.id || `${codeOf(template)}-${versionOf(template)}-${template.locale}`;
                return (
                  <tr key={rowKey} data-testid={`template-row-${template.id || rowKey}`}>
                    <td className="eia-mono">{codeOf(template) || '—'}</td>
                    <td>{versionOf(template)}</td>
                    <td>{template.locale || '—'}</td>
                    <td>
                      {template.channel || <span className="eia-muted" title="Applies to any channel">Any channel</span>}
                    </td>
                    <td>
                      <span
                        className={`eia-pill ${statusTone(status)}`}
                        data-testid={`template-status-${template.id || rowKey}`}
                      >
                        {status}
                      </span>
                    </td>
                    <td>
                      {approved ? (
                        <>
                          <span
                            className="eia-pill green"
                            data-testid={`template-approved-${template.id || rowKey}`}
                          >
                            Approved
                          </span>
                          <div className="eia-mono" style={{ marginTop: 2 }}>
                            {template.approvedBy ? (
                              <span title={template.approvedBy}>{shortId(template.approvedBy)}</span>
                            ) : 'Recorded'}
                            {template.approvedAt ? ` · ${formatInstant(template.approvedAt)}` : ''}
                          </div>
                        </>
                      ) : (
                        <span
                          className="eia-pill amber"
                          data-testid={`template-approved-${template.id || rowKey}`}
                        >
                          Not approved
                        </span>
                      )}
                    </td>
                    <td>{formatInstant(template.updatedAt || template.updated_at)}</td>
                    <td>
                      <div className="eia-template-actions">
                        <button
                          type="button"
                          className="eia-btn-ghost"
                          aria-label={`New version of ${labelOf(template)}`}
                          onClick={() => openNewVersion(template)}
                          disabled={creating || approving || retiringId === template.id}
                        >
                          New version
                        </button>
                        {canApprove && (
                          <button
                            type="button"
                            className="eia-btn-ghost"
                            aria-label={`Approve ${labelOf(template)}`}
                            onClick={() => openApprove(template)}
                            disabled={approving || retiringId === template.id}
                          >
                            Approve
                          </button>
                        )}
                        {canRetire && (
                          <button
                            type="button"
                            className="eia-btn-danger"
                            aria-label={`Retire ${labelOf(template)}`}
                            onClick={() => retire(template)}
                            disabled={approving || retiringId === template.id}
                          >
                            {retiringId === template.id ? 'Retiring…' : 'Retire'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

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
            aria-labelledby="create-template-title"
            className="eia-card"
            style={DIALOG_STYLE}
            data-testid="create-template-dialog"
          >
            <div className="eia-record-title">
              <div>
                <h2 id="create-template-title" style={{ margin: 0 }}>
                  {newVersionSource
                    ? `New version of ${codeOf(newVersionSource) || 'template'}`
                    : 'Create template'}
                </h2>
                <p className="eia-record-subtitle">
                  {newVersionSource
                    ? `Starts a new DRAFT from v${versionOf(newVersionSource)}. Every field is prefilled and editable; it cannot send until it is approved.`
                    : 'Creates a DRAFT template. It cannot send a notification until it is approved.'}
                </p>
              </div>
              <button type="button" className="eia-btn-ghost" onClick={closeCreate} disabled={creating}>
                Close
              </button>
            </div>

            {newVersionSource && (
              <section
                className="eia-context-panel eia-version-context"
                aria-label="New template version context"
                data-testid="template-version-context"
                style={{ marginTop: 14 }}
              >
                <div className="eia-version-context-head">
                  <h4>Based on v{versionOf(newVersionSource)}</h4>
                  <span className="eia-pill blue">
                    Will create v{nextVersionOf(newVersionSource)} DRAFT
                  </span>
                </div>
                <p>
                  Code, locale, channel, and body are copied from{' '}
                  <b>{labelOf(newVersionSource)}</b>. Adjust them before creating; the new row
                  starts as DRAFT and needs approval before it can send.
                </p>
                <div className="eia-version-history-head">
                  <span>Version history</span>
                  <span className="eia-muted">{codeOf(newVersionSource) || 'template'}</span>
                </div>
                {versionHistory.rows.length === 0 ? (
                  <p className="eia-muted" data-testid="template-version-history-empty">
                    No versions found.
                  </p>
                ) : (
                  <ol
                    className="eia-version-history"
                    data-testid="template-version-history"
                    aria-label={`Version history for ${codeOf(newVersionSource) || 'this template'}`}
                  >
                    {versionHistory.rows.map(({ template: rowTemplate, version }) => {
                      const isSource = newVersionSource?.id
                        ? rowTemplate.id === newVersionSource.id
                        : rowTemplate === newVersionSource;
                      const rowKey = rowTemplate.id
                        || `${codeOf(rowTemplate)}-${version}-${rowTemplate.locale}`;
                      return (
                        <li
                          key={rowKey}
                          className={isSource ? 'current' : ''}
                          data-version={version === null ? undefined : version}
                        >
                          <span className="eia-version-number">
                            v{version === null ? '—' : version}
                          </span>
                          <span className="eia-version-meta">
                            {rowTemplate.locale || '—'}
                            {' · '}
                            {rowTemplate.channel || 'Any channel'}
                          </span>
                          <span className={`eia-pill ${statusTone(statusOf(rowTemplate))}`}>
                            {statusOf(rowTemplate)}
                          </span>
                          {isSource && <span className="eia-version-source">source</span>}
                        </li>
                      );
                    })}
                  </ol>
                )}
                {versionHistory.trimmed && (
                  <p
                    className="eia-muted eia-version-history-note"
                    data-testid="template-version-history-note"
                  >
                    Showing the newest {VERSION_HISTORY_LIMIT} of {versionHistory.total} versions
                    {versionHistory.sourceAppended ? ', plus the version this draft is based on' : ''}.
                  </p>
                )}
              </section>
            )}

            <form className="eia-form-grid" onSubmit={createTemplate} noValidate style={{ marginTop: 16 }}>
              <Field label="Code" htmlFor="templateCode">
                <input
                  id="templateCode"
                  value={form.code}
                  onChange={(event) => update('code', event.target.value)}
                  placeholder="CLAIM_NOTICE_STANDARD"
                  maxLength={64}
                  autoComplete="off"
                  autoFocus
                />
              </Field>
              <Field label="Version" htmlFor="templateVersion">
                <input
                  id="templateVersion"
                  type="number"
                  min="1"
                  step="1"
                  value={form.version}
                  onChange={(event) => update('version', event.target.value)}
                />
              </Field>
              <Field label="Locale" htmlFor="templateLocale">
                <input
                  id="templateLocale"
                  value={form.locale}
                  onChange={(event) => update('locale', event.target.value)}
                  placeholder="en-US"
                  maxLength={35}
                  autoComplete="off"
                />
              </Field>
              <Field label="Channel" htmlFor="templateChannel">
                <select
                  id="templateChannel"
                  value={form.channel}
                  onChange={(event) => update('channel', event.target.value)}
                >
                  <option value="">Any channel (optional)</option>
                  {TEMPLATE_CHANNELS.map((channel) => (
                    <option key={channel} value={channel}>{channel}</option>
                  ))}
                </select>
              </Field>
              <Field label="Body" htmlFor="templateBody" className="span-2">
                <textarea
                  id="templateBody"
                  value={form.body}
                  onChange={(event) => update('body', event.target.value)}
                  rows={5}
                  placeholder="Claim {{claimNumber}} requires attention."
                />
              </Field>
              <div className="eia-actions span-3" style={{ justifyContent: 'flex-end' }}>
                <button type="button" className="eia-btn-secondary" onClick={closeCreate} disabled={creating}>
                  Cancel
                </button>
                <button type="submit" disabled={creating}>
                  {creating ? 'Creating…' : 'Create template'}
                </button>
              </div>
            </form>
            {error && <p role="alert" style={{ margin: '8px 0 0' }}>{error}</p>}
          </section>
        </div>
      )}

      {approveTarget && (
        <div
          style={OVERLAY_STYLE}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !approving) closeApprove();
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="approve-template-title"
            className="eia-card"
            style={{ ...DIALOG_STYLE, width: 'min(520px, 100%)' }}
            data-testid="approve-template-dialog"
          >
            <div className="eia-record-title">
              <div>
                <h2 id="approve-template-title" style={{ margin: 0 }}>Approve template</h2>
                <p className="eia-record-subtitle">
                  Approve <b>{labelOf(approveTarget)}</b>. Approval records the approver and makes
                  the template ACTIVE, which is the only state that can send notifications.
                </p>
              </div>
              <button type="button" className="eia-btn-ghost" onClick={closeApprove} disabled={approving}>
                Close
              </button>
            </div>

            <form onSubmit={submitApproval} noValidate style={{ marginTop: 16 }}>
              <Field label="Approver UUID" htmlFor="approverId">
                <input
                  id="approverId"
                  value={approverId}
                  onChange={(event) => setApproverId(event.target.value)}
                  placeholder="0192f3a4-0000-7000-8000-000000000002"
                  autoComplete="off"
                  autoFocus
                />
              </Field>
              <p className="eia-muted" style={{ fontSize: 11, margin: '6px 0 14px' }}>
                The approver must be the UUID of the approving user. The value is recorded with the
                approval, so it is required and cannot be inferred from the browser session.
              </p>
              <div className="eia-actions">
                <button type="button" className="eia-btn-secondary" onClick={closeApprove} disabled={approving}>
                  Cancel
                </button>
                <button type="submit" disabled={approving}>
                  {approving ? 'Approving…' : 'Approve'}
                </button>
              </div>
            </form>
            {error && <p role="alert" style={{ margin: '8px 0 0' }}>{error}</p>}
          </section>
        </div>
      )}
    </section>
  );
}
