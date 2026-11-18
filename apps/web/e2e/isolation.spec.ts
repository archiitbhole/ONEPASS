/**
 * The guarantee the whole multi-tenant design exists to make.
 *
 * A partner console page is reachable only by someone whose own membership
 * resolves that organization. Everyone else gets a 404 — not a 403, deliberately:
 * a distinguishable refusal would confirm to whoever guessed the id that the
 * organization is real.
 *
 * The two organization ids are read from Postgres in global setup rather than
 * written here. A hardcoded id would make this test pass by not being a test:
 * an id that no longer exists 404s for everybody, including the owner, and the
 * suite would go green on an app with no isolation at all.
 */
import { test, expect } from '@playwright/test';
import { expectNotFound, fixtures, signIn } from './helpers';

test.describe('a partner cannot reach another partner', () => {
  test.beforeEach(async ({ context }) => {
    await signIn(context, fixtures().cinemaOwnerEmail);
  });

  test('the cinema owner reaches their own console', async ({ page }) => {
    // The control. Without it, the 404s below would prove only that the URL
    // shape is wrong for everyone.
    const { phoenixCinemas } = fixtures().orgs;

    const response = await page.goto(`/business/${phoenixCinemas}/dashboard`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Phoenix Cinemas');
  });

  test('the cinema owner gets a 404 on the hotel dashboard', async ({ page }) => {
    await expectNotFound(page, `/business/${fixtures().orgs.grandSahyadri}/dashboard`);
    // Nothing of the other tenant leaked into the 404.
    await expect(page.getByText('Grand Sahyadri')).toHaveCount(0);
  });

  test('the cinema owner gets a 404 on the hotel bookings', async ({ page }) => {
    await expectNotFound(page, `/business/${fixtures().orgs.grandSahyadri}/bookings`);
  });

  test('the cinema owner gets a 404 on the hotel inventory', async ({ page }) => {
    await expectNotFound(page, `/business/${fixtures().orgs.grandSahyadri}/inventory`);
  });
});

test.describe('a consumer cannot reach the partner console at all', () => {
  test.beforeEach(async ({ context }) => {
    await signIn(context, fixtures().consumerEmail);
  });

  for (const segment of ['dashboard', 'inventory', 'deals', 'insights', 'demand', 'door']) {
    test(`a consumer gets a 404 on /${segment}`, async ({ page }) => {
      const { phoenixCinemas, grandSahyadri } = fixtures().orgs;

      // Both tenants: the consumer is connected to the hotel as a customer,
      // which is a partner_connection and emphatically not a membership.
      await expectNotFound(page, `/business/${phoenixCinemas}/${segment}`);
      await expectNotFound(page, `/business/${grandSahyadri}/${segment}`);
    });
  }
});
