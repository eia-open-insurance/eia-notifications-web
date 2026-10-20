import { test, expect } from '@playwright/test';

const TENANT = '11111111-1111-7111-8111-111111111111';
const NOTIFICATION_ID = '0192f3a4-0000-7000-8000-000000000001';
const SECOND_NOTIFICATION_ID = '0192f3a4-0000-7000-8000-000000000003';
const RECIPIENT_ID = '0192f3a4-0000-7000-8000-000000000002';
const EVENTS = '**/api/v1/events/aggregate/**';

const CREATED_EVENT_ID = 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeee1';
const SENT_EVENT_ID = 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeee2';

function notification(overrides = {}) {
  return {
    id: NOTIFICATION_ID,
    tenantId: TENANT,
    notificationNumber: 'NTF-2026-000000001',
    notificationType: 'NEW_CLAIM_NOTICE',
    channel: 'EMAIL',
    status: 'CREATED',
    recipientPartyId: RECIPIENT_ID,
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

/**
 * The aggregate endpoint embeds the canonical event envelope in `payload`; the
 * notification facts are in `payload.data`. One helper builds that real shape.
 */
function aggregateEvent({
  eventId,
  eventType,
  occurredAt,
  aggregateVersion,
  aggregateId = NOTIFICATION_ID,
  status = 'PROCESSED',
  data = {},
  payload
}) {
  return {
    eventId,
    eventType,
    eventVersion: 1,
    tenantId: TENANT,
    book: 'DIRECT',
    aggregateType: 'Notification',
    aggregateId,
    aggregateVersion,
    occurredAt,
    receivedAt: occurredAt,
    status,
    payload: payload ?? {
      eventId,
      eventType,
      eventVersion: 1,
      tenantId: TENANT,
      book: 'DIRECT',
      aggregateType: 'Notification',
      aggregateId,
      aggregateVersion,
      occurredAt,
      data
    }
  };
}

function createdEvent() {
  return aggregateEvent({
    eventId: CREATED_EVENT_ID,
    eventType: 'notifications.notification.created',
    occurredAt: '2026-10-19T12:00:00Z',
    aggregateVersion: 1,
    data: {
      notificationId: NOTIFICATION_ID,
      notificationNumber: 'NTF-2026-000000001',
      notificationType: 'NEW_CLAIM_NOTICE',
      channel: 'EMAIL',
      recipientPartyId: RECIPIENT_ID,
      status: 'CREATED',
      version: 0
    }
  });
}

function sentEvent() {
  return aggregateEvent({
    eventId: SENT_EVENT_ID,
    eventType: 'notifications.notification.sent',
    occurredAt: '2026-10-20T09:30:00Z',
    aggregateVersion: 2,
    // Some projections return the data object directly; the card accepts both.
    payload: {
      notificationId: NOTIFICATION_ID,
      notificationNumber: 'NTF-2026-000000001',
      notificationType: 'NEW_CLAIM_NOTICE',
      channel: 'EMAIL',
      recipientPartyId: RECIPIENT_ID,
      from: 'CREATED',
      to: 'SENT',
      status: 'SENT',
      version: 1,
      sentAt: '2026-10-20T09:30:00Z'
    }
  });
}

async function json(route, status, body, headers = {}) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    headers,
    body: JSON.stringify(body)
  });
}

async function mockNotifications(page, rows) {
  const byId = new Map(rows.map((row) => [row.id, row]));

  await page.route('**/api/v1/notifications**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();

    if (method === 'GET' && url.pathname === '/api/v1/notifications') {
      await json(route, 200, rows);
      return;
    }

    const detailMatch = url.pathname.match(/^\/api\/v1\/notifications\/([^/]+)$/);
    if (method === 'GET' && detailMatch && byId.has(detailMatch[1])) {
      await json(route, 200, byId.get(detailMatch[1]));
      return;
    }

    await route.fulfill({ status: 404, body: `unexpected ${method} ${url.pathname}` });
  });
}

async function mockEvents(page, respond) {
  await page.route(EVENTS, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    await respond({ route, url, request });
  });
}

test('requests the selected notification aggregate and refreshes on demand', async ({ page }) => {
  const requests = [];

  await mockNotifications(page, [notification()]);
  await mockEvents(page, async ({ route, url, request }) => {
    requests.push({
      method: request.method(),
      path: url.pathname,
      limit: url.searchParams.get('limit'),
      headers: request.headers()
    });
    await json(route, 200, { aggregateId: NOTIFICATION_ID, limit: 50, items: [] });
  });

  await page.goto(`/?record=${NOTIFICATION_ID}`);
  await expect(page.getByRole('heading', { name: 'NTF-2026-000000001' })).toBeVisible();

  // Selection alone fetches the timeline, before the Activity tab is opened.
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0].method).toBe('GET');
  expect(requests[0].path).toBe(`/api/v1/events/aggregate/${NOTIFICATION_ID}`);
  expect(requests[0].limit).toBe('50');
  expect(requests[0].headers['x-eia-tenant']).toBe(TENANT);

  // The card's own Refresh re-reads the same aggregate without changing selection.
  await page.getByRole('tab', { name: 'Activity' }).click();
  const card = page.getByTestId('notification-activity');
  await card.getByRole('button', { name: 'Refresh activity timeline' }).click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].path).toBe(`/api/v1/events/aggregate/${NOTIFICATION_ID}`);
  expect(requests[1].limit).toBe('50');
  expect(requests[1].headers['x-eia-tenant']).toBe(TENANT);
});

test('renders newest first with readable type, status, version, timestamp, and facts', async ({ page }) => {
  const requests = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });

  await mockNotifications(page, [notification()]);
  await mockEvents(page, async ({ route, url }) => {
    requests.push(url.pathname);
    if (requests.length === 1) await firstGate;
    // Deliberately oldest-first: the card must present newest-first.
    await json(route, 200, {
      aggregateId: NOTIFICATION_ID,
      limit: 50,
      items: [createdEvent(), sentEvent()]
    });
  });

  try {
    await page.goto(`/?record=${NOTIFICATION_ID}`);
    await expect(page.getByRole('heading', { name: 'NTF-2026-000000001' })).toBeVisible();
    await page.getByRole('tab', { name: 'Activity' }).click();

    const card = page.getByTestId('notification-activity');
    await expect(card).toBeVisible();
    await expect(card.getByTestId('activity-loading')).toBeVisible();
    await expect(card.getByTestId('activity-count')).toHaveText('…');
    releaseFirst();

    await expect(card.getByTestId('activity-count')).toHaveText('2 events');
    const items = card.getByTestId('activity-item');
    await expect(items).toHaveCount(2);

    const newest = items.nth(0);
    await expect(newest.getByTestId('activity-type')).toHaveText('Notification sent');
    await expect(newest.getByTestId('activity-status')).toHaveText('PROCESSED');
    await expect(newest.getByTestId('activity-status')).toHaveClass(/green/);
    await expect(newest.getByTestId('activity-time')).toHaveAttribute(
      'dateTime',
      '2026-10-20T09:30:00Z'
    );
    await expect(newest.getByTestId('activity-time')).toContainText('Oct 20, 2026');
    await expect(newest.getByTestId('activity-version')).toHaveText('Version 1');
    await expect(newest.getByTestId('activity-fact-channel')).toContainText('Channel EMAIL');
    await expect(newest.getByTestId('activity-fact-recipient')).toContainText(
      `Recipient ${RECIPIENT_ID}`
    );
    await expect(newest.getByTestId('activity-fact-type')).toContainText(
      'Type NEW CLAIM NOTICE'
    );
    await expect(newest.getByTestId('activity-fact-status')).toContainText('CREATED → SENT');
    await expect(newest.getByTestId('activity-raw-type')).toHaveText(
      'notifications.notification.sent'
    );

    const oldest = items.nth(1);
    await expect(oldest.getByTestId('activity-type')).toHaveText('Notification created');
    await expect(oldest.getByTestId('activity-status')).toHaveText('PROCESSED');
    await expect(oldest.getByTestId('activity-version')).toHaveText('Version 0');
    await expect(oldest.getByTestId('activity-fact-status')).toContainText('Status CREATED');
  } finally {
    releaseFirst();
  }
});

test('shows the card-local empty state and the event-source context note', async ({ page }) => {
  await mockNotifications(page, [notification()]);
  await mockEvents(page, async ({ route }) => {
    await json(route, 200, { aggregateId: NOTIFICATION_ID, limit: 50, items: [] });
  });

  await page.goto(`/?record=${NOTIFICATION_ID}`);
  await expect(page.getByRole('heading', { name: 'NTF-2026-000000001' })).toBeVisible();
  await page.getByRole('tab', { name: 'Activity' }).click();

  const card = page.getByTestId('notification-activity');
  await expect(card.getByTestId('activity-count')).toHaveText('0 events');
  await expect(card.getByTestId('activity-empty')).toContainText(
    'No activity has been recorded for this notification yet.'
  );
  await expect(card.getByTestId('activity-timeline')).toHaveCount(0);
  await expect(card.getByTestId('activity-context-note')).toContainText('Event-derived timeline');
  await expect(card.getByTestId('activity-context-note')).toContainText('append-only');
  await expect(card.getByTestId('activity-context-note')).toContainText('source of truth');
  await expect(page.getByTestId('notification-status')).toHaveText('CREATED');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('contains a 503 from the event service inside the activity card', async ({ page }) => {
  await mockNotifications(page, [notification()]);
  await mockEvents(page, async ({ route }) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/problem+json',
      body: JSON.stringify({
        type: 'https://errors.eia-open-insurance.example/platform/event-store-unavailable',
        title: 'Event store unavailable',
        status: 503,
        code: 'EVENT_STORE_UNAVAILABLE',
        detail: 'The event service is unavailable; retry later.'
      })
    });
  });

  await page.goto(`/?record=${NOTIFICATION_ID}`);
  await expect(page.getByRole('heading', { name: 'NTF-2026-000000001' })).toBeVisible();
  await page.getByRole('tab', { name: 'Activity' }).click();

  const card = page.getByTestId('notification-activity');
  await expect(card.getByTestId('activity-error')).toContainText(
    'Activity timeline is temporarily unavailable.'
  );
  await expect(card.getByTestId('activity-count')).toHaveText('0 events');
  await expect(card.getByTestId('activity-timeline')).toHaveCount(0);
  await expect(page.getByTestId('notification-status')).toHaveText('CREATED');
  await expect(page.getByRole('alert')).toHaveCount(0);

  // The rest of the record still works: Overview remains readable.
  await page.getByRole('tab', { name: 'Overview' }).click();
  await expect(page.getByRole('region', { name: 'Notification details' })).toBeVisible();
});

test('summarizes channel, recipient, type, and status facts from event payloads', async ({ page }) => {
  await mockNotifications(page, [notification()]);
  await mockEvents(page, async ({ route }) => {
    await json(route, 200, {
      aggregateId: NOTIFICATION_ID,
      limit: 50,
      items: [
        aggregateEvent({
          eventId: SENT_EVENT_ID,
          eventType: 'notifications.notification.sent',
          occurredAt: '2026-10-21T10:00:00Z',
          aggregateVersion: 3,
          data: {
            notificationType: 'NEW_CLAIM_NOTICE',
            channel: 'EMAIL',
            recipientPartyId: RECIPIENT_ID,
            from: 'QUEUED',
            to: 'SENT',
            status: 'SENT',
            version: 2
          }
        }),
        // A direct data object with a different channel and type proves the
        // summary reads each event's own payload instead of the record.
        aggregateEvent({
          eventId: CREATED_EVENT_ID,
          eventType: 'notifications.notification.created',
          occurredAt: '2026-10-20T10:00:00Z',
          aggregateVersion: 1,
          payload: {
            notificationType: 'CLAIM_ASSIGNED',
            channel: 'IN_APP',
            recipientPartyId: RECIPIENT_ID,
            status: 'CREATED',
            version: 0
          }
        })
      ]
    });
  });

  await page.goto(`/?record=${NOTIFICATION_ID}`);
  await expect(page.getByRole('heading', { name: 'NTF-2026-000000001' })).toBeVisible();
  await page.getByRole('tab', { name: 'Activity' }).click();

  const items = page.getByTestId('activity-item');
  await expect(items).toHaveCount(2);

  const sent = items.nth(0);
  await expect(sent.getByTestId('activity-fact-channel')).toContainText('Channel EMAIL');
  await expect(sent.getByTestId('activity-fact-recipient')).toContainText(RECIPIENT_ID);
  await expect(sent.getByTestId('activity-fact-type')).toContainText('Type NEW CLAIM NOTICE');
  await expect(sent.getByTestId('activity-fact-status')).toContainText('QUEUED → SENT');
  await expect(sent.getByTestId('activity-version')).toHaveText('Version 2');

  const created = items.nth(1);
  await expect(created.getByTestId('activity-fact-channel')).toContainText('Channel IN_APP');
  await expect(created.getByTestId('activity-fact-type')).toContainText('Type CLAIM ASSIGNED');
  await expect(created.getByTestId('activity-fact-status')).toContainText('Status CREATED');
  await expect(created.getByTestId('activity-version')).toHaveText('Version 0');
});

test('refetches activity when another notification is selected', async ({ page }) => {
  const first = notification();
  const second = notification({
    id: SECOND_NOTIFICATION_ID,
    notificationNumber: 'NTF-2026-000000002',
    notificationType: 'POLICY_BOUND',
    channel: 'IN_APP',
    status: 'SENT',
    subject: 'Policy bound notice',
    body: 'Policy POL-2026-0000001 has been bound.',
    sentAt: '2026-10-19T14:05:00Z',
    version: 1
  });
  const requests = [];

  await mockNotifications(page, [first, second]);
  await mockEvents(page, async ({ route, url, request }) => {
    requests.push({
      path: url.pathname,
      limit: url.searchParams.get('limit'),
      headers: request.headers()
    });
    const notificationId = url.pathname.split('/').pop();
    if (notificationId === SECOND_NOTIFICATION_ID) {
      await json(route, 200, {
        aggregateId: SECOND_NOTIFICATION_ID,
        limit: 50,
        items: [
          aggregateEvent({
            eventId: 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeee4',
            eventType: 'notifications.notification.created',
            occurredAt: '2026-10-19T14:05:00Z',
            aggregateVersion: 1,
            aggregateId: SECOND_NOTIFICATION_ID,
            data: {
              notificationType: 'POLICY_BOUND',
              channel: 'IN_APP',
              recipientPartyId: RECIPIENT_ID,
              status: 'SENT',
              version: 1
            }
          })
        ]
      });
      return;
    }
    await json(route, 200, {
      aggregateId: NOTIFICATION_ID,
      limit: 50,
      items: [createdEvent()]
    });
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'NTF-2026-000000001' })).toBeVisible();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0].path).toBe(`/api/v1/events/aggregate/${NOTIFICATION_ID}`);

  await page.getByRole('tab', { name: 'Activity' }).click();
  const card = page.getByTestId('notification-activity');
  await expect(card.getByTestId('activity-item')).toHaveCount(1);
  await expect(card.getByTestId('activity-type')).toHaveText('Notification created');

  await page.getByRole('button', { name: 'Open record NTF-2026-000000002' }).click();
  await expect(page.getByRole('heading', { name: 'NTF-2026-000000002' })).toBeVisible();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].path).toBe(`/api/v1/events/aggregate/${SECOND_NOTIFICATION_ID}`);
  expect(requests[1].limit).toBe('50');
  expect(requests[1].headers['x-eia-tenant']).toBe(TENANT);

  await page.getByRole('tab', { name: 'Activity' }).click();
  await expect(card.getByTestId('activity-count')).toHaveText('1 event');
  await expect(card.getByTestId('activity-type')).toHaveText('Notification created');
  await expect(card.getByTestId('activity-fact-channel')).toContainText('Channel IN_APP');
  await expect(card.getByTestId('activity-fact-type')).toContainText('Type POLICY BOUND');
});
