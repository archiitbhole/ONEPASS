/**
 * The developer platform.
 *
 * A reference is a set of promises to somebody who is not in the room, so what
 * these tests check is not that the pages render — that much is obvious from
 * looking — but the four things that quietly stop being true:
 *
 *  · the navigation reaches every page, and every anchor it offers exists;
 *  · the "Try it" is a real call, not a canned response;
 *  · the honest statements about what is *not* built are still on the page;
 *  · nothing on a public documentation page leaks a secret.
 *
 * The last one matters most. These pages are generated from the same modules
 * the server uses, and the distance between "import the catalogue" and "import
 * something that has a key in it" is one autocomplete.
 */
import { test, expect } from '@playwright/test';

const PAGES = [
  '/developers',
  '/developers/verify',
  '/developers/api',
  '/developers/webhooks',
  '/developers/realtime',
  '/developers/errors',
  '/developers/architecture',
  '/developers/status',
];

test.describe('the developer platform', () => {
  test('every page in the sidebar loads and says what it is', async ({ page }) => {
    for (const path of PAGES) {
      const response = await page.goto(path);
      expect(response?.status(), `${path} should be 200`).toBe(200);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    }
  });

  test('the sidebar marks the page you are on', async ({ page }) => {
    await page.goto('/developers/webhooks');
    const nav = page.getByRole('navigation', { name: 'Documentation' });
    await expect(nav.getByRole('link', { name: 'Webhooks', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    // And only that one.
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
  });

  test('every anchor the reference links to actually exists', async ({ page }) => {
    await page.goto('/developers/api');

    // The in-page index links to each endpoint by id; each must resolve to an
    // element, or the reference quietly scrolls nowhere.
    const hrefs = await page.locator('a[href^="#"]').evaluateAll((nodes) =>
      nodes.map((n) => (n as HTMLAnchorElement).getAttribute('href')!).filter((h) => h.length > 1),
    );
    expect(hrefs.length).toBeGreaterThan(0);

    for (const href of new Set(hrefs)) {
      await expect(page.locator(href), `${href} has no target on /developers/api`).toHaveCount(1);
    }
  });

  test('search finds an endpoint by a parameter name and navigates to it', async ({ page }) => {
    await page.goto('/developers');

    await page.getByRole('button', { name: /Search the reference/i }).click();
    const field = page.getByRole('textbox', { name: 'Search the reference' });
    await expect(field).toBeFocused();

    // `holderExternalRef` appears in no heading anywhere — only in the
    // parameter list of the issue endpoint. Finding it is the whole point of
    // indexing parameters rather than titles.
    await field.fill('holderExternalRef');
    const hit = page.getByRole('button', { name: /POST \/api\/partner/ }).first();
    await expect(hit).toBeVisible();
    await hit.click();

    await expect(page).toHaveURL(/\/developers\/api#credentials-issue$/);
  });

  test('search closes on escape without navigating', async ({ page }) => {
    await page.goto('/developers');
    await page.getByRole('button', { name: /Search the reference/i }).click();
    await page.getByRole('textbox', { name: 'Search the reference' }).press('Escape');
    await expect(page.getByRole('dialog', { name: 'Search the reference' })).toHaveCount(0);
    await expect(page).toHaveURL(/\/developers$/);
  });

  test('Try it makes a real call and shows the real verdict', async ({ page }) => {
    await page.goto('/developers/api');

    // Watch the wire. A "Try it" that renders a canned response would pass every
    // visual assertion and be a lie, so the request itself is the assertion.
    const call = page.waitForRequest(
      (req) => req.url().includes('/api/v1/verify') && req.method() === 'POST',
    );

    const tryIt = page.locator('#verify');
    await tryIt.getByRole('textbox', { name: /reference/i }).fill('definitely-not-a-real-ref');
    await tryIt.getByRole('button', { name: 'Run' }).click();

    const request = await call;
    expect(JSON.parse(request.postData() ?? '{}')).toEqual({
      reference: 'definitely-not-a-real-ref',
    });
    // And no key is sent from the browser, whatever the reader typed.
    expect(request.headers()['authorization']).toBeUndefined();

    // A resolved verdict is a 200 even when the answer is "no such thing" — the
    // single most important thing this documentation teaches.
    await expect(tryIt.getByText('HTTP 200')).toBeVisible();
    // The quoted form, so this matches the value in the rendered response body
    // rather than the two places the prose above explains what NOT_FOUND means.
    await expect(tryIt.getByText('"NOT_FOUND"', { exact: true })).toBeVisible();
  });

  test('says plainly that the partner API cannot be called from a backend', async ({ page }) => {
    await page.goto('/developers');
    await expect(page.getByText(/console API today/i).first()).toBeVisible();

    await page.goto('/developers/architecture');
    const limits = page.locator('#limits');
    await expect(limits.getByText(/The partner API needs a session/i)).toBeVisible();
    await expect(limits.getByText(/There is no scheduler/i)).toBeVisible();
    await expect(limits.getByText(/No published SDK/i)).toBeVisible();
  });

  test('makes no compliance or availability claim', async ({ page }) => {
    for (const path of PAGES) {
      await page.goto(path);
      const text = (await page.locator('main').innerText()).toLowerCase();
      for (const claim of [
        '100% secure',
        'bank-grade',
        'pci compliant',
        'fully compliant',
        'government compliant',
        'iso 27001',
        'soc 2',
        '99.9',
      ]) {
        expect(text, `${path} must not claim "${claim}"`).not.toContain(claim);
      }
    }
  });

  test('leaks nothing that looks like a secret', async ({ page }) => {
    for (const path of PAGES) {
      await page.goto(path);
      const html = await page.content();
      // The documented placeholders end in an ellipsis or dots; a real one
      // would not. These patterns match a plausible full-length secret.
      expect(html, `${path} exposes an API key`).not.toMatch(/op_live_[A-Za-z0-9_-]{20,}/);
      expect(html, `${path} exposes a webhook secret`).not.toMatch(/whsec_[a-f0-9]{32,}/);
      expect(html, `${path} exposes a private key`).not.toContain('BEGIN PRIVATE KEY');
      expect(html, `${path} exposes a database URL`).not.toMatch(/postgres(ql)?:\/\/[^"'\s]+/);
    }
  });

  test('carries no stale year in its examples', async ({ page }) => {
    await page.goto('/developers/api');
    const text = await page.locator('main').innerText();

    // Every date in an example is generated relative to today, so no year
    // before this one should appear anywhere. This is the test that catches a
    // hard-coded date being pasted back in.
    const years = [...text.matchAll(/\b(20\d{2})-\d{2}-\d{2}\b/g)].map((m) => Number(m[1]));
    expect(years.length, 'the reference should contain dated examples').toBeGreaterThan(0);
    const thisYear = new Date().getFullYear();
    for (const year of years) {
      expect(year, 'an example carries a date from a previous year').toBeGreaterThanOrEqual(
        thisYear,
      );
    }
  });

  test('reads on a phone without a horizontal scrollbar', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const path of PAGES) {
      await page.goto(path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      // A code block scrolls inside its own box; the page itself must not.
      expect(overflow, `${path} scrolls sideways on a 390px screen`).toBeLessThanOrEqual(1);
    }
  });
});
