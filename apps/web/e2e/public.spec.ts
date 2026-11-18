/**
 * The screens anyone can reach without an account.
 *
 * The verification page is the one the whole product exists for, so it gets the
 * most attention here: an employer with a printed certificate and no ONEPASS
 * account has to be able to read the answer, and see *what was checked* rather
 * than a bare tick.
 */
import { test, expect } from '@playwright/test';
import { fixtures, withDb, RUPEES } from './helpers';

test.describe('landing page', () => {
  test('quotes the live ecosystem numbers from the database', async ({ page }) => {
    const counts = await withDb(async (sql) => {
      const rows = await sql<{ partners: number; venues: number; cities: number }[]>`
        select (select count(*) from organizations where status = 'ACTIVE')::int as partners,
               (select count(*) from venues where is_active)::int                as venues,
               (select count(*) from cities where is_live)::int                  as cities
      `;
      return rows[0]!;
    });

    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'a hundred separate identities',
    );

    const numbers = page.getByRole('region', { name: 'Live ecosystem' });
    await expect(numbers).toBeVisible();

    // The figures are the page's own claim about itself; they have to match the
    // rows they are counted from, not merely be present.
    const figure = (label: string) => numbers.locator('.lp-number').filter({ hasText: label }).locator('b');
    await expect(figure('active partners')).toHaveText(String(counts.partners));
    await expect(figure('venues')).toHaveText(String(counts.venues));
    await expect(figure('cities live')).toHaveText(String(counts.cities));

    await expect(numbers.getByText('deals running now')).toBeVisible();
    await expect(figure('saved by members')).toHaveText(RUPEES);
  });
});

test.describe('/verify', () => {
  test('renders the reference form', async ({ page }) => {
    await page.goto('/verify');

    await expect(page.getByRole('heading', { name: 'Check a credential' })).toBeVisible();
    await expect(page.getByLabel('Credential reference')).toBeVisible();
    await expect(page.getByRole('button', { name: /verify/i })).toBeVisible();
    await expect(page.getByText('No account, no sign-in.')).toBeVisible();
  });

  test('the form lands on the verification page for the reference typed into it', async ({ page }) => {
    const { credentialRef } = fixtures();

    await page.goto('/verify');
    await page.getByLabel('Credential reference').fill(credentialRef);
    await page.getByRole('button', { name: /verify/i }).click();

    await expect(page).toHaveURL(new RegExp(`/v/${credentialRef}$`));
    await expect(page.getByText('Verified', { exact: true })).toBeVisible();
  });
});

test.describe('/v/<ref>', () => {
  test('an unknown reference reads "Not found" and explains why', async ({ page }) => {
    await page.goto('/v/crd_definitelynotreal');

    await expect(page.getByText('Not found', { exact: true })).toBeVisible();
    await expect(page.getByText('No credential matches that reference.', { exact: true })).toBeVisible();
    // A verdict that cannot be trusted must not carry a checklist implying work
    // was done on a record that does not exist.
    await expect(page.getByText('What was checked')).toHaveCount(0);
  });

  test('a real reference reads "Verified" and lists all five checks', async ({ page }) => {
    const { credentialRef } = fixtures();

    await page.goto(`/v/${credentialRef}`);

    await expect(page.getByText('Verified', { exact: true })).toBeVisible();
    await expect(page.getByText('What was checked')).toBeVisible();

    const checklist = page.locator('.checklist');
    for (const label of ['Reference', 'Integrity', 'Issuer', 'Revocation', 'Validity']) {
      await expect(checklist.getByText(label, { exact: true })).toBeVisible();
    }

    // The reference is echoed back, so a verifier can confirm they checked the
    // code they were handed rather than one the page chose.
    await expect(page.getByText(credentialRef, { exact: true }).first()).toBeVisible();

    // The limit of the claim is part of the page, not a footnote to be dropped.
    await expect(page.getByText('What this does and does not prove.')).toBeVisible();
  });
});

/**
 * Crawlability, and the line it must not cross.
 *
 * The sitemap is the one file whose whole job is to hand URLs to a search
 * engine. A private route listed there is a private URL published to Google and
 * Bing — it would still 404 to them, but it would be indexed as existing, and
 * anything personal in a path would be in a public index forever. So the test
 * that matters is not "the sitemap exists" but "the sitemap contains nothing it
 * should not".
 */
test.describe('crawlability', () => {
  test('robots.txt is served and points at the sitemap', async ({ request, baseURL }) => {
    const res = await request.get('/robots.txt');
    expect(res.status()).toBe(200);

    const body = await res.text();
    expect(body).toMatch(/^User-Agent: \*/im);
    expect(body).toMatch(/^Sitemap: https?:\/\/\S+\/sitemap\.xml$/im);

    // The signed-in surfaces are asked to be left alone. This is politeness,
    // not protection — what actually keeps them shut is a 404 to anyone without
    // a membership — but it saves a crawler its budget and keeps a pasted
    // personal URL out of an index.
    for (const path of ['/api/', '/control', '/business/', '/v/', '/home', '/profile']) {
      expect(body, `robots.txt should disallow ${path}`).toContain(`Disallow: ${path}`);
    }
    expect(baseURL).toBeTruthy();
  });

  test('the sitemap lists the public pages and nothing private', async ({ request }) => {
    const res = await request.get('/sitemap.xml');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('xml');

    const xml = await res.text();
    const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]!).pathname);

    expect(urls.length).toBeGreaterThan(5);
    for (const path of ['/', '/verify', '/pricing', '/developers']) {
      expect(urls, `${path} should be listed`).toContain(path);
    }

    // The exclusions are the point.
    const forbidden = [
      /^\/home/,
      /^\/pass/,
      /^\/profile/,
      /^\/tickets/,
      /^\/receipts/,
      /^\/control/,
      /^\/business/,
      // A verification verdict is about one person and belongs in no index.
      /^\/v\//,
      /^\/api\//,
      /^\/offline/,
    ];
    for (const url of urls) {
      for (const pattern of forbidden) {
        expect(pattern.test(url), `${url} must not be in the sitemap`).toBe(false);
      }
    }
  });

  test('every page in the sitemap actually resolves', async ({ request }) => {
    const xml = await (await request.get('/sitemap.xml')).text();
    const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]!).pathname);

    // A sitemap entry that 404s is worse than a missing one: it is an explicit
    // promise to a crawler that the page is there.
    for (const path of urls) {
      const res = await request.get(path, { maxRedirects: 0 });
      expect([200, 307, 308], `${path} answered ${res.status()}`).toContain(res.status());
    }
  });

  test('public pages carry a title, a description and a canonical link', async ({ page }) => {
    for (const path of ['/', '/verify', '/pricing', '/developers', '/developers/api']) {
      await page.goto(path);

      await expect(page).toHaveTitle(/\S/);
      const description = page.locator('meta[name="description"]');
      await expect(description, `${path} needs a description`).toHaveCount(1);
      expect((await description.getAttribute('content'))!.length).toBeGreaterThan(40);

      // Without a canonical, two URLs for the same page are two pages.
      await expect(page.locator('link[rel="canonical"]'), `${path} needs a canonical`).toHaveCount(1);
    }
  });

  test('the landing page carries Open Graph metadata', async ({ page }) => {
    await page.goto('/');
    for (const property of ['og:title', 'og:description', 'og:url', 'og:image', 'og:site_name']) {
      await expect(
        page.locator(`meta[property="${property}"]`),
        `missing ${property}`,
      ).toHaveCount(1);
    }
  });
});
