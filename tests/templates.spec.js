import { test, expect } from '@playwright/test';

const TENANT = '11111111-1111-7111-8111-111111111111';
const API = '**/api/v1/notifications**';
const DIRECTORY_API = '**/api/v1/directory';
const APPROVER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

/**
 * The public people directory. The ids are the gateway's stable public
 * identifiers (`a-adjuster`, `c-manager`), not UUIDs, so the approval flow must
 * carry the selected person's directory id as `approvedBy`.
 */
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

/**
 * The template-management API projection uses `code`, `version`, and
 * `bodyTemplate`; keeping a separate fixture proves the new-version flow reads
 * the real response shape, not only the legacy aliases used by older tests.
 */
function apiTemplate(overrides = {}) {
  return {
    id: '0192f3a4-0000-7000-8000-000000000150',
    tenantId: TENANT,
    code: 'CLAIM_NOTICE_STANDARD',
    version: 1,
    locale: 'en-US',
    channel: null,
    bodyTemplate: 'Claim {{claimNumber}} requires attention.',
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
  state.directory = state.directory || DIRECTORY;
  state.directoryGets = 0;

  await page.route(DIRECTORY_API, async (route) => {
    state.directoryGets += 1;
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
  await expect(
    page.getByRole('button', { name: 'New version of CLAIM_NOTICE_STANDARD v1', exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'New version of CLAIM_NOTICE_DRAFT v1', exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'New version of LEGACY_NOTICE v3', exact: true })
  ).toBeVisible();

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
  await expect(dialog.getByRole('heading', { name: 'Create template', exact: true })).toBeVisible();
  await expect(dialog.getByTestId('template-version-context')).toHaveCount(0);
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

test('creates the next version from a prefilled source and shows same-code history', async ({ page }) => {
  const source = apiTemplate({
    id: '0192f3a4-0000-7000-8000-000000000501',
    version: 3,
    locale: 'fr-CA',
    channel: 'EMAIL',
    bodyTemplate: 'Claim {{claimNumber}} requires attention. (v3)',
    updatedAt: '2026-10-21T09:30:00Z'
  });
  const previous = apiTemplate({
    id: '0192f3a4-0000-7000-8000-000000000502',
    version: 2,
    locale: 'en-US',
    channel: 'EMAIL',
    bodyTemplate: 'Claim {{claimNumber}} requires attention. (v2)',
    status: 'RETIRED',
    updatedAt: '2026-10-20T09:30:00Z'
  });
  const oldest = apiTemplate({
    id: '0192f3a4-0000-7000-8000-000000000503',
    version: 1,
    locale: 'en-US',
    channel: null,
    bodyTemplate: 'Claim {{claimNumber}} requires attention. (v1)',
    status: 'RETIRED',
    approvedBy: null,
    approvedAt: null,
    updatedAt: '2026-10-19T09:30:00Z'
  });
  const otherCode = apiTemplate({
    id: '0192f3a4-0000-7000-8000-000000000504',
    code: 'PAYMENT_APPROVAL',
    version: 9,
    locale: 'de-DE',
    channel: 'SMS',
    bodyTemplate: 'Payment {{paymentNumber}} requires approval.',
    status: 'DRAFT',
    approvedBy: null,
    approvedAt: null
  });
  const state = { templates: [source, previous, oldest, otherCode] };
  let createdPayload = null;
  state.onCreate = async (route) => {
    createdPayload = route.request().postDataJSON();
    const created = apiTemplate({
      id: '0192f3a4-0000-7000-8000-000000000505',
      code: createdPayload.templateCode,
      version: createdPayload.templateVersion,
      locale: createdPayload.locale,
      channel: createdPayload.channel,
      bodyTemplate: createdPayload.bodyTemplate,
      status: 'DRAFT',
      approvedBy: null,
      approvedAt: null,
      updatedAt: '2026-10-22T12:00:00Z'
    });
    state.templates = [created, ...state.templates];
    await json(route, 201, created);
  };
  state.onApprove = async (route) => json(route, 500, problem('EIA-NTF-9999', 'not used', 500));
  state.onRetire = async (route) => json(route, 500, problem('EIA-NTF-9999', 'not used', 500));
  await installApi(page, state);

  await openTemplates(page);
  await page.getByRole('button', {
    name: 'New version of CLAIM_NOTICE_STANDARD v3',
    exact: true
  }).click();

  const dialog = page.getByTestId('create-template-dialog');
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole('heading', { name: 'New version of CLAIM_NOTICE_STANDARD', exact: true })
  ).toBeVisible();

  // Everything the source row carries is copied, except the version, which is
  // the next whole revision.
  await expect(dialog.getByLabel('Code')).toHaveValue('CLAIM_NOTICE_STANDARD');
  await expect(dialog.locator('#templateVersion')).toHaveValue('4');
  await expect(dialog.getByLabel('Locale')).toHaveValue('fr-CA');
  await expect(dialog.getByLabel('Channel')).toHaveValue('EMAIL');
  await expect(dialog.getByLabel('Body')).toHaveValue(
    'Claim {{claimNumber}} requires attention. (v3)'
  );

  const context = dialog.getByTestId('template-version-context');
  await expect(context).toContainText('Based on v3');
  await expect(context).toContainText('Will create v4 DRAFT');
  await expect(context).not.toContainText('PAYMENT_APPROVAL');

  const historyRows = context.getByTestId('template-version-history').locator('li');
  await expect(historyRows).toHaveCount(3);
  await expect(historyRows.nth(0)).toHaveAttribute('data-version', '3');
  await expect(historyRows.nth(1)).toHaveAttribute('data-version', '2');
  await expect(historyRows.nth(2)).toHaveAttribute('data-version', '1');
  await expect(historyRows.nth(0)).toContainText('source');
  await expect(historyRows.nth(1)).toContainText('RETIRED');

  // The user can still adjust the cloned draft before it is created.
  await dialog.getByLabel('Body').fill('Claim {{claimNumber}} requires attention. (v4 edited)');
  await dialog.getByRole('button', { name: 'Create template', exact: true }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByRole('status')).toContainText(
    'Template CLAIM_NOTICE_STANDARD v4 created as DRAFT based on v3.'
  );
  const createdRow = page.getByTestId('template-row-0192f3a4-0000-7000-8000-000000000505');
  await expect(createdRow).toContainText('CLAIM_NOTICE_STANDARD');
  await expect(createdRow).toContainText('DRAFT');
  await expect(page.getByTestId('templates-table').locator('tbody tr')).toHaveCount(5);

  expect(createdPayload).toEqual({
    templateCode: 'CLAIM_NOTICE_STANDARD',
    templateVersion: 4,
    locale: 'fr-CA',
    channel: 'EMAIL',
    bodyTemplate: 'Claim {{claimNumber}} requires attention. (v4 edited)'
  });
  expect(state.templateGets).toBeGreaterThanOrEqual(2);
});

test('keeps validation and duplicate errors inside the new-version modal', async ({ page }) => {
  const source = apiTemplate({
    id: '0192f3a4-0000-7000-8000-000000000511',
    version: 1,
    locale: 'en-US',
    channel: 'EMAIL',
    bodyTemplate: 'Claim {{claimNumber}} requires attention. (v1)'
  });
  const existing = apiTemplate({
    id: '0192f3a4-0000-7000-8000-000000000512',
    version: 2,
    locale: 'en-US',
    channel: 'EMAIL',
    bodyTemplate: 'Claim {{claimNumber}} requires attention. (v2)',
    status: 'DRAFT',
    approvedBy: null,
    approvedAt: null
  });
  const state = { templates: [source, existing] };
  const attempts = [];
  state.onCreate = async (route) => {
    const payload = route.request().postDataJSON();
    attempts.push(payload);
    if (attempts.length === 1) {
      await json(
        route,
        409,
        problem(
          'EIA-NTF-9205',
          `Template '${payload.templateCode}' version ${payload.templateVersion} locale '${payload.locale}' already exists for tenant '${TENANT}'.`,
          409
        )
      );
      return;
    }
    const created = apiTemplate({
      id: '0192f3a4-0000-7000-8000-000000000513',
      code: payload.templateCode,
      version: payload.templateVersion,
      locale: payload.locale,
      channel: payload.channel,
      bodyTemplate: payload.bodyTemplate,
      status: 'DRAFT',
      approvedBy: null,
      approvedAt: null,
      updatedAt: '2026-10-22T13:00:00Z'
    });
    state.templates = [created, ...state.templates];
    await json(route, 201, created);
  };
  state.onApprove = async (route) => json(route, 500, problem('EIA-NTF-9999', 'not used', 500));
  state.onRetire = async (route) => json(route, 500, problem('EIA-NTF-9999', 'not used', 500));
  await installApi(page, state);

  await openTemplates(page);
  await page.getByRole('button', {
    name: 'New version of CLAIM_NOTICE_STANDARD v1',
    exact: true
  }).click();
  const dialog = page.getByTestId('create-template-dialog');
  const submit = dialog.getByRole('button', { name: 'Create template', exact: true });
  await expect(dialog.locator('#templateVersion')).toHaveValue('2');

  // Client-side validation stays in the modal and never reaches the API.
  await dialog.getByLabel('Code').fill('');
  await submit.click();
  await expect(dialog.getByRole('alert')).toContainText('Code is required.');
  await expect(dialog).toBeVisible();
  expect(attempts).toHaveLength(0);

  await dialog.getByLabel('Code').fill('CLAIM_NOTICE_STANDARD');
  await submit.click();
  await expect(dialog.getByRole('alert')).toHaveText(
    `EIA-NTF-9205: Template 'CLAIM_NOTICE_STANDARD' version 2 locale 'en-US' already exists for tenant '${TENANT}'.`
  );
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('template-version-context')).toContainText('Based on v1');
  await expect(page.getByTestId('templates-table').locator('tbody tr')).toHaveCount(2);
  expect(attempts).toHaveLength(1);
  expect(attempts[0].templateVersion).toBe(2);

  // Correcting the version clears the duplicate error and creates the DRAFT.
  await dialog.locator('#templateVersion').fill('3');
  await submit.click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('status')).toContainText(
    'Template CLAIM_NOTICE_STANDARD v3 created as DRAFT based on v1.'
  );
  await expect(
    page.getByTestId('template-row-0192f3a4-0000-7000-8000-000000000513')
  ).toContainText('DRAFT');
  expect(attempts[1]).toEqual({
    templateCode: 'CLAIM_NOTICE_STANDARD',
    templateVersion: 3,
    locale: 'en-US',
    channel: 'EMAIL',
    bodyTemplate: 'Claim {{claimNumber}} requires attention. (v1)'
  });
});

test('requires a directory approver and approves a DRAFT template', async ({ page }) => {
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
  const search = dialog.getByTestId('directory-person-search');
  await expect(search).toBeVisible();
  const submit = dialog.getByRole('button', { name: 'Approve', exact: true });

  // The dialog opens the directory request and offers every person as an option.
  await expect(dialog.getByTestId('directory-person-option-c-manager')).toBeVisible();
  expect(state.directoryGets).toBe(1);
  await search.press('Escape');
  await expect(dialog).toBeVisible();
  await submit.click();
  await expect(dialog.getByRole('alert')).toContainText('Select an approver from the directory.');
  expect(approvePayload).toBeNull();

  // Search narrows by email, and the selected person is shown by name.
  await search.fill('c.manager');
  await expect(dialog.getByTestId('directory-person-option-a-adjuster')).toHaveCount(0);
  await dialog.getByTestId('directory-person-option-c-manager').click();
  await expect(dialog.getByTestId('directory-person-selected-name')).toHaveText('C. Manager');
  const context = dialog.getByTestId('approver-directory-context');
  await expect(context).toContainText('Directory person');
  await expect(dialog.getByTestId('approver-context-role')).toHaveText('CLAIMS_MANAGER');
  await expect(dialog.getByTestId('approver-context-email')).toHaveText('c.manager@eia.example');
  await expect(dialog.getByTestId('approver-context-teams')).toHaveText('Supervisory');
  await expect(dialog.getByTestId('approver-context-id')).toHaveText('c-manager');

  await submit.click();

  await expect(dialog).toBeHidden();
  await expect(page.getByRole('status')).toContainText(
    'Template CLAIM_NOTICE_DRAFT v1 approved by C. Manager.'
  );
  await expect(page.getByTestId(`template-status-${draft.id}`)).toHaveText('ACTIVE');
  await expect(page.getByTestId(`template-approved-${draft.id}`)).toContainText('Approved');
  await expect(page.getByTestId(`template-approved-by-${draft.id}`)).toHaveText('C. Manager');
  await expect(
    page.getByRole('button', { name: 'Approve CLAIM_NOTICE_DRAFT v1', exact: true })
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Retire CLAIM_NOTICE_DRAFT v1', exact: true })
  ).toBeVisible();

  expect(approvePayload).toEqual({ approvedBy: 'c-manager' });
  expect(state.templateGets).toBeGreaterThanOrEqual(2);
  expect(state.directoryGets).toBe(1);
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
  await expect(dialog.getByTestId('directory-person-option-c-manager')).toBeVisible();
  await dialog.getByTestId('directory-person-search').fill('c.manager');
  await dialog.getByTestId('directory-person-option-c-manager').click();
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
