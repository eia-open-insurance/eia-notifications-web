import { test, expect } from '@playwright/test';

const TENANT = '11111111-1111-7111-8111-111111111111';
const API = '**/api/v1/notifications**';

function notification(overrides = {}) {
  return {
    id: '0192f3a4-0000-7000-8000-000000000001',
    tenantId: TENANT,
    notificationNumber: 'NTF-2026-000000001',
    notificationType: 'NEW_CLAIM_NOTICE',
    channel: 'EMAIL',
    status: 'CREATED',
    recipientPartyId: '0192f3a4-0000-7000-8000-000000000002',
    subject: 'Claim requires attention',
    body: 'Claim CLM-2026-000000001 requires attention.',
    templateCode: 'CLAIM_NOTICE_STANDARD',
    templateVersion: 1,
    scheduledAt: null,
    sentAt: null,
    version: 0,
    createdAt: '2026-10-19T12:00:00Z',
    updatedAt: '2026-10-19T12:00:00Z',
    ...overrides
  };
}

async function json(route, status, body, headers = {}) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    headers,
    body: JSON.stringify(body)
  });
}

function problem(code, detail, status = 400) {
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

test('renders the operational record layout and sends a notification from the record header', async ({ page }) => {
  let notifications = [
    notification(),
    notification({
      id: '0192f3a4-0000-7000-8000-000000000003',
      notificationNumber: 'NTF-2026-000000002',
      notificationType: 'POLICY_BOUND',
      channel: 'IN_APP',
      status: 'SENT',
      subject: 'Policy bound notice',
      body: 'Policy POL-2026-0000001 has been bound.',
      templateCode: 'POLICY_BOUND_STANDARD',
      templateVersion: 2,
      sentAt: '2026-10-19T14:05:00Z'
    })
  ];
  let detailRequests = 0;
  let sendRequests = 0;

  await page.route(API, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();

    if (method === 'GET' && url.pathname === '/api/v1/notifications') {
      await json(route, 200, notifications);
      return;
    }

    if (method === 'GET' && url.pathname.startsWith('/api/v1/notifications/')) {
      detailRequests += 1;
      const id = url.pathname.split('/').pop();
      const found = notifications.find((row) => row.id === id);
      if (!found) {
        await json(route, 404, problem('EIA-NTF-9001', 'Notification was not found.', 404));
        return;
      }
      await json(route, 200, found);
      return;
    }

    if (method === 'POST' && url.pathname.endsWith('/send')) {
      sendRequests += 1;
      const id = url.pathname.split('/')[4];
      notifications = notifications.map((row) =>
        row.id === id
          ? {
              ...row,
              status: 'SENT',
              sentAt: '2026-10-19T15:30:00Z',
              updatedAt: '2026-10-19T15:30:00Z',
              version: row.version + 1
            }
          : row
      );
      await json(route, 200, notifications.find((row) => row.id === id));
      return;
    }

    await route.fulfill({ status: 404, body: 'unexpected route' });
  });

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
  await expect(page.getByText('Operations · Notifications')).toBeVisible();
  await expect(page.locator('.eia-record-layout')).toBeVisible();
  await expect(page.locator('.eia-record-list')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open record NTF-2026-000000001' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open record NTF-2026-000000002' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'NTF-2026-000000001' })).toBeVisible();
  await expect(page.getByText('Claim requires attention').first()).toBeVisible();

  const summaryValues = page.locator('.eia-summary-grid .value');
  await expect(summaryValues).toHaveCount(4);
  await expect(page.getByTestId('summary-channel')).toHaveText('EMAIL');
  await expect(page.getByTestId('summary-status')).toHaveText('CREATED');
  await expect(page.getByTestId('summary-scheduled')).toHaveText('—');
  await expect(page.getByTestId('summary-sent')).toHaveText('—');
  await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');

  await page.getByRole('tab', { name: 'Delivery' }).click();
  await expect(page.getByTestId('delivery-table')).toBeVisible();
  await expect(page.getByTestId('delivery-table')).toContainText('EMAIL');
  await expect(page.getByTestId('delivery-table')).toContainText('CREATED');

  await page.getByRole('tab', { name: 'Template' }).click();
  await expect(page.getByTestId('template-table')).toContainText('CLAIM_NOTICE_STANDARD');
  await expect(page.getByTestId('template-table')).toContainText('1');

  await page.getByRole('button', { name: 'Open record NTF-2026-000000002' }).click();
  await expect(page.getByRole('heading', { name: 'NTF-2026-000000002' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();

  await page.getByRole('button', { name: 'Open record NTF-2026-000000001' }).click();
  await expect(page.getByRole('heading', { name: 'NTF-2026-000000001' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();

  await page.getByRole('button', { name: 'Send', exact: true }).click();

  await expect(page.getByRole('status')).toContainText('NTF-2026-000000001 sent.');
  await expect(page.getByTestId('notification-status')).toHaveText('SENT');
  await expect(page.getByTestId('summary-status')).toHaveText('SENT');
  await expect(page.getByTestId('summary-sent')).not.toHaveText('—');
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  expect(sendRequests).toBe(1);
  expect(detailRequests).toBeGreaterThanOrEqual(3);
});

test('creates a notification through the modal and preserves the API payload', async ({ page }) => {
  let notifications = [notification()];
  let createdPayload = null;

  await page.route(API, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();

    if (method === 'GET' && url.pathname === '/api/v1/notifications') {
      await json(route, 200, notifications);
      return;
    }

    if (method === 'GET' && url.pathname.startsWith('/api/v1/notifications/')) {
      const id = url.pathname.split('/').pop();
      const found = notifications.find((row) => row.id === id);
      await json(route, found ? 200 : 404, found || problem('EIA-NTF-9001', 'Notification was not found.', 404));
      return;
    }

    if (method === 'POST' && url.pathname === '/api/v1/notifications') {
      createdPayload = request.postDataJSON();
      const created = notification({
        ...createdPayload,
        id: '0192f3a4-0000-7000-8000-000000000004',
        notificationNumber: 'NTF-2026-000000003',
        status: 'CREATED',
        version: 0,
        createdAt: '2026-10-19T13:00:00Z',
        updatedAt: '2026-10-19T13:00:00Z'
      });
      notifications = [created, ...notifications];
      await json(route, 201, created);
      return;
    }

    await route.fulfill({ status: 404, body: 'unexpected route' });
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'NTF-2026-000000001' })).toBeVisible();

  await page.getByRole('button', { name: 'Create notification' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  await dialog.getByLabel('Notification type').selectOption('PAYMENT_AUTHORITY_REQUEST');
  await dialog.getByLabel('Channel').selectOption('EMAIL');
  await dialog.getByLabel('Subject').fill('Payment authority required');
  await dialog.getByLabel('Body').fill('Payment PAY-2026-000000001 requires approval.');
  await dialog.getByLabel('Scheduled at (optional)').fill('2026-10-21T09:30');
  await dialog.getByRole('button', { name: 'Create notification' }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByRole('status')).toContainText('NTF-2026-000000003 created.');
  await expect(page.getByRole('button', { name: 'Open record NTF-2026-000000003' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'NTF-2026-000000003' })).toBeVisible();
  await expect(page.getByTestId('summary-channel')).toHaveText('EMAIL');
  await expect(page.getByTestId('summary-status')).toHaveText('CREATED');
  await expect(page.getByTestId('summary-scheduled')).not.toHaveText('—');

  expect(createdPayload).toMatchObject({
    notificationType: 'PAYMENT_AUTHORITY_REQUEST',
    channel: 'EMAIL',
    recipientPartyId: '0192f3a4-0000-7000-8000-000000000002',
    subject: 'Payment authority required',
    body: 'Payment PAY-2026-000000001 requires approval.',
    templateCode: 'CLAIM_NOTICE_STANDARD',
    templateVersion: 1
  });
  expect(createdPayload.scheduledAt).toBe(new Date('2026-10-21T09:30').toISOString());
});

test('surfaces problem errors from the send transition', async ({ page }) => {
  await page.route(API, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();

    if (method === 'GET' && url.pathname === '/api/v1/notifications') {
      await json(route, 200, [notification({ scheduledAt: '2027-01-01T00:00:00Z' })]);
      return;
    }

    if (method === 'GET' && url.pathname.startsWith('/api/v1/notifications/')) {
      await json(route, 200, notification({ scheduledAt: '2027-01-01T00:00:00Z' }));
      return;
    }

    if (method === 'POST' && url.pathname.endsWith('/send')) {
      await json(
        route,
        400,
        problem(
          'EIA-NTF-9301',
          'Notification is scheduled for 2027-01-01T00:00:00Z and cannot be sent before it is due.'
        )
      );
      return;
    }

    await route.fulfill({ status: 404, body: 'unexpected route' });
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'NTF-2026-000000001' })).toBeVisible();
  await page.getByRole('button', { name: 'Send', exact: true }).click();

  await expect(page.getByRole('alert')).toHaveText(
    'EIA-NTF-9301: Notification is scheduled for 2027-01-01T00:00:00Z and cannot be sent before it is due.'
  );
  await expect(page.getByTestId('notification-status')).toHaveText('CREATED');
});

test('surfaces problem errors when the notification list cannot be loaded', async ({ page }) => {
  await page.route(API, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'GET' && url.pathname === '/api/v1/notifications') {
      await json(
        route,
        502,
        problem(
          'EIA-NTF-9601',
          'The Notifications expert service could not be reached: connection refused',
          502
        )
      );
      return;
    }
    await route.fulfill({ status: 404, body: 'unexpected route' });
  });

  await page.goto('/');

  await expect(page.getByRole('alert')).toHaveText(
    'EIA-NTF-9601: The Notifications expert service could not be reached: connection refused'
  );
  await expect(page.getByText('No notifications yet. Use Create notification to open the first record.')).toBeVisible();
});
