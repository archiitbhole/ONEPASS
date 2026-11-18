/**
 * Meera's walk through the consumer app.
 *
 * One test per screen, all signed in as the same seeded person, in the order
 * someone would actually meet them. Each asserts on a figure or a sentence the
 * page had to compute — a title alone would pass on an empty screen, and an
 * empty screen is the failure mode these tests exist to catch.
 *
 * The screens are independent tests rather than one long script so a break in
 * the middle of the walk reports the screen that broke rather than hiding every
 * screen after it.
 */
import { test, expect } from '@playwright/test';
import { fixtures, formatSeededDate, signIn, RUPEES, stat } from './helpers';
import { BRAND } from '../src/lib/brand';

test.beforeEach(async ({ context }) => {
  await signIn(context, fixtures().consumerEmail);
});

test('a signed-in visit to / is redirected to the consumer home', async ({ page }) => {
  // The redirect is the whole point of this test, so it walks the path that used
  // to be broken rather than going straight to `/home`. `(app)/page.tsx` and
  // `page.tsx` both resolved to `/`, Next picked the marketing one silently, and
  // a signed-in person landed on a page offering them a "Sign in" button. `/` is
  // now the landing page for a stranger and a redirect for a member.
  const response = await page.goto('/');

  await expect(page).toHaveURL(/\/home$/);
  expect(response?.status(), 'the redirect should end on a page that renders').toBe(200);

  // Not the landing page. Its live-numbers section is the thing that would still
  // be on screen if the redirect stopped happening.
  await expect(page.getByRole('region', { name: 'Live ecosystem' })).toHaveCount(0);
});

test('home shows the signed-in consumer shell', async ({ page }) => {
  await page.goto('/home');

  // The heading names the page; the pass card names the holder. Asserting the
  // name on the card is the stronger check of the two — it is the element a
  // person actually holds up, and it proves this home belongs to whoever signed
  // in rather than merely that a page rendered.
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Your ${BRAND.name}`);
  // Found by accessible name rather than by a class: the pass became a drawn
  // object and its markup changed, and what this asserts — that the holder's
  // name and the pass's state are on the thing a person holds up — did not.
  const passCard = page.getByRole('link', { name: new RegExp(`Your ${BRAND.name} pass`) });
  await expect(passCard).toContainText('Meera Kulkarni');
  await expect(passCard).toContainText('Active');

  // The month figures are computed from savings events, not placeholders.
  await expect(page.getByText('Points balance')).toBeVisible();

  // The (app) shell came with it — the move to `/home` had to keep the shell,
  // not just the page. The Home tab is the shell's own control, and `aria-current`
  // is the shell agreeing with the router about where we are: a nav still pointing
  // at `/` would render the tab as not-current and fail here.
  // Inside the dock: the brand link is also labelled "…home", and `.first()`
  // was matching it rather than the tab this test is about.
  const home = page.getByRole('navigation', { name: 'Main' }).first().getByRole('link', { name: 'Home' });
  await expect(home).toHaveAttribute('href', '/home');
  await expect(home).toHaveAttribute('aria-current', 'page');
});

test('deals lists live offers with a price and what they save', async ({ page }) => {
  await page.goto('/deals');

  await expect(page.getByRole('heading', { level: 1, name: 'Live deals' })).toBeVisible();

  const cards = page.locator('li.card');
  await expect(cards.first()).toBeVisible();

  // A deal card has to carry both halves of the claim: what it costs now, and
  // what that is below the list price. A card with a price and no saving is an
  // advert; a card with a saving and no price is a slogan.
  const first = cards.first();
  // `.num` here, not `.stat-value`: a deal card prints a price inline, it is
  // not a console statistic. The two look similar and are not the same thing.
  await expect(first.locator('.num')).toHaveText(RUPEES);
  await expect(first.getByText(/^Save ₹/)).toBeVisible();
  await expect(first.getByText(/\d+ of \d+ left/)).toBeVisible();
});

test('opening a deal shows its terms and a booking control', async ({ page }) => {
  await page.goto('/deals');

  // The deal title is an h2 — `/deals` has one h1 and these are its sections,
  // so an h3 skipped a level. `.h3` is still the class that sizes it.
  const firstDeal = page.locator('li.card h2 a').first();
  const title = (await firstDeal.textContent())?.trim() ?? '';
  expect(title.length).toBeGreaterThan(0);

  await firstDeal.click();
  await expect(page).toHaveURL(/\/deals\/ofr_/);

  await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
  await expect(page.getByRole('button', { name: /^Book for/ })).toBeVisible();
  await expect(page.getByText(/Booking holds capacity/)).toBeVisible();
});

test('tickets shows the seeded booking as a ticket that can be presented', async ({ page }) => {
  await page.goto('/tickets');

  await expect(page.getByRole('heading', { level: 1, name: 'Tickets' })).toBeVisible();

  // `.ticket` rather than `.card`: a ticket is drawn as printed stock now, and
  // a shelf of them is not a list of cards.
  const upcoming = page.locator('.ticket').filter({ hasText: 'Phoenix Cinemas' }).first();
  await expect(upcoming).toBeVisible();
  // The booking was made for two seats through the real booking path, so the
  // ticket has to admit two.
  // "Admits" and its figure are a label and a value on the printed object, so
  // they are asserted as the pair they are rather than as one string.
  const admits = upcoming.locator('.ticket-field').filter({ hasText: 'Admits' });
  await expect(admits).toContainText('2');
  // The reference is printed on the stub: it is what somebody reads out when a
  // scanner will not read the code.
  await expect(upcoming.getByText(/^tkt_/)).toBeVisible();
  // The whole object is the link — its accessible name says what opening it does.
  await expect(upcoming).toHaveAttribute('href', /\/tickets\/tkt_/);
});

test('receipts opens the seeded receipt and lists what was bought', async ({ page }) => {
  const { receipt } = fixtures();

  await page.goto('/receipts');
  await expect(page.getByRole('heading', { level: 1, name: 'Receipts' })).toBeVisible();

  // The ledger row leads with the merchant and carries the reference in its
  // meta line, so the row is found by the reference and opened by its link.
  const row = page.locator('.ledger > li').filter({ hasText: receipt.publicRef }).first();
  await expect(row).toBeVisible();

  await row.getByRole('link').first().click();
  await expect(page).toHaveURL(new RegExp(`/receipts/${receipt.publicRef}$`));

  // Every line the merchant issued, by the merchant's own wording, on the
  // printed record rather than as headings — a receipt's lines are entries, and
  // a page with one heading per purchased item was a page of eight `h3`s.
  const printed = page.locator('.receipt');
  for (const description of receipt.lineDescriptions) {
    await expect(printed.getByText(description, { exact: false }).first()).toBeVisible();
  }
});

test('warranties shows the kettle and the day its cover runs out', async ({ page }) => {
  const { warranty } = fixtures();

  await page.goto('/warranties');
  await expect(page.getByRole('heading', { level: 1, name: 'Warranties' })).toBeVisible();

  // `.certificate`: a warranty is drawn as the document it is, on a shelf.
  const card = page.locator('.certificate').filter({ hasText: warranty.productName }).first();
  await expect(card).toBeVisible();

  // The expiry is derived from the receipt line's warranty months at the moment
  // it was issued, so it is read back from the database rather than written in.
  // The certificate states the term and the end date as two facts on the drawn
  // bar; both are asserted, because either one alone could be right while the
  // arithmetic between them was wrong.
  await expect(card).toContainText(`${warranty.months} months from`);
  await expect(card).toContainText(`Ends ${formatSeededDate(warranty.expiresOn)}`);
});

test('wallet shows a points balance attributed to the partner that issued it', async ({ page }) => {
  await page.goto('/wallet');

  await expect(page.getByRole('heading', { level: 1, name: 'Wallet' })).toBeVisible();

  const balance = stat(page, 'Points balance');
  await expect(balance).toBeVisible();
  await expect(balance).toContainText(/\d/);

  // Points were credited by the cinema when the booking was captured; the
  // statement has to say so rather than showing an unattributed total.
  await expect(page.getByText('By partner')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Phoenix Cinemas' }).first()).toBeVisible();
});

test('savings totals the real events and breaks them down', async ({ page }) => {
  await page.goto('/savings');

  await expect(page.getByRole('heading', { level: 1, name: 'Savings' })).toBeVisible();

  const total = stat(page, 'Saved, all time');
  await expect(total).toContainText(RUPEES);
  await expect(total).toContainText('Summed from real events only.');

  await expect(page.getByRole('heading', { name: 'By category' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Where it came from' })).toBeVisible();
});

test('the pass draws a real QR onto the canvas', async ({ page }) => {
  await page.goto('/pass');

  // The heading names the page and the object names the holder — the same way
  // round as `/home`. Both are asserted, because a pass with no name on it is
  // the failure that matters and a page with no heading is the other one.
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your pass');
  await expect(page.locator('.pass-open')).toContainText('Meera Kulkarni');
  // The rotation is the product's whole security claim, so it has to be stated
  // on the screen rather than only implied by the countdown.
  await expect(page.getByText(/changes every \d+ seconds/i)).toBeVisible();

  const canvas = page.getByRole('img', { name: new RegExp(`Your ${BRAND.name} code`) });
  await expect(canvas).toBeVisible();

  // A canvas element that exists proves nothing — an empty one is the exact
  // failure this screen must not have. Read the pixels back and require both
  // colours to be present in roughly the proportion a QR has.
  const drawing = await canvas.evaluate((el) => {
    const c = el as HTMLCanvasElement;
    const ctx = c.getContext('2d');
    if (!ctx || c.width === 0 || c.height === 0) return null;

    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    let dark = 0;
    let light = 0;
    for (let i = 0; i < data.length; i += 4) {
      const luminance = (data[i]! + data[i + 1]! + data[i + 2]!) / 3;
      if (luminance < 128) dark++;
      else light++;
    }
    return { width: c.width, height: c.height, dark, light };
  });

  expect(drawing, 'the pass canvas has no 2d context or no size').not.toBeNull();
  const { width, height, dark, light } = drawing!;
  expect(width).toBeGreaterThan(100);
  expect(height).toBe(width);

  const darkRatio = dark / (dark + light);
  // A blank canvas is 0; a solid black one is 1. A QR with its four-module quiet
  // zone sits well inside those, and anything outside means nothing was drawn.
  expect(darkRatio).toBeGreaterThan(0.1);
  expect(darkRatio).toBeLessThan(0.6);
});
