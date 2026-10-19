import { test, expect } from '@playwright/test';

const TENANT = '11111111-1111-7111-8111-111111111111';

test('renders the notifications workbench and creates a notification through the mocked API', async ({ page }) => {
  let notifications = [
    {
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
      updatedAt: '2026-10-19T12:00:00Z'
    }
  ];

  await page.route('**/api/v1/notifications**', async (route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(notifications)
      });
      return;
    }
    if (request.method() === 'POST') {
      const payload = request.postDataJSON();
      const created = {
        id: '0192f3a4-0000-7000-8000-000000000002',
        tenantId: TENANT,
        notificationNumber: 'NTF-2026-000000002',
        notificationType: payload.notificationType,
        channel: payload.channel,
        status: 'CREATED',
        recipientPartyId: payload.recipientPartyId,
        subject: payload.subject,
        body: payload.body,
        templateCode: payload.templateCode,
        templateVersion: payload.templateVersion,
        scheduledAt: payload.scheduledAt,
        sentAt: null,
        version: 0,
        createdAt: '2026-10-19T13:00:00Z',
        updatedAt: '2026-10-19T13:00:00Z'
      };
      notifications = [created, ...notifications];
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(created)
      });
      return;
    }
    await route.fulfill({ status: 405, body: 'Method not allowed' });
  });

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
  await expect(page.getByText('NTF-2026-000000001')).toBeVisible();
  await expect(page.getByText('Claim requires attention')).toBeVisible();

  await page.getByLabel('Subject').fill('Payment authority required');
  await page.getByLabel('Body').fill('Payment PAY-2026-000000001 requires approval.');
  await page.getByRole('button', { name: 'Create notification' }).click();

  await expect(page.getByText('NTF-2026-000000002')).toBeVisible();
  await expect(page.getByText('Payment authority required')).toBeVisible();
});
