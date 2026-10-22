import { test, expect } from '@playwright/test';

const TENANT = '11111111-1111-7111-8111-111111111111';
const NOTIFICATION_API = '**/api/v1/notifications**';
const PARTY_SEARCH = '**/api/v1/parties/search**';

const PARTY = {
  id: '0192f3a4-0000-7000-8000-000000000002',
  type: 'PARTY',
  label: 'PTY-2026-000001',
  secondary: 'Acme Manufacturing · ORGANIZATION',
  status: 'ACTIVE',
  href: '/party?record=0192f3a4-0000-7000-8000-000000000002'
};

const OTHER_PARTY_ID = '0192f3a4-0000-7000-8000-000000000007';

const NOTIFICATION_A = {
  id: '0192f3a4-0000-7000-8000-000000000001',
  tenantId: TENANT,
  notificationNumber: 'NTF-2026-000000001',
  notificationType: 'NEW_CLAIM_NOTICE',
  channel: 'EMAIL',
  status: 'CREATED',
  recipientPartyId: PARTY.id,
  subject: 'Claim requires attention',
  body: 'Claim CLM-2026-000000001 requires attention.',
  templateCode: 'CLAIM_NOTICE_STANDARD',
  templateVersion: 1,
  scheduledAt: null,
  sentAt: null,
  version: 0,
  createdAt: '2026-10-19T12:00:00Z',
  updatedAt: '2026-10-19T12:00:00Z'
};

const NOTIFICATION_B = {
  id: '0192f3a4-0000-7000-8000-000000000003',
  tenantId: TENANT,
  notificationNumber: 'NTF-2026-000000002',
  notificationType: 'POLICY_BOUND',
  channel: 'IN_APP',
  status: 'SENT',
  recipientPartyId: OTHER_PARTY_ID,
  subject: 'Policy bound notice',
  body: 'Policy POL-2026-0000001 has been bound.',
  templateCode: 'POLICY_BOUND_STANDARD',
  templateVersion: 2,
  scheduledAt: null,
  sentAt: '2026-10-19T14:05:00Z',
  version: 1,
  createdAt: '2026-10-19T13:00:00Z',
  updatedAt: '2026-10-19T14:05:00Z'
};

function searchItem(notification) {
  return {
    id: notification.id,
    type: 'NOTIFICATION',
    label: notification.notificationNumber,
    secondary: `${notification.subject} · ${notification.channel}`,
    status: notification.status,
    href: `/notifications?record=${notification.id}`
  };
}

async function json(route, status, body) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body)
  });
}

function problem(code, detail, status = 404) {
  return {
    type: `https://errors.eia-open-insurance.example/notifications/${code.toLowerCase()}`,
    title: 'Notification request rejected',
    status,
    detail,
    code,
    category: 'BUSINESS_RULE',
    retryable: false
  };
}

/**
 * Stateful mock of the Notifications API plus the search projection. The
 * workbench reads list, search, detail, create, and send; every request is
 * recorded so a test can verify the tenant header and prove which endpoint a
 * flow used.
 */
async function installNotificationMock(page, options = {}) {
  const state = {
    queue: (options.queue || [NOTIFICATION_A, NOTIFICATION_B]).map((row) => ({ ...row })),
    catalogue: (options.catalogue || options.queue || [NOTIFICATION_A, NOTIFICATION_B])
      .map((row) => ({ ...row })),
    requests: [],
    createBody: null
  };

  await page.route(NOTIFICATION_API, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    state.requests.push({
      method,
      path,
      search: url.search,
      headers: request.headers()
    });

    const find = (id) => state.catalogue.find((row) => row.id === id)
      || state.queue.find((row) => row.id === id);

    if (method === 'GET' && path === '/api/v1/notifications') {
      await json(route, 200, state.queue);
      return;
    }

    if (method === 'GET' && path === '/api/v1/notifications/search') {
      const query = (url.searchParams.get('q') || '').trim();
      const limit = Number(url.searchParams.get('limit') || 10);
      const needle = query.toLowerCase();
      const items = state.catalogue
        .filter((notification) =>
          [notification.notificationNumber, notification.subject, notification.recipientPartyId]
            .some((value) => String(value || '').toLowerCase().includes(needle)))
        .slice(0, limit)
        .map(searchItem);
      await json(route, 200, { query, limit, items });
      return;
    }

    if (method === 'GET' && /^\/api\/v1\/notifications\/[^/]+$/.test(path)) {
      const notification = find(path.split('/').pop());
      await json(
        route,
        notification ? 200 : 404,
        notification || problem('EIA-NTF-9001', 'Notification was not found.')
      );
      return;
    }

    if (method === 'POST' && path === '/api/v1/notifications') {
      state.createBody = request.postDataJSON();
      const created = {
        ...NOTIFICATION_A,
        ...state.createBody,
        id: '0192f3a4-0000-7000-8000-000000000099',
        notificationNumber: 'NTF-2026-000000099',
        status: 'CREATED',
        version: 0,
        createdAt: '2026-10-20T09:00:00Z',
        updatedAt: '2026-10-20T09:00:00Z'
      };
      state.queue = [created, ...state.queue];
      state.catalogue = [created, ...state.catalogue];
      await json(route, 201, created);
      return;
    }

    if (method === 'POST' && path.endsWith('/send')) {
      const id = path.split('/')[4];
      const notification = find(id);
      if (!notification) {
        await json(route, 404, problem('EIA-NTF-9001', 'Notification was not found.'));
        return;
      }
      const sent = { ...notification, status: 'SENT', sentAt: '2026-10-19T15:30:00Z' };
      state.queue = state.queue.map((row) => (row.id === id ? sent : row));
      state.catalogue = state.catalogue.map((row) => (row.id === id ? sent : row));
      await json(route, 200, sent);
      return;
    }

    await route.fulfill({ status: 404, body: 'unexpected route' });
  });

  return state;
}

test('opens a notification from ?record= and follows popstate', async ({ page }) => {
  const state = await installNotificationMock(page);

  await page.goto(`/?record=${NOTIFICATION_B.id}`);

  const panel = page.locator('.eia-record-panel');
  await expect(panel.getByRole('heading', { name: NOTIFICATION_B.notificationNumber })).toBeVisible();
  await expect(page.getByTestId('notification-status')).toHaveText('SENT');
  await expect(page).toHaveURL(new RegExp(`record=${NOTIFICATION_B.id}$`));

  await page
    .locator('aside[aria-label="Notification queue"] button')
    .filter({ hasText: NOTIFICATION_A.notificationNumber })
    .click();
  await expect(panel.getByRole('heading', { name: NOTIFICATION_A.notificationNumber })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`record=${NOTIFICATION_A.id}$`));

  // Browser back fires popstate; the record requested by the URL is re-applied.
  await page.goBack();
  await expect(panel.getByRole('heading', { name: NOTIFICATION_B.notificationNumber })).toBeVisible();
  await expect(page.getByTestId('notification-status')).toHaveText('SENT');
  await expect(page).toHaveURL(new RegExp(`record=${NOTIFICATION_B.id}$`));

  expect(state.requests.every((request) => request.headers['x-eia-tenant'] === TENANT)).toBe(true);
});

test('resolves a deep-linked notification number through the search projection', async ({ page }) => {
  const state = await installNotificationMock(page, {
    queue: [NOTIFICATION_A],
    catalogue: [NOTIFICATION_A, NOTIFICATION_B]
  });

  await page.goto(`/?record=${NOTIFICATION_B.notificationNumber}`);

  await expect(
    page.locator('.eia-record-panel').getByRole('heading', { name: NOTIFICATION_B.notificationNumber })
  ).toBeVisible();
  await expect(page.getByTestId('notification-status')).toHaveText('SENT');

  const searchRequest = state.requests.find(
    (request) => request.method === 'GET' && request.path === '/api/v1/notifications/search'
  );
  expect(searchRequest).toBeTruthy();
  expect(new URLSearchParams(searchRequest.search).get('q')).toBe(NOTIFICATION_B.notificationNumber);
  expect(new URLSearchParams(searchRequest.search).get('limit')).toBe('10');
  expect(state.requests.some(
    (request) => request.method === 'GET'
      && request.path === `/api/v1/notifications/${NOTIFICATION_B.id}`
  )).toBe(true);
});

test('opens Create notification from ?new=1 and keeps the URL in step', async ({ page }) => {
  await installNotificationMock(page);

  await page.goto('/?new=1');

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Create notification' })).toBeVisible();
  await expect(page).toHaveURL(/new=1/);

  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
  await expect(page).not.toHaveURL(/new=1/);

  await page.getByRole('button', { name: 'Create notification' }).click();
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/new=1/);

  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(page).not.toHaveURL(/new=1/);

  // Browser back fires popstate and re-opens the dialog from ?new=1.
  await page.goBack();
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/new=1/);
});

test('seeds every create field from ?new=1 prefill parameters', async ({ page }) => {
  const state = await installNotificationMock(page, {
    queue: [NOTIFICATION_A],
    catalogue: [NOTIFICATION_A]
  });

  const subject = 'Dunning notice: premium overdue';
  const body = 'Policy POL-2026-0000001 premium is 30 days overdue.';
  const query = new URLSearchParams({
    new: '1',
    notificationType: 'DUNNING_NOTICE',
    channel: 'EMAIL',
    recipientPartyId: OTHER_PARTY_ID,
    subject,
    body,
    templateCode: 'DUNNING_NOTICE_STANDARD'
  });

  await page.goto(`/?${query}`);

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Notification type')).toHaveValue('DUNNING_NOTICE');
  await expect(dialog.getByLabel('Channel')).toHaveValue('EMAIL');
  await expect(dialog.getByLabel('Subject')).toHaveValue(subject);
  await expect(dialog.getByLabel('Body')).toHaveValue(body);
  await expect(dialog.getByLabel('Template code')).toHaveValue('DUNNING_NOTICE_STANDARD');
  await expect(dialog.getByTestId('recipient-party-label')).toHaveText('0192f3a4…');
  await expect(dialog.locator('.eia-mono')).toHaveText(OTHER_PARTY_ID);

  await dialog.getByRole('button', { name: 'Create notification' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('status')).toContainText('NTF-2026-000000099 created.');

  expect(state.createBody).toMatchObject({
    notificationType: 'DUNNING_NOTICE',
    channel: 'EMAIL',
    recipientPartyId: OTHER_PARTY_ID,
    subject,
    body,
    templateCode: 'DUNNING_NOTICE_STANDARD',
    templateVersion: 1
  });
});

test('keeps create defaults for fields a partial prefill omits', async ({ page }) => {
  await installNotificationMock(page, {
    queue: [NOTIFICATION_A],
    catalogue: [NOTIFICATION_A]
  });

  const query = new URLSearchParams({
    new: '1',
    subject: 'Partial prefill subject',
    templateCode: 'PARTIAL_TEMPLATE'
  });
  await page.goto(`/?${query}`);

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Notification type')).toHaveValue('NEW_CLAIM_NOTICE');
  await expect(dialog.getByLabel('Channel')).toHaveValue('IN_APP');
  await expect(dialog.getByLabel('Subject')).toHaveValue('Partial prefill subject');
  await expect(dialog.getByLabel('Body')).toHaveValue('');
  await expect(dialog.getByLabel('Template code')).toHaveValue('PARTIAL_TEMPLATE');
  await expect(dialog.getByTestId('recipient-party-label')).toContainText('Demo recipient');
  await expect(dialog.locator('.eia-mono')).toHaveText(PARTY.id);
});

test('falls back to the demo recipient when a prefilled recipientPartyId is not a UUID', async ({ page }) => {
  const state = await installNotificationMock(page, {
    queue: [NOTIFICATION_A],
    catalogue: [NOTIFICATION_A]
  });

  const query = new URLSearchParams({
    new: '1',
    notificationType: 'DUNNING_NOTICE',
    recipientPartyId: 'not-a-uuid',
    subject: 'Invalid recipient fallback',
    body: 'The prefilled recipient was malformed.'
  });
  await page.goto(`/?${query}`);

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Notification type')).toHaveValue('DUNNING_NOTICE');
  await expect(dialog.getByTestId('recipient-party-label')).toContainText('Demo recipient');
  await expect(dialog.locator('.eia-mono')).toHaveText(PARTY.id);

  await dialog.getByRole('button', { name: 'Create notification' }).click();
  await expect(dialog).toBeHidden();
  expect(state.createBody.recipientPartyId).toBe(PARTY.id);
});

test('opens an empty create draft for ?new=1 without prefill parameters', async ({ page }) => {
  await installNotificationMock(page, {
    queue: [NOTIFICATION_A],
    catalogue: [NOTIFICATION_A]
  });

  await page.goto('/?new=1');

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Notification type')).toHaveValue('NEW_CLAIM_NOTICE');
  await expect(dialog.getByLabel('Channel')).toHaveValue('IN_APP');
  await expect(dialog.getByLabel('Subject')).toHaveValue('');
  await expect(dialog.getByLabel('Body')).toHaveValue('');
  await expect(dialog.getByLabel('Template code')).toHaveValue('CLAIM_NOTICE_STANDARD');
  await expect(dialog.getByTestId('recipient-party-label')).toContainText('Demo recipient');
  await expect(page).toHaveURL(/new=1/);
});

test('does not reseed an edited draft or a normally opened create dialog', async ({ page }) => {
  await installNotificationMock(page, {
    queue: [NOTIFICATION_A],
    catalogue: [NOTIFICATION_A]
  });

  const query = new URLSearchParams({
    new: '1',
    subject: 'Prefilled subject',
    body: 'Prefilled body',
    templateCode: 'DUNNING_NOTICE_STANDARD'
  });
  await page.goto(`/?${query}`);

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Subject')).toHaveValue('Prefilled subject');

  await dialog.getByLabel('Subject').fill('Edited subject');
  await dialog.getByLabel('Body').fill('Edited body');

  // A popstate with the prefill URL still current never overwrites the draft.
  await page.evaluate(() => window.dispatchEvent(new PopStateEvent('popstate')));
  await expect(dialog.getByLabel('Subject')).toHaveValue('Edited subject');
  await expect(dialog.getByLabel('Body')).toHaveValue('Edited body');

  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();

  // Opening create normally always starts from the defaults.
  await page.getByRole('button', { name: 'Create notification' }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Subject')).toHaveValue('');
  await expect(dialog.getByLabel('Body')).toHaveValue('');
  await expect(dialog.getByLabel('Template code')).toHaveValue('CLAIM_NOTICE_STANDARD');
  await expect(page).toHaveURL(/new=1/);
  await expect(page).not.toHaveURL(/templateCode|subject=/);
});

test('ignores prefill parameters on a record link', async ({ page }) => {
  await installNotificationMock(page);

  const query = new URLSearchParams({
    record: NOTIFICATION_B.id,
    notificationType: 'DUNNING_NOTICE',
    subject: 'Ignored prefill subject',
    recipientPartyId: OTHER_PARTY_ID
  });
  await page.goto(`/?${query}`);

  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.locator('.eia-record-panel').getByRole('heading', { name: NOTIFICATION_B.notificationNumber })
  ).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`record=${NOTIFICATION_B.id}`));
});

test('filters the notification queue by number, subject, recipient, channel, and status', async ({ page }) => {
  const state = await installNotificationMock(page);

  await page.goto('/');

  const queue = page.locator('aside[aria-label="Notification queue"]');
  const filter = page.getByPlaceholder(
    'Filter notifications by number, subject, recipient, channel, or status…'
  );
  const notificationA = queue.getByRole('button', { name: /NTF-2026-000000001/ });
  const notificationB = queue.getByRole('button', { name: /NTF-2026-000000002/ });

  await expect(filter).toBeVisible();
  await expect(notificationA).toBeVisible();
  await expect(notificationB).toBeVisible();

  for (const term of [
    'NTF-2026-000000002',
    'Policy bound',
    OTHER_PARTY_ID,
    'IN_APP',
    'SENT'
  ]) {
    await filter.fill(term);
    await expect(notificationB).toBeVisible();
    await expect(notificationA).toHaveCount(0);
  }

  await filter.fill('EMAIL');
  await expect(notificationA).toBeVisible();
  await expect(notificationB).toHaveCount(0);
  await expect(page.getByTestId('queue-filter-count')).toHaveText('1 of 2 notifications');

  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(filter).toHaveValue('');
  await expect(notificationA).toBeVisible();
  await expect(notificationB).toBeVisible();
  await expect(page.getByTestId('queue-filter-count')).toHaveText('2');

  await filter.fill('no-such-notification');
  await expect(notificationA).toHaveCount(0);
  await expect(notificationB).toHaveCount(0);
  await expect(page.getByTestId('queue-filter-empty')).toBeVisible();
  await expect(page.getByTestId('queue-filter-empty')).toContainText(
    'No notifications match “no-such-notification”'
  );

  // Filtering stays local to the queue; the search endpoint is not involved.
  expect(state.requests.every((request) => request.path !== '/api/v1/notifications/search')).toBe(true);
});

test('resolves the recipient party through the picker and submits recipientPartyId', async ({ page }) => {
  const state = await installNotificationMock(page, { queue: [NOTIFICATION_A], catalogue: [NOTIFICATION_A] });
  const partyRequests = [];

  await page.route(PARTY_SEARCH, async (route) => {
    const url = new URL(route.request().url());
    partyRequests.push({ url, headers: route.request().headers() });
    await json(route, 200, {
      query: url.searchParams.get('q') || '',
      limit: Number(url.searchParams.get('limit') || 8),
      items: [PARTY]
    });
  });

  await page.goto('/?new=1');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  await dialog.getByPlaceholder('Search by number or name…').fill('Acme');
  await dialog.getByRole('button', { name: /PTY-2026-000001/ }).click();

  await expect(dialog.getByTestId('recipient-party-label')).toContainText('Acme Manufacturing');
  await expect(dialog.getByTestId('recipient-party-link')).toHaveAttribute(
    'href',
    `/party?record=${PARTY.id}`
  );

  await dialog.getByLabel('Subject').fill('Recipient resolved from party search');
  await dialog.getByLabel('Body').fill('This message is addressed through the party picker.');
  await dialog.getByRole('button', { name: 'Create notification' }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByRole('status')).toContainText('NTF-2026-000000099 created.');
  await expect(page).toHaveURL(new RegExp(`record=0192f3a4-0000-7000-8000-000000000099$`));

  expect(state.createBody.recipientPartyId).toBe(PARTY.id);
  expect(state.createBody).not.toHaveProperty('recipientPartyLabel');
  expect(partyRequests).toHaveLength(1);
  expect(partyRequests[0].url.pathname).toBe('/api/v1/parties/search');
  expect(partyRequests[0].url.searchParams.get('q')).toBe('Acme');
  expect(partyRequests[0].url.searchParams.get('limit')).toBe('8');
  expect(partyRequests[0].headers['x-eia-tenant']).toBe(TENANT);
});

test('explains delivery context and shows no source when the notification has none', async ({ page }) => {
  const state = await installNotificationMock(page, {
    queue: [NOTIFICATION_A],
    catalogue: [NOTIFICATION_A]
  });

  await page.goto(`/?record=${NOTIFICATION_A.id}`);

  const context = page.getByTestId('why-this-matters');
  await expect(context).toBeVisible();
  await expect(context).toContainText('notification is a delivery artifact');
  await expect(context).toContainText('template, channel, and status govern');
  await expect(context).toContainText('source record is linked here');
  await expect(context).not.toContainText('not exposed');

  await expect(page.getByTestId('overview-source')).toHaveText('—');
  await expect(page.getByTestId('overview-recipient-link')).toHaveAttribute(
    'href',
    `/party?record=${PARTY.id}`
  );

  const related = page.getByTestId('related-records');
  await expect(related).toBeVisible();
  await expect(related).toContainText('source record that caused this notification');
  await expect(related).not.toContainText('not exposed');
  await expect(page.getByTestId('related-recipient-party-link')).toHaveAttribute(
    'href',
    `/party?record=${PARTY.id}`
  );

  // A notification without a source calls no extra endpoint to invent one.
  expect(state.requests.every((request) => request.path !== '/api/v1/notifications/search')).toBe(true);

  await page.getByTestId('overview-recipient-link').click();
  await expect(page).toHaveURL(new RegExp(`/party\\?record=${PARTY.id}$`));
});

test('resolves the recipient name · party number in the header, Overview, Delivery, and context panel', async ({ page }) => {
  const partyRequests = [];

  await installNotificationMock(page, { queue: [NOTIFICATION_A], catalogue: [NOTIFICATION_A] });
  await page.route(/\/api\/v1\/parties\/[0-9a-f-]+$/i, async (route) => {
    const url = new URL(route.request().url());
    partyRequests.push({
      id: url.pathname.split('/').pop(),
      tenant: route.request().headers()['x-eia-tenant']
    });
    await json(route, 200, {
      id: PARTY.id,
      tenantId: TENANT,
      partyNumber: 'PTY-2026-000001',
      partyType: 'ORGANIZATION',
      displayName: 'Acme Manufacturing',
      legalName: 'Acme Manufacturing, Inc.',
      status: 'ACTIVE'
    });
  });

  await page.goto(`/?record=${NOTIFICATION_A.id}`);

  const label = 'Acme Manufacturing · PTY-2026-000001';
  const href = `/party?record=${PARTY.id}`;

  await expect(page.getByTestId('record-recipient-link')).toHaveText(label);
  await expect(page.getByTestId('record-recipient-link')).toHaveAttribute('href', href);
  await expect(page.getByTestId('overview-recipient-link')).toHaveText(label);
  await expect(page.getByTestId('overview-recipient-link')).toHaveAttribute('href', href);
  await expect(page.getByTestId('context-recipient-link')).toContainText(label);
  await expect(page.getByTestId('context-recipient-link')).toHaveAttribute('href', href);

  await page.getByRole('tab', { name: 'Delivery' }).click();
  await expect(page.getByTestId('delivery-table')).toContainText(label);
  await expect(page.getByTestId('delivery-table').getByRole('link')).toHaveAttribute('href', href);

  expect(partyRequests).toEqual([{ id: PARTY.id, tenant: TENANT }]);
});

test('falls back to the short recipient UUID when the Party API returns 404', async ({ page }) => {
  await installNotificationMock(page, { queue: [NOTIFICATION_A], catalogue: [NOTIFICATION_A] });
  await page.route(/\/api\/v1\/parties\/[0-9a-f-]+$/i, async (route) => {
    await json(route, 404, problem('EIA-NTF-9001', 'Party was not found.', 404));
  });

  await page.goto(`/?record=${NOTIFICATION_A.id}`);

  // The notification record renders while the party lookup is failing.
  await expect(page.getByRole('heading', { name: NOTIFICATION_A.notificationNumber })).toBeVisible();

  const short = '0192f3a4…';
  await expect(page.getByTestId('record-recipient-link')).toHaveText(short);
  await expect(page.getByTestId('overview-recipient-link')).toHaveText(short);
  await expect(page.getByTestId('context-recipient-link')).toContainText(short);
  await expect(page.getByTestId('record-recipient-link')).toHaveAttribute(
    'href',
    `/party?record=${PARTY.id}`
  );

  await page.getByRole('tab', { name: 'Delivery' }).click();
  await expect(page.getByTestId('delivery-table')).toContainText(short);
});
