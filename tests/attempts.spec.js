import { test, expect } from '@playwright/test';

const TENANT = '11111111-1111-7111-8111-111111111111';
const NOTIFICATION_ID = '0192f3a4-0000-7000-8000-000000000001';
const SECOND_NOTIFICATION_ID = '0192f3a4-0000-7000-8000-000000000003';
const RECIPIENT_ID = '0192f3a4-0000-7000-8000-000000000002';
const API = '**/api/v1/notifications**';

function notification(overrides = {}) {
  return {
    id: NOTIFICATION_ID,
    tenantId: TENANT,
    notificationNumber: 'NTF-2026-000000001',
    notificationType: 'NEW_CLAIM_NOTICE',
    channel: 'EMAIL',
    status: 'SENT',
    recipientPartyId: RECIPIENT_ID,
    subject: 'Claim requires attention',
    body: 'Claim CLM-2026-000000001 requires attention.',
    templateCode: 'CLAIM_NOTICE_STANDARD',
    templateVersion: 1,
    scheduledAt: null,
    sentAt: '2026-10-20T09:30:00Z',
    deliveredAt: '2026-10-20T09:31:00Z',
    provider: 'SIMULATOR',
    providerReference: 'SIM-0192f3a4-0000-7000-8000-000000000001',
    version: 1,
    createdAt: '2026-10-19T12:00:00Z',
    updatedAt: '2026-10-20T09:31:00Z',
    ...overrides
  };
}

function attempt(overrides = {}) {
  return {
    id: '0192f3a4-0000-7000-8000-0000000000a1',
    notificationId: NOTIFICATION_ID,
    attemptNumber: 1,
    provider: 'SIMULATOR',
    status: 'DELIVERED',
    providerReference: 'SIM-0192f3a4-0000-7000-8000-000000000001',
    attemptedAt: '2026-10-20T09:31:00Z',
    errorCode: null,
    errorMessage: null,
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

function problem(code, detail, status = 503) {
  return {
    type: `https://errors.eia-open-insurance.example/notifications/${code.toLowerCase()}`,
    title: 'Notification request rejected',
    status,
    detail,
    code,
    category: 'INFRASTRUCTURE',
    retryable: true
  };
}

/**
 * Stateful mock of the notification record, send, and per-attempt endpoints.
 * `attempts` is either an array or an async responder `(route, notificationId)`
 * so a test can fail the first request and succeed on retry.
 */
async function installMock(page, { queue, attempts = [] } = {}) {
  const state = {
    queue: (queue || [notification()]).map((row) => ({ ...row })),
    attemptsRequests: [],
    detailRequests: 0,
    attemptResponses: typeof attempts === 'function' ? attempts : null,
    attempts
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

    const attemptsMatch = path.match(/^\/api\/v1\/notifications\/([^/]+)\/attempts$/);
    if (method === 'GET' && attemptsMatch) {
      state.attemptsRequests.push({
        path,
        notificationId: attemptsMatch[1],
        headers: request.headers()
      });
      if (state.attemptResponses) {
        await state.attemptResponses(route, attemptsMatch[1]);
        return;
      }
      await json(route, 200, state.attempts);
      return;
    }

    if (method === 'GET' && /^\/api\/v1\/notifications\/[^/]+$/.test(path)) {
      state.detailRequests += 1;
      const found = state.queue.find((row) => row.id === path.split('/').pop());
      await json(
        route,
        found ? 200 : 404,
        found || problem('EIA-NTF-9001', 'Notification was not found.', 404)
      );
      return;
    }

    if (method === 'POST' && path.endsWith('/send')) {
      const id = path.split('/')[4];
      const sent = {
        ...state.queue.find((row) => row.id === id),
        status: 'SENT',
        sentAt: '2026-10-20T09:30:00Z'
      };
      state.queue = state.queue.map((row) => (row.id === id ? sent : row));
      await json(route, 200, sent);
      return;
    }

    await route.fulfill({ status: 404, body: `unexpected ${method} ${path}` });
  });

  return state;
}

async function openDelivery(page) {
  await page.getByRole('tab', { name: 'Delivery' }).click();
  return page.getByTestId('notification-attempts');
}

test('loads the attempt history on record open and renders every delivery column', async ({ page }) => {
  const second = notification({
    id: SECOND_NOTIFICATION_ID,
    notificationNumber: 'NTF-2026-000000002',
    subject: 'Policy bound notice',
    status: 'DELIVERED',
    sentAt: '2026-10-20T10:00:00Z',
    deliveredAt: '2026-10-20T10:01:00Z',
    providerReference: 'SIM-0192f3a4-0000-7000-8000-000000000003',
    version: 2
  });
  const state = await installMock(page, {
    queue: [notification(), second],
    attempts: (route, notificationId) =>
      notificationId === SECOND_NOTIFICATION_ID
        ? json(route, 200, {
            notificationId: SECOND_NOTIFICATION_ID,
            items: [
              attempt({
                id: '0192f3a4-0000-7000-8000-0000000000b1',
                notificationId: SECOND_NOTIFICATION_ID,
                providerReference: 'SIM-0192f3a4-0000-7000-8000-000000000003'
              })
            ]
          })
        : json(route, 200, [
            attempt({
              id: '0192f3a4-0000-7000-8000-0000000000a1',
              status: 'FAILED',
              providerReference: null,
              attemptedAt: '2026-10-20T09:29:00Z',
              errorCode: 'SIMULATED_TIMEOUT',
              errorMessage: 'Simulated provider timeout'
            }),
            attempt({
              id: '0192f3a4-0000-7000-8000-0000000000a2',
              attemptNumber: 2,
              attemptedAt: '2026-10-20T09:31:00Z'
            })
          ])
  });

  await page.goto(`/?record=${NOTIFICATION_ID}`);
  await expect(page.getByRole('heading', { name: 'NTF-2026-000000001' })).toBeVisible();

  // The history is fetched when the record opens, before the Delivery tab is selected.
  await expect.poll(() => state.attemptsRequests.length).toBe(1);
  expect(state.attemptsRequests[0].path).toBe(
    `/api/v1/notifications/${NOTIFICATION_ID}/attempts`
  );
  expect(state.attemptsRequests[0].headers['x-eia-tenant']).toBe(TENANT);

  const card = await openDelivery(page);
  await expect(card.getByTestId('attempts-count')).toHaveText('2 attempts');
  await expect(card.getByTestId('attempts-table')).toBeVisible();

  const rows = card.getByTestId('attempt-row');
  await expect(rows).toHaveCount(2);

  const failed = rows.nth(0);
  await expect(failed.getByTestId('attempt-number')).toHaveText('#1');
  await expect(failed.getByTestId('attempt-provider')).toContainText('Local simulated delivery');
  await expect(failed.getByTestId('attempt-provider-code')).toHaveText('SIMULATOR');
  await expect(failed.getByTestId('attempt-status')).toHaveText('FAILED');
  await expect(failed.getByTestId('attempt-status')).toHaveClass(/red/);
  await expect(failed.getByTestId('attempt-reference')).toHaveText('—');
  await expect(failed.getByTestId('attempt-time')).toHaveAttribute(
    'dateTime',
    '2026-10-20T09:29:00Z'
  );
  await expect(failed.getByTestId('attempt-error')).toHaveText('Simulated provider timeout');

  const delivered = rows.nth(1);
  await expect(delivered.getByTestId('attempt-number')).toHaveText('#2');
  await expect(delivered.getByTestId('attempt-status')).toHaveText('DELIVERED');
  await expect(delivered.getByTestId('attempt-status')).toHaveClass(/green/);
  await expect(delivered.getByTestId('attempt-reference')).toHaveText('SIM-0192f3a4-0000-7000-8000-000000000001');
  await expect(delivered.getByTestId('attempt-error')).toHaveText('—');

  // The provider is labelled as the local simulator, with no production adapter.
  await expect(card.getByTestId('attempts-provider-note')).toContainText('local simulated provider');
  await expect(card.getByTestId('attempts-provider-note')).toContainText(
    'No production provider adapter'
  );

  // A different record opened from the queue fetches its own attempt history.
  await page.getByRole('button', { name: 'Open record NTF-2026-000000002' }).click();
  await expect(page.getByRole('heading', { name: 'NTF-2026-000000002' })).toBeVisible();
  await expect.poll(() => state.attemptsRequests.length).toBe(2);
  expect(state.attemptsRequests[1].path).toBe(
    `/api/v1/notifications/${SECOND_NOTIFICATION_ID}/attempts`
  );

  const secondCard = await openDelivery(page);
  await expect(secondCard.getByTestId('attempts-count')).toHaveText('1 attempt');
  await expect(secondCard.getByTestId('attempt-reference')).toHaveText('SIM-0192f3a4-0000-7000-8000-000000000003');
});

test('explains that a CREATED notification has no attempt yet', async ({ page }) => {
  const state = await installMock(page, {
    queue: [
      notification({
        status: 'CREATED',
        sentAt: null,
        deliveredAt: null,
        provider: null,
        providerReference: null,
        version: 0
      })
    ],
    attempts: []
  });

  await page.goto(`/?record=${NOTIFICATION_ID}`);
  await expect(page.getByRole('heading', { name: 'NTF-2026-000000001' })).toBeVisible();
  await expect.poll(() => state.attemptsRequests.length).toBe(1);

  const card = await openDelivery(page);
  await expect(card.getByTestId('attempts-count')).toHaveText('0 attempts');
  const empty = card.getByTestId('attempts-empty');
  await expect(empty).toContainText('No delivery attempts yet.');
  await expect(empty).toContainText('CREATED');
  await expect(empty).toContainText('has not been sent');
  await expect(empty).toContainText('first attempt is recorded when the send transition runs');
  await expect(card.getByTestId('attempts-table')).toHaveCount(0);
  await expect(card.getByTestId('attempts-error')).toHaveCount(0);
  await expect(page.getByTestId('notification-status')).toHaveText('CREATED');
});

test('contains a failing attempts read inside the Delivery tab and retries on demand', async ({ page }) => {
  let fail = true;
  const state = await installMock(page, {
    queue: [notification()],
    attempts: async (route) => {
      if (fail) {
        await json(
          route,
          503,
          problem(
            'EIA-NTF-9602',
            'The delivery-attempt projection is unavailable; retry later.'
          )
        );
        return;
      }
      await json(route, 200, [attempt()]);
    }
  });

  await page.goto(`/?record=${NOTIFICATION_ID}`);
  await expect(page.getByRole('heading', { name: 'NTF-2026-000000001' })).toBeVisible();
  await expect.poll(() => state.attemptsRequests.length).toBe(1);

  const card = await openDelivery(page);
  const error = card.getByTestId('attempts-error');
  await expect(error).toContainText('Delivery attempts are temporarily unavailable.');
  await expect(error).toContainText('EIA-NTF-9602');
  await expect(card.getByTestId('attempts-count')).toHaveText('0 attempts');
  await expect(card.getByTestId('attempts-table')).toHaveCount(0);

  // The failure is card-local: the record header and overview stay readable.
  await expect(page.getByTestId('notification-status')).toHaveText('SENT');
  await page.getByRole('tab', { name: 'Overview' }).click();
  await expect(page.getByRole('region', { name: 'Notification details' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Notification details' })).toContainText(
    'NTF-2026-000000001'
  );

  fail = false;
  await page.getByRole('tab', { name: 'Delivery' }).click();
  await card.getByTestId('attempts-refresh').click();
  await expect.poll(() => state.attemptsRequests.length).toBe(2);
  await expect(card.getByTestId('attempts-count')).toHaveText('1 attempt');
  await expect(card.getByTestId('attempts-error')).toHaveCount(0);
  await expect(card.getByTestId('attempt-row')).toHaveCount(1);
});

test('shows the provider reference and deliveredAt in the Sent card and record details', async ({ page }) => {
  await installMock(page, {
    queue: [notification({ status: 'DELIVERED' })],
    attempts: [attempt()]
  });

  await page.goto(`/?record=${NOTIFICATION_ID}`);
  await expect(page.getByRole('heading', { name: 'NTF-2026-000000001' })).toBeVisible();

  await expect(page.getByTestId('summary-provider-reference')).toHaveText('SIM-0192f3a4-0000-7000-8000-000000000001');
  await expect(page.getByTestId('summary-delivered')).not.toHaveText('—');

  const details = page.getByRole('region', { name: 'Notification details' });
  await expect(details.getByTestId('overview-provider-reference')).toHaveText('SIM-0192f3a4-0000-7000-8000-000000000001');
  await expect(details.getByTestId('overview-delivered')).not.toHaveText('—');
  await expect(details.getByTestId('overview-sent')).not.toHaveText('—');

  await page.getByRole('tab', { name: 'Delivery' }).click();
  await expect(page.getByTestId('delivery-provider-reference')).toHaveText('SIM-0192f3a4-0000-7000-8000-000000000001');
  await expect(page.getByTestId('delivery-delivered')).not.toHaveText('—');
  await expect(page.getByTestId('delivery-table')).toContainText('SIM-0192f3a4-0000-7000-8000-000000000001');
  await expect(page.getByTestId('delivery-table')).toContainText('DELIVERED');
});
