import { test, expect } from '@playwright/test';

const TENANT = '11111111-1111-7111-8111-111111111111';
const API = '**/api/v1/notifications**';
const APPROVER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

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
    id: '0192f3a4-0000-7000-8000-000000000101',
    tenantId: TENANT,
    templateCode: 'CLAIM_NOTICE_STANDARD',
    templateVersion: 1,
    locale: 'en-US',
    channel: null,
    body: 'Claim {{claimNumber}} requires attention.',
    status: 'ACTIVE',
    approvedBy: APPROVER,
    approvedAt: '2026-10-19T15:02:11Z',
    createdAt: '2026-10-18T09:00:00Z',
    updatedAt: '2026-10-19T15:02:11Z',
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
    category: status === 409 ? 'CONFLICT' : 'VALIDATION',
    retryable: false
  };
}

/**
 * Mounts the workspace API. `state` carries the mutable template registry and
 * per-test action handlers so every transition can be observed from the UI and
 * the request payload can be asserted.
 */
async function installApi(page, state) {
  state.notifications = state.notifications || [notification()];
  state.templateGets = 0;

  await page.route(API, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();

    if (method === 'GET' && url.pathname === '/api/v1/notifications') {
      await json(route, 200, state.notifications);
      return;
    }

    if (url.pathname === '/api/v1/notifications/templates') {
      if (method === 'GET') {
        state.templateGets += 1;
        await json(route, 200, state.templates);
        return;
      }
      if (method === 'POST') {
        await state.onCreate(route);
        return;
      }
    }

    if (method === 'POST' && /\/templates\/[^/]+\/approve$/.test(url.pathname)) {
      await state.onApprove(route);
      return;
    }

    if (method === 'POST' && /\/templates\/[^/]+\/retire$/.test(url.pathname)) {
      await state.onRetire(route);
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

function templateRows(page) {
  return page.locator('[data-testid^="template-row-"]');
}

test('lists templates, surfaces the approval gate, and filters the registry', async ({ page }) => {
  const active = template();
  const draft = template({
    id: '0192f3a4-0000-7000-8000-000000000102',
    templateCode: 'CLAIM_NOTICE_DRAFT',
    templateVersion: 1,
    locale: 'en-US',
    channel: 'EMAIL',
    status: 'DRAFT',
    approvedBy: null,
    approvedAt: null,
    updatedAt: '2026-10-20T11:30:00Z'
  });
  const retired = template({
    id: '0192f3a4-0000-7000-8000-000000000103',
    templateCode: 'LEGACY_NOTICE',
    templateVersion: 3,
    locale: 'fr-CA',
    channel: 'SMS',
    status: 'RETIRED',
    updatedAt: '2026-10-21T08:15:00Z'
  });
  const state = { templates: [active, draft, retired] };
  state.onCreate = async (route) => json(route, 500, problem('EIA-NTF-9999', 'not used', 500));
  state.onApprove = async (route) => json(route, 500, problem('EIA-NTF-9999', 'not used', 500));
  state.onRetire = async (route) => json(route, 500, problem('EIA-NTF-9999', 'not used', 500));
  await installApi(page, state);

  await openTemplates(page);

  await expect(page.getByTestId('templates-table')).toBeVisible();
  const headers = page.getByTestId('templates-table').locator('thead th');
  await expect(headers).toHaveText([
    'Code',
    'Version',
    'Locale',
    'Channel',
    'Status',
    'Approved',
    'Updated',
    'Actions'
  ]);
  await expect(templateRows(page)).toHaveCount(3);

  await expect(page.getByTestId(`template-row-${active.id}`)).toContainText('CLAIM_NOTICE_STANDARD');
  await expect(page.getByTestId(`template-row-${active.id}`)).toContainText('ACTIVE');
  await expect(page.getByTestId(`template-row-${active.id}`)).toContainText('Approved');
  await expect(page.getByTestId(`template-row-${active.id}`)).toContainText('Any channel');
  await expect(page.getByTestId(`template-row-${draft.id}`)).toContainText('DRAFT');
  await expect(page.getByTestId(`template-row-${draft.id}`)).toContainText('Not approved');
  await expect(page.getByTestId(`template-row-${retired.id}`)).toContainText('RETIRED');
  await expect(page.getByTestId(`template-row-${retired.id}`)).toContainText('fr-CA');

  await expect(page.getByTestId('template-approval-gate')).toContainText(
    'Only ACTIVE approved templates can send notifications.'
  );

  await expect(
    page.getByRole('button', { name: 'Approve CLAIM_NOTICE_DRAFT v1', exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Approve CLAIM_NOTICE_STANDARD v1', exact: true })
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Retire CLAIM_NOTICE_STANDARD v1', exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Retire LEGACY_NOTICE v3', exact: true })
  ).toHaveCount(0);

  const filter = page.getByTestId('template-filter');
  await filter.fill('draft');
  await expect(templateRows(page)).toHaveCount(1);
  await expect(page.getByTestId('template-filter-count')).toHaveText('1 of 3 templates');
  await expect(page.getByTestId(`template-row-${draft.id}`)).toBeVisible();

  await filter.fill('fr-ca');
  await expect(templateRows(page)).toHaveCount(1);
  await expect(page.getByTestId(`template-row-${retired.id}`)).toBeVisible();

  await filter.fill('does-not-exist');
  await expect(page.getByTestId('template-filter-empty')).toContainText('No templates match');
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(templateRows(page)).toHaveCount(3);
});

test('creates a DRAFT template through the modal and preserves the payload', async ({ page }) => {
  const state = { templates: [] };
  let createdPayload = null;
  state.onCreate = async (route) => {
    createdPayload = route.request().postDataJSON();
    const created = template({
      id: '0192f3a4-0000-7000-8000-000000000201',
      templateCode: createdPayload.templateCode,
      templateVersion: createdPayload.templateVersion,
      locale: createdPayload.locale,
      channel: createdPayload.channel,
      body: createdPayload.bodyTemplate,
      status: 'DRAFT',
      approvedBy: null,
      approvedAt: null,
      updatedAt: '2026-10-22T12:00:00Z'
    });
    state.templates = [created];
    await json(route, 201, created);
  };
  state.onApprove = async (route) => json(route, 500, problem('EIA-NTF-9999', 'not used', 500));
  state.onRetire = async (route) => json(route, 500, problem('EIA-NTF-9999', 'not used', 500));
  await installApi(page, state);

  await openTemplates(page);
  await expect(page.getByText('No templates yet. Use Create template to add the first DRAFT.')).toBeVisible();

  await page.getByRole('button', { name: 'Create template', exact: true }).click();
  const dialog = page.getByTestId('create-template-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Code')).toBeVisible();
  await expect(dialog.getByLabel('Version')).toHaveValue('1');
  await expect(dialog.getByLabel('Locale')).toHaveValue('en-US');
  await expect(dialog.getByLabel('Channel')).toHaveValue('');
  await expect(dialog.getByLabel('Body')).toBeVisible();

  await dialog.getByLabel('Code').fill('PAYMENT_APPROVAL');
  await dialog.getByLabel('Version').fill('3');
  await dialog.getByLabel('Locale').fill('fr-CA');
  await dialog.getByLabel('Channel').selectOption('EMAIL');
  await dialog.getByLabel('Body').fill('Payment {{paymentNumber}} requires approval.');
  await dialog.getByRole('button', { name: 'Create template', exact: true }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByRole('status')).toContainText('Template PAYMENT_APPROVAL v3 created as DRAFT.');
  await expect(templateRows(page)).toHaveCount(1);
  await expect(page.getByTestId('template-row-0192f3a4-0000-7000-8000-000000000201')).toContainText(
    'PAYMENT_APPROVAL'
  );
  await expect(page.getByTestId('template-status-0192f3a4-0000-7000-8000-000000000201')).toHaveText(
    'DRAFT'
  );

  expect(createdPayload).toEqual({
    templateCode: 'PAYMENT_APPROVAL',
    templateVersion: 3,
    locale: 'fr-CA',
    channel: 'EMAIL',
    bodyTemplate: 'Payment {{paymentNumber}} requires approval.'
  });
  expect(state.templateGets).toBeGreaterThanOrEqual(2);
});

test('validates the create form and sends a null channel when the optional field is blank', async ({ page }) => {
  const state = { templates: [] };
  let createPayload = null;
  state.onCreate = async (route) => {
    createPayload = route.request().postDataJSON();
    const created = template({
      id: '0192f3a4-0000-7000-8000-000000000202',
      templateCode: createPayload.templateCode,
      templateVersion: createPayload.templateVersion,
      locale: createPayload.locale,
      channel: createPayload.channel,
      body: createPayload.bodyTemplate,
      status: 'DRAFT',
      approvedBy: null,
      approvedAt: null
    });
    state.templates = [created];
    await json(route, 201, created);
  };
  state.onApprove = async (route) => json(route, 500, problem('EIA-NTF-9999', 'not used', 500));
  state.onRetire = async (route) => json(route, 500, problem('EIA-NTF-9999', 'not used', 500));
  await installApi(page, state);

  await openTemplates(page);
  await page.getByRole('button', { name: 'Create template', exact: true }).click();
  const dialog = page.getByTestId('create-template-dialog');
  const submit = dialog.getByRole('button', { name: 'Create template', exact: true });

  await submit.click();
  await expect(dialog.getByRole('alert')).toContainText('Code is required.');
  await expect(dialog.getByRole('alert')).toContainText('Body is required.');
  expect(createPayload).toBeNull();
  await expect(dialog).toBeVisible();

  await dialog.getByLabel('Code').fill('LOCALE_TEST');
  await dialog.getByLabel('Version').fill('0');
  await dialog.getByLabel('Locale').fill('not a locale');
  await dialog.getByLabel('Body').fill('Body for the locale test.');
  await submit.click();
  await expect(dialog.getByRole('alert')).toContainText('Version must be a whole number of 1 or more.');
  await expect(dialog.getByRole('alert')).toContainText('Locale must be a BCP 47 tag such as en-US.');
  expect(createPayload).toBeNull();

  await dialog.getByLabel('Version').fill('2');
  await dialog.getByLabel('Locale').fill('de-DE');
  await submit.click();

  await expect(dialog).toBeHidden();
  expect(createPayload).toEqual({
    templateCode: 'LOCALE_TEST',
    templateVersion: 2,
    locale: 'de-DE',
    channel: null,
    bodyTemplate: 'Body for the locale test.'
  });
});

test('requires an approver UUID and approves a DRAFT template', async ({ page }) => {
  const draft = template({
    id: '0192f3a4-0000-7000-8000-000000000301',
    templateCode: 'CLAIM_NOTICE_DRAFT',
    status: 'DRAFT',
    approvedBy: null,
    approvedAt: null,
    updatedAt: '2026-10-20T11:30:00Z'
  });
  const state = { templates: [draft] };
  let approvePayload = null;
  state.onCreate = async (route) => json(route, 500, problem('EIA-NTF-9999', 'not used', 500));
  state.onApprove = async (route) => {
    approvePayload = route.request().postDataJSON();
    expect(new URL(route.request().url()).pathname).toBe(
      `/api/v1/notifications/templates/${draft.id}/approve`
    );
    const approved = {
      ...draft,
      status: 'ACTIVE',
      approvedBy: approvePayload.approvedBy,
      approvedAt: '2026-10-22T13:00:00Z',
      updatedAt: '2026-10-22T13:00:00Z'
    };
    state.templates = [approved];
    await json(route, 200, approved);
  };
  state.onRetire = async (route) => json(route, 500, problem('EIA-NTF-9999', 'not used', 500));
  await installApi(page, state);

  await openTemplates(page);
  await page.getByRole('button', { name: 'Approve CLAIM_NOTICE_DRAFT v1', exact: true }).click();
  const dialog = page.getByTestId('approve-template-dialog');
  await expect(dialog).toBeVisible();
  const submit = dialog.getByRole('button', { name: 'Approve', exact: true });

  await submit.click();
  await expect(dialog.getByRole('alert')).toContainText('Approver UUID is required.');
  expect(approvePayload).toBeNull();

  await dialog.getByLabel('Approver UUID').fill('not-a-uuid');
  await submit.click();
  await expect(dialog.getByRole('alert')).toContainText('Approver must be a valid UUID.');
  expect(approvePayload).toBeNull();

  await dialog.getByLabel('Approver UUID').fill(APPROVER);
  await submit.click();

  await expect(dialog).toBeHidden();
  await expect(page.getByRole('status')).toContainText('Template CLAIM_NOTICE_DRAFT v1 approved.');
  await expect(page.getByTestId(`template-status-${draft.id}`)).toHaveText('ACTIVE');
  await expect(page.getByTestId(`template-approved-${draft.id}`)).toContainText('Approved');
  await expect(page.getByTestId(`template-row-${draft.id}`)).toContainText('cccccccc…');
  await expect(
    page.getByRole('button', { name: 'Approve CLAIM_NOTICE_DRAFT v1', exact: true })
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Retire CLAIM_NOTICE_DRAFT v1', exact: true })
  ).toBeVisible();

  expect(approvePayload).toEqual({ approvedBy: APPROVER });
  expect(state.templateGets).toBeGreaterThanOrEqual(2);
});

test('retires an ACTIVE template and removes the retire action from RETIRED rows', async ({ page }) => {
  const active = template();
  const draft = template({
    id: '0192f3a4-0000-7000-8000-000000000302',
    templateCode: 'DRAFT_NOTICE',
    status: 'DRAFT',
    approvedBy: null,
    approvedAt: null
  });
  const retired = template({
    id: '0192f3a4-0000-7000-8000-000000000303',
    templateCode: 'OLD_NOTICE',
    status: 'RETIRED',
    approvedBy: APPROVER
  });
  const state = { templates: [active, draft, retired] };
  let retiredId = null;
  state.onCreate = async (route) => json(route, 500, problem('EIA-NTF-9999', 'not used', 500));
  state.onApprove = async (route) => json(route, 500, problem('EIA-NTF-9999', 'not used', 500));
  state.onRetire = async (route) => {
    retiredId = new URL(route.request().url()).pathname.split('/')[5];
    const updated = {
      ...active,
      status: 'RETIRED',
      updatedAt: '2026-10-22T14:00:00Z'
    };
    state.templates = state.templates.map((row) => (row.id === updated.id ? updated : row));
    await json(route, 200, updated);
  };
  await installApi(page, state);

  await openTemplates(page);
  await page.getByRole('button', { name: 'Retire CLAIM_NOTICE_STANDARD v1', exact: true }).click();

  await expect(page.getByRole('status')).toContainText('Template CLAIM_NOTICE_STANDARD v1 retired.');
  await expect(page.getByTestId(`template-status-${active.id}`)).toHaveText('RETIRED');
  await expect(
    page.getByRole('button', { name: 'Retire CLAIM_NOTICE_STANDARD v1', exact: true })
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Approve CLAIM_NOTICE_STANDARD v1', exact: true })
  ).toHaveCount(0);
  expect(retiredId).toBe(active.id);
  expect(state.templateGets).toBeGreaterThanOrEqual(2);
});

test('contains a 409 approval conflict and reloads the winning template state', async ({ page }) => {
  const draft = template({
    id: '0192f3a4-0000-7000-8000-000000000401',
    templateCode: 'RACE_NOTICE',
    status: 'DRAFT',
    approvedBy: null,
    approvedAt: null
  });
  const state = { templates: [draft] };
  state.onCreate = async (route) => json(route, 500, problem('EIA-NTF-9999', 'not used', 500));
  state.onApprove = async (route) => {
    state.templates = [
      {
        ...draft,
        status: 'ACTIVE',
        approvedBy: APPROVER,
        approvedAt: '2026-10-22T15:00:00Z',
        updatedAt: '2026-10-22T15:00:00Z'
      }
    ];
    await json(
      route,
      409,
      problem('EIA-NTF-9409', 'Template was already approved by another user.', 409)
    );
  };
  state.onRetire = async (route) => json(route, 500, problem('EIA-NTF-9999', 'not used', 500));
  await installApi(page, state);

  await openTemplates(page);
  const getsBeforeApproval = state.templateGets;
  await page.getByRole('button', { name: 'Approve RACE_NOTICE v1', exact: true }).click();
  const dialog = page.getByTestId('approve-template-dialog');
  await dialog.getByLabel('Approver UUID').fill(APPROVER);
  await dialog.getByRole('button', { name: 'Approve', exact: true }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByRole('alert')).toHaveText(
    'EIA-NTF-9409: Template was already approved by another user.'
  );
  await expect(page.getByTestId(`template-status-${draft.id}`)).toHaveText('ACTIVE');
  await expect(page.getByTestId(`template-approved-${draft.id}`)).toContainText('Approved');
  expect(state.templateGets).toBeGreaterThan(getsBeforeApproval);
});

test('contains a registry load failure and keeps the notification queue usable', async ({ page }) => {
  await page.route(API, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'GET' && url.pathname === '/api/v1/notifications') {
      await json(route, 200, [notification()]);
      return;
    }
    if (request.method() === 'GET' && url.pathname === '/api/v1/notifications/templates') {
      await json(
        route,
        503,
        problem(
          'EIA-NTF-9601',
          'The Notifications expert service could not be reached: connection refused',
          503
        )
      );
      return;
    }
    if (request.method() === 'GET' && url.pathname.startsWith('/api/v1/notifications/')) {
      await json(route, 200, notification());
      return;
    }
    await route.fulfill({ status: 404, body: 'unexpected route' });
  });

  await openTemplates(page);
  await expect(page.getByRole('alert')).toHaveText(
    'EIA-NTF-9601: The Notifications expert service could not be reached: connection refused'
  );
  await expect(page.getByText('No templates yet. Use Create template to add the first DRAFT.')).toBeVisible();

  await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  await expect(page.getByTestId('notification-status')).toHaveText('CREATED');
});
