import { test, expect } from '@playwright/test';

const TENANT = '11111111-1111-7111-8111-111111111111';
const NOTIFICATIONS_API = '**/api/v1/notifications**';
const DIRECTORY_API = '**/api/v1/directory';

const DIRECTORY = {
  people: [
    {
      id: 'a-adjuster',
      displayName: 'A. Adjuster',
      email: 'a.adjuster@eia.example',
      role: 'CLAIMS_ADJUSTER',
      teams: ['DIRECT_CLAIMS', 'MAJOR_LOSS']
    },
    {
      id: 'c-manager',
      displayName: 'C. Manager',
      email: 'c.manager@eia.example',
      role: 'CLAIMS_MANAGER',
      teams: ['SUPERVISORY']
    }
  ],
  teams: [
    { code: 'DIRECT_CLAIMS', label: 'Direct claims' },
    { code: 'MAJOR_LOSS', label: 'Major loss' },
    { code: 'SUPERVISORY', label: 'Supervisory' }
  ]
};

function notification(overrides = {}) {
  return {
    id: '0192f3a4-0000-7000-8000-000000000001',
    tenantId: TENANT,
    notificationNumber: 'NTF-2026-000000001',
    notificationType: 'NEW_CLAIM_NOTICE',
    channel: 'EMAIL',
    status: 'CREATED',
    subject: 'Claim requires attention',
    body: 'Claim CLM-2026-000000001 requires attention.',
    templateCode: 'CLAIM_NOTICE_STANDARD',
    templateVersion: 1,
    version: 0,
    createdAt: '2026-10-19T12:00:00Z',
    updatedAt: '2026-10-19T12:00:00Z',
    ...overrides
  };
}

function template(overrides = {}) {
  return {
    id: '0192f3a4-0000-7000-8000-000000000601',
    tenantId: TENANT,
    templateCode: 'NOTICE_A',
    templateVersion: 1,
    locale: 'en-US',
    channel: 'EMAIL',
    body: 'Claim {{claimNumber}} requires attention.',
    status: 'DRAFT',
    approvedBy: null,
    approvedAt: null,
    createdAt: '2026-10-18T09:00:00Z',
    updatedAt: '2026-10-20T11:30:00Z',
    ...overrides
  };
}

async function json(route, status, body) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body)
  });
}

function problem(code, detail, status = 400) {
  return {
    type: `https://errors.eia-open-insurance.example/notifications/${code.toLowerCase()}`,
    title: 'Notification template request rejected',
    status,
    detail,
    code,
    category: status === 409 ? 'CONFLICT' : status === 503 ? 'UNAVAILABLE' : 'VALIDATION',
    retryable: false
  };
}

/**
 * Mounts the workspace API and records every directory read and approval
 * payload. The directory can fail (503) or return an empty people list without
 * breaking the template registry itself.
 */
async function installApi(page, state) {
  state.notifications = [notification()];
  state.directory = state.directory || DIRECTORY;
  state.directoryGets = 0;
  state.directoryRequest = null;
  state.approvals = [];

  await page.route(DIRECTORY_API, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    state.directoryGets += 1;
    state.directoryRequest = {
      method: request.method(),
      path: url.pathname,
      tenant: request.headers()['x-eia-tenant']
    };
    if (state.directoryFailure) {
      await json(
        route,
        503,
        problem('EIA-GTW-9701', 'The people directory could not be reached.', 503)
      );
      return;
    }
    await json(route, 200, state.directory);
  });

  await page.route(NOTIFICATIONS_API, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();

    if (method === 'GET' && url.pathname === '/api/v1/notifications') {
      await json(route, 200, state.notifications);
      return;
    }

    if (method === 'GET' && url.pathname === '/api/v1/notifications/templates') {
      await json(route, 200, state.templates);
      return;
    }

    if (method === 'POST' && /\/templates\/[^/]+\/approve$/.test(url.pathname)) {
      const payload = request.postDataJSON();
      const templateId = url.pathname.split('/')[5];
      state.approvals.push({ path: url.pathname, payload });
      const current = state.templates.find((row) => row.id === templateId);
      const approved = {
        ...current,
        status: 'ACTIVE',
        approvedBy: payload.approvedBy,
        approvedAt: '2026-10-22T15:00:00Z',
        updatedAt: '2026-10-22T15:00:00Z'
      };
      state.templates = state.templates.map((row) => (row.id === templateId ? approved : row));
      await json(route, 200, approved);
      return;
    }

    if (method === 'GET' && url.pathname.startsWith('/api/v1/notifications/')) {
      await json(route, 200, state.notifications[0]);
      return;
    }

    await route.fulfill({ status: 404, body: `unexpected route ${method} ${url.pathname}` });
  });
}

async function openTemplates(page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Templates', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Templates', exact: true })).toBeVisible();
  await expect(page.getByTestId('template-approval-gate')).toBeVisible();
}

test('loads the directory once, searches by name or email, and posts the selected person id', async ({ page }) => {
  const first = template();
  const second = template({
    id: '0192f3a4-0000-7000-8000-000000000602',
    templateCode: 'NOTICE_B'
  });
  const state = { templates: [first, second] };
  await installApi(page, state);

  await openTemplates(page);
  await page.getByRole('button', { name: 'Approve NOTICE_A v1', exact: true }).click();

  const dialog = page.getByTestId('approve-template-dialog');
  await expect(dialog).toBeVisible();
  const search = dialog.getByTestId('directory-person-search');
  await expect(search).toBeVisible();

  // The dialog open starts exactly one directory read and lists every person.
  await expect(dialog.getByTestId('directory-person-option-a-adjuster')).toBeVisible();
  await expect(dialog.getByTestId('directory-person-option-c-manager')).toBeVisible();
  expect(state.directoryGets).toBe(1);
  expect(state.directoryRequest).toEqual({
    method: 'GET',
    path: '/api/v1/directory',
    // Public master data: the request is not tenant scoped.
    tenant: undefined
  });

  // Name search narrows the list...
  await search.fill('A. Adjuster');
  await expect(dialog.getByTestId('directory-person-option-c-manager')).toHaveCount(0);
  await expect(dialog.getByTestId('directory-person-option-a-adjuster')).toBeVisible();

  // ...and email search is accepted too.
  await search.fill('c.manager@eia.example');
  await expect(dialog.getByTestId('directory-person-option-a-adjuster')).toHaveCount(0);
  await expect(dialog.getByTestId('directory-person-option-c-manager')).toBeVisible();

  // Enter selects the highlighted match; the field and context show the name.
  await search.press('Enter');
  await expect(dialog.getByTestId('directory-person-selected-name')).toHaveText('C. Manager');
  const context = dialog.getByTestId('approver-directory-context');
  await expect(context).toContainText('Directory person');
  await expect(context).toContainText('C. Manager');
  await expect(context).toContainText('CLAIMS_MANAGER');
  await expect(dialog.getByTestId('approver-context-id')).toHaveText('c-manager');

  // Reopening the dialog reuses the cached directory instead of reading again.
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Approve NOTICE_B v1', exact: true }).click();
  const secondDialog = page.getByTestId('approve-template-dialog');
  await expect(secondDialog.getByTestId('directory-person-option-a-adjuster')).toBeVisible();
  expect(state.directoryGets).toBe(1);

  await secondDialog.getByTestId('directory-person-search').fill('a.adjuster');
  await secondDialog.getByTestId('directory-person-option-a-adjuster').click();
  await secondDialog.getByRole('button', { name: 'Approve', exact: true }).click();

  await expect(secondDialog).toBeHidden();
  await expect(page.getByRole('status')).toContainText(
    'Template NOTICE_B v1 approved by A. Adjuster.'
  );
  await expect(page.getByTestId(`template-approved-by-${second.id}`)).toHaveText('A. Adjuster');
  expect(state.approvals).toEqual([
    {
      path: `/api/v1/notifications/templates/${second.id}/approve`,
      payload: { approvedBy: 'a-adjuster' }
    }
  ]);
});

test('falls back to a manual approver id when the directory is unavailable', async ({ page }) => {
  const draft = template();
  const state = { templates: [draft], directoryFailure: true };
  await installApi(page, state);

  await openTemplates(page);
  await page.getByRole('button', { name: 'Approve NOTICE_A v1', exact: true }).click();

  const dialog = page.getByTestId('approve-template-dialog');
  const fallback = dialog.getByTestId('approver-directory-fallback');
  await expect(dialog).toBeVisible();
  await expect(fallback).toBeVisible();
  await expect(fallback).toContainText('The people directory is unavailable');
  await expect(fallback).toContainText('EIA-GTW-9701');
  await expect(dialog.getByTestId('approver-manual-id')).toBeVisible();
  await expect(dialog.getByTestId('directory-person-picker')).toHaveCount(0);
  expect(state.directoryGets).toBe(1);

  // A failed lookup is not cached: reopening retries rather than pinning the
  // app to the outage for the rest of the session.
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Approve NOTICE_A v1', exact: true }).click();
  await expect(dialog.getByTestId('approver-manual-id')).toBeVisible();
  expect(state.directoryGets).toBe(2);

  await dialog.getByTestId('approver-manual-id').fill('legacy-approver');
  await dialog.getByRole('button', { name: 'Approve', exact: true }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByTestId(`template-status-${draft.id}`)).toHaveText('ACTIVE');
  await expect(page.getByTestId(`template-approved-${draft.id}`)).toContainText('Approved');
  await expect(page.getByTestId(`template-approved-by-${draft.id}`)).toHaveText('legacy-a…');
  expect(state.approvals).toEqual([
    {
      path: `/api/v1/notifications/templates/${draft.id}/approve`,
      payload: { approvedBy: 'legacy-approver' }
    }
  ]);
});

test('falls back to manual entry when the directory returns no people', async ({ page }) => {
  const draft = template();
  const state = { templates: [draft], directory: { people: [], teams: [] } };
  await installApi(page, state);

  await openTemplates(page);
  await page.getByRole('button', { name: 'Approve NOTICE_A v1', exact: true }).click();

  const dialog = page.getByTestId('approve-template-dialog');
  const fallback = dialog.getByTestId('approver-directory-fallback');
  await expect(fallback).toBeVisible();
  await expect(fallback).toContainText('returned no people');
  await expect(dialog.getByTestId('approver-manual-id')).toBeVisible();
  await expect(dialog.getByTestId('directory-person-picker')).toHaveCount(0);

  // The manual field still enforces that an approver is recorded.
  await dialog.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Approver id is required.');
  await expect(dialog).toBeVisible();
  expect(state.approvals).toHaveLength(0);
});
