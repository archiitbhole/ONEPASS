/**
 * ONEPASS Control — the platform console, and the door it is behind.
 *
 * Two properties, and the second is the one that matters. The console works: five
 * screens render figures counted from real rows. And the console is unreachable
 * for everyone else — a consumer and a partner owner both get a 404, not a 403,
 * because a distinguishable refusal tells whoever probed `/control` that there is
 * a platform console there to attack.
 *
 * The 404s are asserted against the *same five paths* the admin gets 200 on, in
 * the same run. That pairing is the whole test: a 404 for everybody would pass a
 * refusal-only check while proving the console is simply broken, and a 200 for
 * everybody would pass a works-only check while proving it is wide open.
 *
 * `support@onepass.in` is here too, because platform staff is not one thing.
 * PLATFORM_SUPPORT holds `platform.user:read` and `platform.partner:read` but not
 * `platform.security:read` or `platform.health:read`, so it gets three of the five
 * screens and a 404 on the other two — the console refusing a permission is the
 * same 404 as the console refusing a stranger, which is the design.
 */
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { test, expect } from '@playwright/test';
import { expectNotFound, fixtures, signIn, withDb, stat as consoleStat } from './helpers';

const ADMIN = 'admin@onepass.in';
const SUPPORT = 'support@onepass.in';

/** The five screens this spec covers, as a signed-in stranger would try them. */
const CONSOLE = [
  '/control',
  '/control/users',
  '/control/partners',
  '/control/security',
  '/control/health',
] as const;

/**
 * What the console's shell puts on screen, and therefore what must not appear on
 * a 404. Checking the status alone would pass on a page that answered 404 while
 * rendering the platform's user directory underneath it.
 */
const CONSOLE_CHROME = ['Platform operations', 'ONEPASS Control'];

/**
 * The three domain connection strings, read from the same `.env` the dev server
 * reads.
 *
 * This mirrors `urlFor()` in src/db/domains.ts exactly — a domain is separated if
 * and only if its URL is set — so the health page's claim is compared against the
 * configuration rather than against a sentence written into this test. Hardcoding
 * "not separated" would make this test start lying the day somebody configures it.
 */
function domainStates() {
  loadEnv({ path: path.resolve(__dirname, '..', '.env') });
  return [
    {
      label: 'Consumer',
      role: 'onepass_consumer',
      configured: Boolean(process.env.DATABASE_URL_CONSUMER),
    },
    {
      label: 'Business',
      role: 'onepass_business',
      configured: Boolean(process.env.DATABASE_URL_BUSINESS),
    },
    {
      label: 'Platform',
      role: 'onepass_admin',
      configured: Boolean(process.env.DATABASE_URL_PLATFORM),
    },
  ];
}

// ── the platform administrator ───────────────────────────────

test.describe('the platform administrator opens the console', () => {
  test.beforeEach(async ({ context }) => {
    await signIn(context, ADMIN);
  });

  test('the overview counts the platform against its own rows', async ({ page }) => {
    // The figure the page prints has to be the figure in the table. A stat card
    // showing a plausible number it did not count is the failure this catches.
    const total = await withDb(async (sql) => {
      const rows = await sql<{ n: number }[]>`select count(*)::int as n from users`;
      return rows[0]!.n;
    });

    const response = await page.goto('/control');
    expect(response?.status(), '/control should answer 200 for platform staff').toBe(200);

    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();

    const stat = (label: string) =>
      consoleStat(page, label);
    await expect(stat('Users').locator('.stat-value')).toHaveText(String(total));

    // PLATFORM_ADMIN holds transaction:read and security:read, so neither section
    // is withheld. This is the half of the permission split that support fails.
    await expect(page.getByText('Transactions, last 30 days')).toBeVisible();
    await expect(page.getByText('Open security events by severity')).toBeVisible();
    await expect(page.getByText('Not your role')).toHaveCount(0);
  });

  test('the user directory finds a person by address and still masks it', async ({ page }) => {
    // Searching by an exact address is the console's stated affordance — an
    // address you were given can be confirmed. What comes back is masked, which
    // is the other half of the same sentence: the directory cannot be read out.
    const response = await page.goto(`/control/users?q=${encodeURIComponent(fixtures().consumerEmail)}`);
    expect(response?.status()).toBe(200);

    await expect(page.getByRole('heading', { level: 1, name: 'Users' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Contact (masked)' })).toBeVisible();

    const table = page.getByRole('table');
    await expect(table.getByRole('link', { name: 'Meera Kulkarni' })).toBeVisible();
    await expect(table.getByText('m•••@example.in')).toBeVisible();

    // Scoped to the table on purpose: the search box echoes the term back, so the
    // address is legitimately on the page in the field the administrator typed it
    // into. It must not be in the row that was returned.
    await expect(table.getByText(fixtures().consumerEmail)).toHaveCount(0);
  });

  test('the partner queue lists the seeded organizations with their status', async ({ page }) => {
    const response = await page.goto('/control/partners');
    expect(response?.status()).toBe(200);

    await expect(page.getByRole('heading', { level: 1, name: 'Partners' })).toBeVisible();
    await expect(page.getByText('Approval queue')).toBeVisible();

    // The cinema is seeded ACTIVE, and the directory row carries the slug global
    // setup looked the organization up by — so the row and the fixture agree.
    const row = page.getByRole('row', { name: /Phoenix Cinemas/ }).first();
    await expect(row).toBeVisible();
    await expect(row).toContainText('phoenix-cinemas');
    await expect(row).toContainText('active');
  });

  test('the security queue renders with its filters and its counts', async ({ page }) => {
    const response = await page.goto('/control/security');
    expect(response?.status()).toBe(200);

    await expect(page.getByRole('heading', { level: 1, name: 'Security' })).toBeVisible();

    // The two filter strips are how the queue is actually worked, and the summary
    // is the claim the page makes about what it is showing.
    await expect(page.getByRole('group', { name: 'Filter security events by severity' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Filter security events by state' })).toBeVisible();
    await expect(page.getByText('Shown')).toBeVisible();
    // Appears twice on this page — as the tile's label and inside the count
    // badge. Naming the tile keeps the assertion specific rather than lucky.
    await expect(page.getByText('High or critical', { exact: true })).toBeVisible();
  });

  test('health reports the isolation it actually has, not the one it wants', async ({ page }) => {
    const response = await page.goto('/control/health');
    expect(response?.status()).toBe(200);

    await expect(page.getByRole('heading', { level: 1, name: 'Health' })).toBeVisible();

    // A real round trip ran for this page, and the database is up — the suite is
    // reading the same one.
    const stat = (label: string) =>
      consoleStat(page, label);
    await expect(stat('Database').locator('.stat-value')).toHaveText('Up');

    const card = page.locator('.card').filter({ hasText: 'Database isolation' }).first();
    await expect(card).toBeVisible();

    const domains = domainStates();
    const configured = domains.filter((d) => d.configured).length;

    if (configured === 3) {
      await expect(card.getByText('three roles, separated')).toBeVisible();
      await expect(card.getByText(/Each domain connects as its own least-privilege role/)).toBeVisible();
    } else {
      // The honest answer, and the one this container is actually in. The page has
      // to say the separation is absent rather than print a reassuring badge: a
      // console that claimed an isolation it does not have is worse than one that
      // says nothing, because somebody would stop checking.
      await expect(card.getByText(`${configured} of 3 configured`)).toBeVisible();
      await expect(card.getByText(/grant-level separation is NOT in force/)).toBeVisible();
      await expect(card.getByText('three roles, separated')).toHaveCount(0);
    }

    // And per domain, the role it would connect as and whether it does.
    for (const domain of domains) {
      const row = card.getByRole('row', { name: new RegExp(`^${domain.label}\\b`) });
      await expect(row).toContainText(domain.role);
      await expect(row).toContainText(domain.configured ? 'own role' : 'shared connection');
    }
  });
});

// ── everybody else ───────────────────────────────────────────

for (const [who, email] of [
  ['a consumer', () => fixtures().consumerEmail],
  ['a partner owner', () => fixtures().cinemaOwnerEmail],
] as const) {
  test.describe(`${who} cannot reach the console`, () => {
    test.beforeEach(async ({ context }) => {
      await signIn(context, email());
    });

    for (const pathname of CONSOLE) {
      test(`${who} gets a 404 on ${pathname}`, async ({ page }) => {
        await expectNotFound(page, pathname);

        // Refused, and refused without a trace of what was refused.
        for (const chrome of CONSOLE_CHROME) {
          await expect(page.getByText(chrome)).toHaveCount(0);
        }
      });
    }
  });
}

// ── platform staff without the permission ────────────────────

test.describe('platform support holds some of the console and not the rest', () => {
  test.beforeEach(async ({ context }) => {
    await signIn(context, SUPPORT);
  });

  test('support reads users and partners', async ({ page }) => {
    for (const pathname of ['/control', '/control/users', '/control/partners']) {
      const response = await page.goto(pathname);
      expect(response?.status(), `${pathname} should answer 200 for platform support`).toBe(200);
    }
  });

  test('the overview withholds the sections support may not read', async ({ page }) => {
    await page.goto('/control');

    // Absent with the reason on the screen, rather than blank. A blank card reads
    // as "nothing happening", which is a different statement entirely.
    await expect(page.getByText('Platform-wide transactions')).toBeVisible();
    await expect(page.getByText('The security queue')).toBeVisible();
    // The permission name appears both in the prose reason and in the mono
    // chip beside it; either proves the point, so assert on the chip.
    await expect(page.locator('.mono', { hasText: 'platform.transaction:read' }).first()).toBeVisible();
    await expect(page.getByText('Nothing behind this section was read.').first()).toBeVisible();

    // And the figures behind them were never rendered.
    await expect(page.getByText('Transactions, last 30 days')).toHaveCount(0);
  });

  for (const pathname of ['/control/security', '/control/health']) {
    test(`support gets a 404 on ${pathname}`, async ({ page }) => {
      // The same answer a stranger gets. "You may not" and "there is nothing
      // here" are deliberately indistinguishable, inside the console as well as
      // outside it.
      await expectNotFound(page, pathname);
    });
  }
});
