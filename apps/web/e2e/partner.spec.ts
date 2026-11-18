/**
 * The cinema owner's walk through ONEPASS Business.
 *
 * The console's claim is that nothing on it is asserted: every figure is read
 * from this organization's own rows, and every computed statement carries the
 * arithmetic and the sample behind it. So these tests assert on the working, not
 * only on the answer — a findings page that showed a headline without its
 * evidence table would be exactly the thing the console promises not to be.
 */
import { test, expect } from '@playwright/test';
import { fixtures, signIn, RUPEES, statValue } from './helpers';

const base = () => `/business/${fixtures().orgs.phoenixCinemas}`;

test.beforeEach(async ({ context }) => {
  await signIn(context, fixtures().cinemaOwnerEmail);
});

test('the dashboard reports today from captured payments', async ({ page }) => {
  await page.goto(`${base()}/dashboard`);

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Phoenix Cinemas');

  await expect(statValue(page, 'Revenue today')).toHaveText(RUPEES);

  // The Utilisation stat always explains where its number came from — either the
  // arithmetic behind it, or, when the venue has published nothing for today, a
  // sentence saying so. Asserting only the first branch made this test depend on
  // the time of day: after the evening shows roll to tomorrow there is genuinely
  // no capacity today, the console says exactly that, and the old assertion read
  // correct behaviour as a failure.
  await expect(page.getByText('Utilisation')).toBeVisible();
  await expect(
    page
      .getByText(/\d+ sold, \d+ held of \d+ across \d+ slots|No capacity published for today/)
      .first(),
  ).toBeVisible();
  await expect(page.getByText('Top venues')).toBeVisible();
  await expect(page.getByText('Phoenix Cinemas — Viman Nagar').first()).toBeVisible();
});

test('inventory lists published capacity with the availability arithmetic', async ({ page }) => {
  await page.goto(`${base()}/inventory`);

  await expect(page.getByRole('heading', { level: 1, name: 'Inventory' })).toBeVisible();

  // Slot / capacity / sold / held / available — the console's whole claim about
  // this screen is that availability is capacity minus held minus sold.
  for (const label of ['Slots', 'Capacity', 'Sold', 'Held', 'Available']) {
    await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
  }

  const seatRow = page.getByRole('row', { name: /Tonight 19:00 — Screen 7/ });
  await expect(seatRow).toBeVisible();
  await expect(seatRow).toContainText('seat');
});

test('live deals shows each offer against its list price', async ({ page }) => {
  await page.goto(`${base()}/deals`);

  await expect(page.getByRole('heading', { level: 1, name: 'Live Deals' })).toBeVisible();

  const deal = page.locator('.card').filter({ hasText: 'Tonight at Phoenix' }).first();
  await expect(deal).toBeVisible();
  await expect(deal).toContainText(/saves ₹[\d,]+/);
  await expect(deal).toContainText(/\d+ of \d+ left/);
});

test('insights states the Tuesday finding and shows the figures behind it', async ({ page }) => {
  await page.goto(`${base()}/insights`);

  await expect(page.getByRole('heading', { level: 1, name: 'Insights' })).toBeVisible();

  // Run the detectors the way an owner would. This used to rely on a database
  // where somebody had already run them, so it passed on a long-lived dev
  // database and failed on a freshly bootstrapped one — where the page, quite
  // correctly, says nothing has run yet. Pressing it on a database that already
  // has findings is harmless: the page lists only the newest run of each
  // detector.
  await page.getByRole('button', { name: 'Recompute' }).click();
  await expect(page.getByText(/The detectors ran and produced \d+ findings?\./)).toBeVisible();

  // The dip is real in the seeded rows; nobody told the detector about it.
  const finding = page
    .locator('article.card')
    .filter({ hasText: /Tuesday revenue is \d+% below your weekly average/ })
    .first();
  await expect(finding).toBeVisible();
  await expect(finding.getByRole('heading', { level: 2 })).toHaveText(
    /Tuesday revenue is \d+% below your weekly average/,
  );

  // The claim is only worth as much as the arithmetic under it, so the
  // arithmetic has to be on the page.
  await expect(finding.getByText('The figures it was derived from')).toBeVisible();
  await expect(finding.getByText(/method: weekday-revenue-variance · sample: \d+ records/)).toBeVisible();

  const evidence = finding.getByRole('table');
  await expect(evidence).toBeVisible();
  await expect(evidence.getByRole('row', { name: /Weakest weekday/ })).toContainText('Tuesday');
  await expect(evidence.getByRole('row', { name: /Shortfall/ }).first()).toContainText('%');
  await expect(evidence.getByRole('row', { name: /Weekly mean/ })).toContainText(RUPEES);
});

test('demand gives a confidence figure, and refuses to give one without history', async ({ page }) => {
  await page.goto(`${base()}/demand`);

  await expect(page.getByRole('heading', { level: 1, name: 'Demand' })).toBeVisible();
  await expect(page.getByText('trailing-weekday-hour-mean').first()).toBeVisible();

  // A slot with matching history carries a confidence percentage, on the badge
  // and again in the definition list.
  const estimated = page.locator('article.card').filter({ hasText: /\d+% confidence/ }).first();
  await expect(estimated).toBeVisible();
  await expect(estimated.getByText('Expected demand')).toBeVisible();
  await expect(estimated.getByText(/Mean of \d+ matching past windows/)).toBeVisible();

  // A slot with no matching history must say so instead of showing a zero.
  // "0% expected" and "we have no history" are different statements and the
  // console is explicit that it will not conflate them.
  const thin = page.locator('article.card').filter({ hasText: 'no history' }).first();
  await expect(thin).toBeVisible();
  await expect(thin).toContainText('not enough history to estimate from');
  await expect(thin).toContainText('not estimated');
  await expect(thin).toContainText('none claimed');
  await expect(thin.getByText(/^\d+% confidence$/)).toHaveCount(0);
});

test('the door console is ready to admit a ticket', async ({ page }) => {
  await page.goto(`${base()}/door`);

  await expect(page.getByRole('heading', { level: 1, name: 'Door' })).toBeVisible();
  await expect(page.getByText('Admit a ticket once, and exactly once.')).toBeVisible();

  await expect(page.getByLabel('Ticket reference')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Admit' })).toBeVisible();

  await expect(page.getByText('Today at the door')).toBeVisible();
  await expect(page.getByText('Valid, not yet used')).toBeVisible();
});
