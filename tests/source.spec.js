import { test, expect } from '@playwright/test';

const TENANT = '11111111-1111-7111-8111-111111111111';
const API = '**/api/v1/notifications**';
const PARTY_API = '**/api/v1/parties/**';
const PARTY_ID = '0192f3a4-0000-7000-8000-000000000002';

function uuid(value) {
  return `0192f3a4-0000-7000-8000-${String(value).padStart(12, '0')}`;
}

function notification(overrides = {}) {
  return {
    id: uuid(1),
    tenantId: TENANT,
    notificationNumber: 'NTF-2026-000000001',
    notificationType: 'NEW_CLAIM_NOTICE',
    channel: 'EMAIL',
    status: 'CREATED',
    recipientPartyId: PARTY_ID,
    subject: 'Claim requires attention',
    body: 'Claim CLM-2026-0000001 requires attention.',
    templateCode: 'CLAIM_NOTICE_STANDARD',
    templateVersion: 1,
    scheduledAt: null,
    sentAt: null,
    version: 0,
    createdAt: '2026-10-19T12:00:00Z',
    updatedAt: '2026-10-19T12:00:00Z',
    sourceType: null,
    sourceId: null,
    sourceReference: null,
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

/**
 * Compact Notifications API mock for source coverage: list, detail, create,
 * and the party lookup the Overview performs. A created notification is merged
 * into the queue so the workbench selects and renders it after the POST.
 */
async function installNotificationMock(page, rows) {
  const state = {
    queue: rows.map((row) => ({ ...row })),
    createBody: null
  };

  await page.route(API, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (method === 'GET' && path === '/api/v1/notifications') {
      await json(route, 200, state.queue);
      return;
    }

    if (method === 'GET' && path === '/api/v1/notifications/search') {
      await json(route, 200, { query: url.searchParams.get('q') || '', limit: 10, items: [] });
      return;
    }

    if (method === 'GET' && /^\/api\/v1\/notifications\/[^/]+$/.test(path)) {
      const found = state.queue.find((row) => row.id === path.split('/').pop());
      await json(route, found ? 200 : 404, found || { detail: 'Notification was not found.' });
      return;
    }

    if (method === 'POST' && path === '/api/v1/notifications') {
      state.createBody = request.postDataJSON();
      const created = notification({
        ...state.createBody,
        id: uuid(99),
        notificationNumber: 'NTF-2026-000000099',
        status: 'CREATED',
        version: 0,
        createdAt: '2026-10-20T09:00:00Z',
        updatedAt: '2026-10-20T09:00:00Z'
      });
      state.queue = [created, ...state.queue];
      await json(route, 201, created);
      return;
    }

    await route.fulfill({ status: 404, body: 'unexpected route' });
  });

  await page.route(PARTY_API, async (route) => {
    await json(route, 404, { detail: 'Party was not found.' });
  });

  return state;
}

const CLASSIFIED_SOURCES = [
  {
    type: 'DIRECT_CLAIM',
    route: 'direct-claims',
    label: 'Direct claim',
    reference: 'CLM-2026-0000001',
    index: 1
  },
  {
    type: 'ASSUMED_CLAIM',
    route: 'assumed-claims',
    label: 'Assumed claim',
    reference: 'ACLM-2026-0000001',
    index: 2
  },
  {
    type: 'POLICY',
    route: 'policy',
    label: 'Policy',
    reference: 'POL-2026-0000001',
    index: 3
  },
  {
    type: 'CONTRACT',
    route: 'contract',
    label: 'Contract',
    reference: 'CTR-2026-0000001',
    index: 4
  },
  {
    type: 'PAYMENT',
    route: 'payment',
    label: 'Payment',
    reference: 'PAY-2026-0000001',
    index: 5
  }
];

function sourceRow(entry) {
  return notification({
    id: uuid(100 + entry.index),
    notificationNumber: `NTF-2026-0000010${entry.index}`,
    sourceType: entry.type,
    sourceId: uuid(200 + entry.index),
    sourceReference: entry.reference
  });
}

test('links each classified source to the remote that owns the record', async ({ page }) => {
  const rows = CLASSIFIED_SOURCES.map(sourceRow);
  await installNotificationMock(page, rows);

  for (const [index, entry] of CLASSIFIED_SOURCES.entries()) {
    const row = rows[index];

    await page.goto(`/?record=${row.id}`);

    const link = page.getByTestId('overview-source-link');
    await expect(link).toHaveText(entry.reference);
    await expect(link).toHaveAttribute('href', `/${entry.route}?record=${row.sourceId}`);
    await expect(page.getByTestId('overview-source')).toContainText(entry.label);
    await expect(page.getByTestId('overview-source-id')).toHaveText(row.sourceId);
    await expect(page.getByTestId('related-source-link')).toHaveAttribute(
      'href',
      `/${entry.route}?record=${row.sourceId}`
    );
    await expect(page.getByTestId('context-source-link')).toHaveAttribute(
      'href',
      `/${entry.route}?record=${row.sourceId}`
    );
  }

  // The Overview link is real navigation, not just an href.
  const directClaim = rows[0];
  await page.goto(`/?record=${directClaim.id}`);
  await page.getByTestId('overview-source-link').click();
  await expect(page).toHaveURL(new RegExp(`/direct-claims\\?record=${directClaim.sourceId}$`));
});

test('shows an OTHER source as text and falls back to the short id without a reference', async ({ page }) => {
  const other = notification({
    id: uuid(110),
    notificationNumber: 'NTF-2026-00000110',
    sourceType: 'OTHER',
    sourceId: uuid(210),
    sourceReference: 'EXT-2026-0000001'
  });
  const noReference = notification({
    id: uuid(111),
    notificationNumber: 'NTF-2026-00000111',
    sourceType: 'POLICY',
    sourceId: uuid(211),
    sourceReference: null
  });
  await installNotificationMock(page, [other, noReference]);

  await page.goto(`/?record=${other.id}`);
  await expect(page.getByTestId('overview-source-text')).toHaveText('EXT-2026-0000001');
  await expect(page.getByTestId('overview-source-link')).toHaveCount(0);
  await expect(page.getByTestId('overview-source')).toContainText('Other source');
  await expect(page.getByTestId('overview-source-id')).toHaveText(other.sourceId);
  await expect(page.getByTestId('related-source-text')).toContainText('EXT-2026-0000001');
  await expect(page.getByTestId('context-source-text')).toContainText('EXT-2026-0000001');

  await page.goto(`/?record=${noReference.id}`);
  await expect(page.getByTestId('overview-source-link')).toHaveText('0192f3a4…');
  await expect(page.getByTestId('overview-source-link')).toHaveAttribute(
    'href',
    `/policy?record=${noReference.sourceId}`
  );
  await expect(page.getByTestId('overview-source-id')).toHaveCount(0);
});

test('prefills source fields from a create URL and posts them', async ({ page }) => {
  const existing = notification();
  const state = await installNotificationMock(page, [existing]);
  const sourceId = uuid(300);

  const query = new URLSearchParams({
    new: '1',
    sourceType: 'CONTRACT',
    sourceId,
    sourceReference: 'CTR-2026-0000007'
  });
  await page.goto(`/?${query}`);

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Source type')).toHaveValue('CONTRACT');
  await expect(dialog.getByLabel('Source record id')).toHaveValue(sourceId);
  await expect(dialog.getByLabel('Source reference')).toHaveValue('CTR-2026-0000007');

  await dialog.getByLabel('Subject').fill('Contract source notification');
  await dialog.getByLabel('Body').fill('Generated from contract CTR-2026-0000007.');
  await dialog.getByRole('button', { name: 'Create notification' }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('overview-source-link')).toHaveAttribute(
    'href',
    `/contract?record=${sourceId}`
  );
  expect(state.createBody).toMatchObject({
    sourceType: 'CONTRACT',
    sourceId,
    sourceReference: 'CTR-2026-0000007'
  });
});

test('requires the source type and record id together before creating', async ({ page }) => {
  const state = await installNotificationMock(page, [notification()]);
  const sourceId = uuid(301);

  await page.goto('/?new=1');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  await dialog.getByLabel('Subject').fill('Source validation');
  await dialog.getByLabel('Body').fill('A source type and record id must travel together.');

  await dialog.getByLabel('Source type').selectOption('POLICY');
  await dialog.getByRole('button', { name: 'Create notification' }).click();
  await expect(dialog.getByRole('alert')).toContainText(
    'Enter the source record id for the Policy source.'
  );
  await expect(dialog).toBeVisible();
  expect(state.createBody).toBeNull();

  await dialog.getByLabel('Source type').selectOption('');
  await dialog.getByLabel('Source record id').fill(sourceId);
  await dialog.getByRole('button', { name: 'Create notification' }).click();
  await expect(dialog.getByRole('alert')).toContainText(
    'Select a source type before entering a source record id.'
  );
  expect(state.createBody).toBeNull();

  await dialog.getByLabel('Source type').selectOption('POLICY');
  await dialog.getByLabel('Source record id').fill('not-a-uuid');
  await dialog.getByRole('button', { name: 'Create notification' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Source record id must be a UUID.');
  expect(state.createBody).toBeNull();

  await dialog.getByLabel('Source record id').fill(sourceId);
  await dialog.getByLabel('Source reference').fill('POL-2026-0000009');
  await dialog.getByRole('button', { name: 'Create notification' }).click();

  await expect(dialog).toBeHidden();
  expect(state.createBody).toMatchObject({
    sourceType: 'POLICY',
    sourceId,
    sourceReference: 'POL-2026-0000009'
  });
});

test('omits source fields when the create draft has no source', async ({ page }) => {
  const state = await installNotificationMock(page, [notification()]);

  await page.goto('/?new=1');
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Subject').fill('No source notification');
  await dialog.getByLabel('Body').fill('This notification was not caused by a linked record.');
  await dialog.getByRole('button', { name: 'Create notification' }).click();

  await expect(dialog).toBeHidden();
  expect(state.createBody).not.toHaveProperty('sourceType');
  expect(state.createBody).not.toHaveProperty('sourceId');
  expect(state.createBody).not.toHaveProperty('sourceReference');
});
