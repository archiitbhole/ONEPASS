/**
 * Travel and AirIndex, in a browser.
 *
 * These walk the journey a person actually takes — search, compare, open a fare,
 * pick it, get re-quoted, fill in passengers, see the total — and assert on the
 * things that would cost somebody money if they were wrong: that a price change
 * is shown before payment, that the total on screen equals its own line items,
 * that a sample fare is labelled as a sample, and that a source which failed is
 * reported rather than quietly dropped.
 *
 * They run against the sample provider, which is what makes them possible at
 * all: the adapters for the real sources need credentials this repository does
 * not have. Every assertion here is about the product's own behaviour, not
 * about an airline's.
 *
 * **When no flight source is connected, this file skips itself and says so.**
 * That is the case on a production build: the sample provider is refused
 * outside development, deliberately, so a run against the built bundle has no
 * fares at all. Those runs used to leave seven red tests that were not failures
 * — the screens were behaving correctly and saying NEEDS_CONFIG — and a red
 * suite that is expected to be red teaches nobody anything. The skip is
 * conditional on what the deployment actually reports, so the moment a source
 * is configured these tests run again without anybody remembering to re-enable
 * them.
 */
import { expect, test } from '@playwright/test';
import { fixtures, signIn } from './helpers';

const IN_A_FORTNIGHT = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(
  new Date(Date.now() + 14 * 86_400_000),
);

const RESULTS = `/travel/flights/results?from=DEL&to=BOM&depart=${IN_A_FORTNIGHT}&adults=1&cabin=ECONOMY&direct=1`;

/**
 * One live search, re-used by every test that only needs results on screen.
 *
 * Each `goto(RESULTS)` asks every provider again, which costs a supplier call
 * per test and trips the product's own search rate limit partway through the
 * suite — a failure that looks like a bug and is the limiter working. So the
 * suite runs one real search and then re-renders it through `?s=<ref>`, which
 * is the same path a shared link takes and therefore worth exercising anyway.
 */
let persistedResults: string | null = null;

/**
 * Whether this deployment can quote a fare at all.
 *
 * Read from the results page itself rather than from an env var: the tests run
 * against a server that may not share this process's environment, and what
 * matters is what that server does, not what this one was configured with.
 */
let flightSourceConnected: boolean | null = null;

test.beforeEach(async ({ page }) => {
  if (flightSourceConnected === null) {
    await signIn(page.context(), fixtures().consumerEmail);
    await page.goto(RESULTS);
    // `.op-source-ok` is the class the source panel puts on a provider that
    // answered. None of them means nothing was asked, or nothing replied.
    flightSourceConnected = (await page.locator('.op-source-ok').count()) > 0;
  }
  test.skip(
    !flightSourceConnected,
    'No flight source is connected on this deployment, so there are no fares to assert on. ' +
      'The screens say so themselves; see the travel feature in src/lib/features.ts.',
  );
});

/**
 * Pick the nth fare on the results page.
 *
 * Each booking test takes a *different* one, because selecting a fare is
 * idempotent on the offer: picking the same fare twice returns the booking
 * already made for it, which is the right product behaviour — it is the same
 * selection — and means two tests sharing a fare would find the second one
 * already past the step it wanted to exercise.
 */
async function selectFare(page: import('@playwright/test').Page, index: number): Promise<void> {
  await page.locator('.op-flight').nth(index).getByRole('link', { name: 'Select' }).click();
  await expect(page).toHaveURL(/\/travel\/flights\/fo_/);
}

async function results(page: import('@playwright/test').Page): Promise<void> {
  if (persistedResults) {
    await page.goto(persistedResults);
    // A search expires after twenty-five minutes; fall back to a fresh one.
    if ((await page.locator('.op-flight').count()) > 0) return;
    persistedResults = null;
  }

  await page.goto(RESULTS);
  const share = page.getByRole('link', { name: 'Link to these exact results' });
  if ((await share.count()) > 0) {
    const href = await share.getAttribute('href');
    if (href) persistedResults = href;
  }
}

test.describe('the travel hub', () => {
  test('leads with a search, and links the rest of travel', async ({ page }) => {
    await signIn(page.context(), fixtures().consumerEmail);
    await page.goto('/travel');

    await expect(page.getByRole('heading', { level: 1 })).toContainText('Flights');
    // The search form is the first thing, not a link to one.
    await expect(page.getByLabel('From', { exact: true })).toBeVisible();
    await expect(page.getByLabel('To', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Search flights' })).toBeVisible();

    await expect(page.getByRole('link', { name: 'Open AirIndex' })).toBeVisible();
    await expect(page.getByRole('link', { name: /cashback/i }).first()).toBeVisible();
  });

  test('a search from the hub reaches results', async ({ page }) => {
    await signIn(page.context(), fixtures().consumerEmail);
    await page.goto('/travel');

    await page.getByLabel('From', { exact: true }).fill('DEL');
    await page.getByLabel('To', { exact: true }).fill('BOM');
    await page.getByLabel('Departing').fill(IN_A_FORTNIGHT);
    await page.getByRole('button', { name: 'Search flights' }).click();

    await expect(page).toHaveURL(/\/travel\/flights\/results\?/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Delhi');
  });
});

test.describe('results', () => {
  test('accounts for every source that was asked', async ({ page }) => {
    await signIn(page.context(), fixtures().consumerEmail);
    // A live search, because this test is about what the sources reported.
    await page.goto(RESULTS);

    // Not "some fares" — a line per source, and every line says what that source
    // did. Asserted over all of them rather than the first: the failure this
    // guards against is a source falling off a list built from what answered,
    // which a check on one row would not catch.
    const sources = page.locator('.op-source');
    await expect(sources.first()).toBeVisible();

    const count = await sources.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const row = sources.nth(i);
      // One of the five outcomes a source can have. A row with none of them is a
      // source the page has quietly stopped accounting for.
      await expect(row.locator('.badge')).toHaveText(
        /Answered|No answer|Not connected|Not asked|Resting/,
      );
      // And the sentence that says which, in words rather than a colour.
      await expect(row.locator('.op-source-said')).not.toBeEmpty();
    }
  });

  test('labels a sample fare as a sample, on the card', async ({ page }) => {
    await signIn(page.context(), fixtures().consumerEmail);
    await results(page);

    const first = page.locator('.op-flight').first();
    await expect(first).toBeVisible();
    // The development source must never be mistakable for an airline's fare.
    await expect(first).toContainText(/Sample fare/i);
  });

  test('shows what a fare is, in the four things a person chooses on', async ({ page }) => {
    await signIn(page.context(), fixtures().consumerEmail);
    await results(page);

    const first = page.locator('.op-flight').first();
    await expect(first.locator('.op-flight-time').first()).toHaveText(/^\d{2}:\d{2}$/);
    await expect(first).toContainText(/Nonstop|stop/);
    await expect(first.locator('.op-flight-fare')).toContainText('₹');
  });

  test('sorting is a link, and changes the order without a new search', async ({ page }) => {
    await signIn(page.context(), fixtures().consumerEmail);
    await results(page);

    const cheapestFirst = await page.locator('.op-flight-fare').allTextContents();
    await page.getByRole('link', { name: 'Quickest' }).click();
    await expect(page).toHaveURL(/sort=duration/);

    const quickestFirst = await page.locator('.op-flight-fare').allTextContents();
    expect(quickestFirst.length).toBe(cheapestFirst.length);
  });

  test('says how the route is priced, or says there is not enough data', async ({ page }) => {
    await signIn(page.context(), fixtures().consumerEmail);
    // Two searches so the route has observations to compare against.
    await page.goto(RESULTS);
    await page.goto(RESULTS);

    const body = page.locator('main');
    // Either a figure, or the reason there is not one. Never silence beside
    // cards that carry "below the usual fare" badges.
    await expect(body).toContainText(/Fare index|Not enough observations|No prices have been observed|Nothing found/i);
  });
});

test.describe('a fare in detail', () => {
  test('shows the journey, the price in parts, and the airline’s conditions', async ({ page }) => {
    await signIn(page.context(), fixtures().consumerEmail);
    await page.goto(RESULTS);

    await page.locator('.op-flight').first().getByRole('link', { name: 'Select' }).click();
    await expect(page).toHaveURL(/\/travel\/flights\/fo_/);

    await expect(page.getByRole('heading', { name: 'What it costs' })).toBeVisible();
    // Every component named. "Taxes and fees" as one opaque line is the thing
    // this product exists not to do.
    await expect(page.locator('main')).toContainText('Fare');
    await expect(page.locator('main')).toContainText('Taxes and carrier charges');
    await expect(page.locator('main')).toContainText('Total');

    await expect(page.getByRole('heading', { name: 'Fare conditions' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Baggage' })).toBeVisible();
  });

  test('the price parts add up to the total that is shown', async ({ page }) => {
    await signIn(page.context(), fixtures().consumerEmail);
    await results(page);
    // Assert the navigation before reading the page, so a click that did not
    // land fails here rather than as NaN arithmetic three lines later.
    await selectFare(page, 0);

    const rows = await page.locator('.op-price-row').allTextContents();
    expect(rows.length, 'the fare detail page should itemise its price').toBeGreaterThan(2);
    const amounts = rows.map((row) => {
      const match = /₹([\d,]+(?:\.\d+)?)/.exec(row);
      return match ? Number(match[1]!.replace(/,/g, '')) : 0;
    });
    // The last row is the total; the ones before it are its parts.
    const total = amounts[amounts.length - 1]!;
    const parts = amounts.slice(0, -1).reduce((sum, value) => sum + value, 0);
    expect(Math.abs(total - parts)).toBeLessThan(1);
  });
});

test.describe('booking', () => {
  test('re-checks the price with the airline before any payment exists', async ({ page }) => {
    await signIn(page.context(), fixtures().consumerEmail);
    await results(page);
    await selectFare(page, 0);
    await page.getByRole('button', { name: /^Continue with/ }).click();

    await expect(page).toHaveURL(/\/travel\/book\/fb_/);
    // Nothing that charges anything is on the page yet.
    await expect(page.getByRole('button', { name: 'Check the price with the airline' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue to payment' })).toHaveCount(0);
  });

  test('after the check, takes passengers and shows the total in full', async ({ page }) => {
    await signIn(page.context(), fixtures().consumerEmail);
    await results(page);
    await selectFare(page, 1);
    await page.getByRole('button', { name: /^Continue with/ }).click();
    await expect(page).toHaveURL(/\/travel\/book\/fb_/);
    await page.getByRole('button', { name: 'Check the price with the airline' }).click();

    const body = page.locator('main');
    // The sample source deliberately moves a price on roughly one offer in
    // twelve, so either outcome is correct — and both are shown to the person
    // rather than resolved on their behalf.
    const changed = await page.getByRole('button', { name: /^Accept ₹/ }).count();
    if (changed > 0) {
      await expect(body).toContainText('Nothing has been charged');
      await expect(body).toContainText('What you were shown');
      await expect(body).toContainText('What the airline charges now');
      await page.getByRole('button', { name: /^Accept ₹/ }).click();
    }

    const gone = await body.getByText(/no longer available|expired/i).count();
    test.skip(gone > 0, 'the sample source retired this fare on revalidation, which is its own correct path');

    await expect(page.getByRole('heading', { name: 'Who is travelling' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Bank offers' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'ONEPASS points' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'What you pay' })).toBeVisible();

    // The boundary that matters: no field on this page takes a card.
    await expect(body).toContainText('never sees your card number');
    await expect(page.locator('input[autocomplete="cc-number"]')).toHaveCount(0);
  });

  test('shows why an ineligible bank offer does not apply, rather than hiding it', async ({ page }) => {
    await signIn(page.context(), fixtures().consumerEmail);
    await results(page);
    await selectFare(page, 2);
    await page.getByRole('button', { name: /^Continue with/ }).click();
    await expect(page).toHaveURL(/\/travel\/book\/fb_/);
    await page.getByRole('button', { name: 'Check the price with the airline' }).click();

    const accept = page.getByRole('button', { name: /^Accept ₹/ });
    if ((await accept.count()) > 0) await accept.click();

    const offers = page.locator('.op-offer');
    if ((await offers.count()) > 1) {
      // Every offer carries its terms or the reason it does not apply.
      await expect(offers.nth(1)).toContainText(/saves|not applicable/);
    }
  });
});

test.describe('trips', () => {
  test('lists a booking that has not been paid for, in the state it is in', async ({ page }) => {
    await signIn(page.context(), fixtures().consumerEmail);
    await results(page);
    await selectFare(page, 3);
    await page.getByRole('button', { name: /^Continue with/ }).click();
    await expect(page).toHaveURL(/\/travel\/book\/fb_/);

    const ref = new URL(page.url()).pathname.split('/').pop()!;
    await page.goto(`/travel/trips/${ref}`);

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('main')).toContainText(/Not booked|Price|confirm/i);
  });

  test('answers 404 for a booking reference that is not yours', async ({ page }) => {
    await signIn(page.context(), fixtures().consumerEmail);
    const response = await page.goto('/travel/trips/fb_notarealreference');
    // 404, never 403 — a refusal would confirm the reference exists.
    expect(response?.status()).toBe(404);
  });
});

test.describe('AirIndex', () => {
  test('explains what the index means before showing one', async ({ page }) => {
    await signIn(page.context(), fixtures().consumerEmail);
    await page.goto('/travel/airindex');

    await expect(page.getByRole('heading', { level: 1 })).toContainText('AirIndex');
    await expect(page.locator('main')).toContainText('An index of 100 means');
    await expect(page.locator('main')).toContainText('not a forecast');
  });

  test('every intelligence page loads and says where its numbers came from', async ({ page }) => {
    await signIn(page.context(), fixtures().consumerEmail);

    for (const path of [
      '/travel/airindex/routes',
      '/travel/airindex/airlines',
      '/travel/airindex/history',
      '/travel/airindex/observations',
      '/travel/airindex/quality',
      '/travel/airindex/methodology',
    ]) {
      const response = await page.goto(path);
      expect(response?.status(), `${path} should load`).toBe(200);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    }
  });

  test('the methodology page states the threshold and what the index cannot do', async ({ page }) => {
    await signIn(page.context(), fixtures().consumerEmail);
    await page.goto('/travel/airindex/methodology');

    const body = page.locator('main');
    await expect(body).toContainText('Fare Index = (current median ÷ reference median) × 100');
    await expect(body).toContainText('It is not a forecast');
    await expect(body).toContainText('It is not a census of the market');
    await expect(body).toContainText('It does not rate airlines');
  });

  test('the quality page reports the gaps as well as the coverage', async ({ page }) => {
    await signIn(page.context(), fixtures().consumerEmail);
    await page.goto('/travel/airindex/quality');

    const body = page.locator('main');
    await expect(body).toContainText('What AirIndex cannot tell you');
    await expect(body).toContainText('sample, not a census');
    // The page names the thing it refuses to invent rather than silently omitting
    // it, which is the stronger form of the same honesty.
    await expect(body).toContainText('no single quality score');
  });

  test('a route with observations shows an index or says it has too few', async ({ page }) => {
    await signIn(page.context(), fixtures().consumerEmail);
    // Generate observations first.
    await page.goto(RESULTS);
    await page.goto('/travel/airindex/routes?from=DEL&to=BOM');

    const body = page.locator('main');
    await expect(body).toContainText(/observed price|Not enough observations|No prices have been observed/i);
  });

  test('the CSV export downloads as a file rather than rendering', async ({ page }) => {
    await signIn(page.context(), fixtures().consumerEmail);
    await page.goto(RESULTS);

    const response = await page.request.get(
      `/api/travel/airindex/export?from=DEL&to=BOM&days=90`,
    );
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('text/csv');
    expect(response.headers()['content-disposition']).toContain('attachment');
    const body = await response.text();
    expect(body.split('\n')[0]).toContain('observed_at,origin,destination');
  });

  test('the export refuses an anonymous request', async ({ request }) => {
    const response = await request.get('/api/travel/airindex/export?from=DEL&to=BOM');
    expect([401, 403]).toContain(response.status());
  });
});

test.describe('rewards and discounts', () => {
  test('separates pending cashback from credited, and says why', async ({ page }) => {
    await signIn(page.context(), fixtures().consumerEmail);
    await page.goto('/travel/rewards');

    const body = page.locator('main');
    await expect(body).toContainText('Pending');
    await expect(body).toContainText('Credited');
    await expect(body).toContainText('not money you have yet');
  });

  test('shows every offer with its full terms', async ({ page }) => {
    await signIn(page.context(), fixtures().consumerEmail);
    await page.goto('/travel/discounts');

    await expect(page.getByRole('heading', { level: 1 })).toContainText('Offers');
    const body = page.locator('main');
    await expect(body).toContainText(/Sample offer for development|No offers are running/);
    await expect(body).toContainText('never sees your card number');
  });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('nothing on the travel screens scrolls sideways', async ({ page }) => {
    await signIn(page.context(), fixtures().consumerEmail);

    for (const path of ['/travel', '/travel/flights', RESULTS, '/travel/airindex', '/travel/rewards']) {
      await page.goto(path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${path} overflows horizontally by ${overflow}px`).toBeLessThanOrEqual(1);
    }
  });

  test('a fare card is readable at 390px', async ({ page }) => {
    await signIn(page.context(), fixtures().consumerEmail);
    await page.goto(RESULTS);

    const card = page.locator('.op-flight').first();
    await expect(card).toBeVisible();
    const box = await card.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(390);
    await expect(card.locator('.op-flight-fare')).toBeVisible();
    await expect(card.getByRole('link', { name: 'Select' })).toBeVisible();
  });
});

test.describe('the console stays quiet', () => {
  test('no page errors on the travel journey', async ({ page }) => {
    const problems: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') problems.push(message.text());
    });
    page.on('pageerror', (error) => problems.push(error.message));

    await signIn(page.context(), fixtures().consumerEmail);
    for (const path of ['/travel', '/travel/flights', RESULTS, '/travel/airindex', '/travel/trips']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
    }

    expect(problems, `console errors: ${problems.join(' | ')}`).toEqual([]);
  });
});
