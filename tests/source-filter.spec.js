import { test, expect } from '@playwright/test';

const TENANT = '11111111-1111-7111-8111-111111111111';
const API = '**/api/v1/notifications**';
const PARTY_API = '**/api/v1/parties/**';

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
    recipientPartyId: '0192f3a4-0000-7000-8000-000000000002',
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
 * Stateful Notifications API mock with the source-filter contract: the list
 * returns only rows matching a complete pair, and every list request is
 * recorded so a test can prove which pair (if any) crossed the wire.
 */
async function installNotificationMock(page, rows) {
  const state = {
    rows: rows.map((row) => ({ ...row })),
    listRequests: [],
    createBody: null
  };

  await page.route(API, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (method === 'GET' && path === '/api/v1/notifications') {
      const sourceType = url.searchParams.get('sourceType');
      const sourceId = url.searchParams.get('sourceId');
      state.listRequests.push({ sourceType, sourceId });
      const filtered = sourceType && sourceId
        ? state.rows.filter((row) => row.sourceType === sourceType && row.sourceId === sourceId)
        : state.rows;
      await json(route, 200, filtered);
      return;
    }

    if (method === 'GET' && /^\/api\/v1\/notifications\/[^/]+$/.test(path)) {
      const found = state.rows.find((row) => row.id === path.split('/').pop());
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
      state.rows = [created, ...state.rows];
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

test('applies a source filter from a /notifications view-all link, shows the banner, and clears it', async ({ page }) => {
  const policyId = uuid(201);
  const linked = notification({
    id: uuid(1),
    notificationNumber: 'NTF-2026-000000001',
    subject: 'Policy bound notice',
    sourceType: 'POLICY',
    sourceId: policyId,
    sourceReference: 'POL-2026-0000001'
  });
  const unlinked = notification({
    id: uuid(2),
    notificationNumber: 'NTF-2026-000000002',
    subject: 'Unlinked notice'
  });
  const state = await installNotificationMock(page, [linked, unlinked]);

  // The lowercase type proves the URL contract is normalized before the call;
  // /notifications is the shell route a "view all" link uses.
  await page.goto(`/notifications?sourceType=policy&sourceId=${policyId}`);

  const banner = page.getByTestId('source-filter-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('Policy');
  await expect(banner).toContainText('POL-2026-0000001');
  await expect(page.getByTestId('source-filter-error')).toHaveCount(0);

  const queue = page.locator('aside[aria-label="Notification queue"]');
  await expect(queue.getByRole('button', { name: /NTF-2026-000000001/ })).toBeVisible();
  await expect(queue.getByRole('button', { name: /NTF-2026-000000002/ })).toHaveCount(0);

  expect(state.listRequests).toHaveLength(1);
  expect(state.listRequests[0]).toEqual({ sourceType: 'POLICY', sourceId: policyId });

  // Selecting a filtered record keeps the source pair in the address bar.
  await queue.getByRole('button', { name: /NTF-2026-000000001/ }).click();
  await expect(page).toHaveURL(new RegExp(`record=${linked.id}`));
  await expect(page).toHaveURL(/sourceType=POLICY/);
  await expect(page).toHaveURL(new RegExp(`sourceId=${policyId}`));
  await expect(banner).toBeVisible();

  await page.getByTestId('source-filter-clear').click();

  await expect(banner).toHaveCount(0);
  await expect(page).not.toHaveURL(/sourceType|sourceId/i);
  await expect(page).toHaveURL(new RegExp(`record=${linked.id}`));
  await expect(queue.getByRole('button', { name: /NTF-2026-000000002/ })).toBeVisible();

  expect(state.listRequests).toHaveLength(2);
  expect(state.listRequests[1]).toEqual({ sourceType: null, sourceId: null });

  // Browser back re-applies the scoped URL and reloads that pair.
  await page.goBack();
  await expect(banner).toBeVisible();
  await expect.poll(() => state.listRequests.length).toBe(3);
  expect(state.listRequests[2]).toEqual({ sourceType: 'POLICY', sourceId: policyId });
});

test('rejects a partial or malformed source filter without sending a half pair', async ({ page }) => {
  const state = await installNotificationMock(page, [notification()]);

  await page.goto('/?sourceType=DIRECT_CLAIM');
  await expect(page.getByTestId('source-filter-error')).toContainText(
    'Enter the source record id for the Direct claim source.'
  );
  await expect(page.getByTestId('source-filter-banner')).toHaveCount(0);

  await page.goto('/?sourceType=RETROCESSION');
  await expect(page.getByTestId('source-filter-error')).toContainText(
    'Enter the source record id for the Retrocession source.'
  );
  await expect(page.getByTestId('source-filter-banner')).toHaveCount(0);

  await page.goto(`/?sourceId=${uuid(202)}`);
  await expect(page.getByTestId('source-filter-error')).toContainText(
    'Select a source type before filtering by a source record id.'
  );
  await expect(page.getByTestId('source-filter-banner')).toHaveCount(0);

  await page.goto(`/?sourceType=NOT_A_SOURCE&sourceId=${uuid(203)}`);
  await expect(page.getByTestId('source-filter-error')).toContainText(
    "Source type 'NOT_A_SOURCE' is not one of:"
  );
  await expect(page.getByTestId('source-filter-banner')).toHaveCount(0);

  await page.goto('/?sourceType=POLICY&sourceId=not-a-uuid');
  await expect(page.getByTestId('source-filter-error')).toHaveText('Source record id must be a UUID.');
  await expect(page.getByTestId('source-filter-banner')).toHaveCount(0);

  expect(state.listRequests.length).toBeGreaterThanOrEqual(4);
  expect(
    state.listRequests.every((request) => !request.sourceType && !request.sourceId)
  ).toBe(true);
});

test('applies a source filter for a newly supported source type', async ({ page }) => {
  const cessionId = uuid(205);
  const row = notification({
    id: uuid(5),
    notificationNumber: 'NTF-2026-000000005',
    subject: 'Cession confirmed',
    sourceType: 'CESSION',
    sourceId: cessionId,
    sourceReference: 'CES-2026-0000001'
  });
  const state = await installNotificationMock(page, [row]);

  // Lowercase proves the expanded type set is normalized before the request.
  await page.goto(`/?sourceType=cession&sourceId=${cessionId}`);

  const banner = page.getByTestId('source-filter-banner');
  await expect(banner).toContainText('Cession');
  await expect(banner).toContainText('CES-2026-0000001');
  expect(state.listRequests).toHaveLength(1);
  expect(state.listRequests[0]).toEqual({ sourceType: 'CESSION', sourceId: cessionId });
});

test('falls back to the short source id when the filtered queue has no reference', async ({ page }) => {
  const paymentId = uuid(204);
  const row = notification({
    id: uuid(4),
    notificationNumber: 'NTF-2026-000000004',
    subject: 'Payment received',
    sourceType: 'PAYMENT',
    sourceId: paymentId,
    sourceReference: null
  });
  await installNotificationMock(page, [row]);

  await page.goto(`/?sourceType=PAYMENT&sourceId=${paymentId}`);

  const banner = page.getByTestId('source-filter-banner');
  await expect(banner).toContainText('Payment');
  await expect(page.getByTestId('source-filter-reference')).toHaveText('0192f3a4…');
  await expect(page.getByTestId('source-filter-reference')).toHaveAttribute('title', paymentId);
});

test('keeps ?new=1 source parameters as create prefill instead of a queue filter', async ({ page }) => {
  const contractId = uuid(300);
  const sourceReference = 'CTR-2026-0000007';
  const state = await installNotificationMock(page, [notification()]);

  const query = new URLSearchParams({
    new: '1',
    sourceType: 'CONTRACT',
    sourceId: contractId,
    sourceReference
  });
  await page.goto(`/?${query}`);

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Source type')).toHaveValue('CONTRACT');
  await expect(dialog.getByLabel('Source record id')).toHaveValue(contractId);
  await expect(dialog.getByLabel('Source reference')).toHaveValue(sourceReference);

  await expect(page.getByTestId('source-filter-banner')).toHaveCount(0);
  await expect(page.getByTestId('source-filter-error')).toHaveCount(0);

  expect(state.listRequests).toHaveLength(1);
  expect(state.listRequests[0]).toEqual({ sourceType: null, sourceId: null });
});
