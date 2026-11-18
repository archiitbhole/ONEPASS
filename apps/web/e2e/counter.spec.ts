/**
 * A sale across a counter, driven the way a shop actually does it.
 *
 * Two browser contexts, because two people are involved and conflating them
 * would test something easier than the real thing: the customer's phone shows a
 * code, and a member of staff at the till — the *least*-privileged partner role,
 * not an owner — turns that into a receipt.
 *
 * What this holds down that no unit test can:
 *
 *  · the code minted by the customer's own pass endpoint is accepted by the
 *    till, so the two halves of the pass agree in a running system;
 *  · the price shown before the receipt is written is the price written — the
 *    number a shopkeeper reads aloud to a customer is not a browser's guess;
 *  · the receipt reaches the buyer's own screens immediately, which is the whole
 *    reason the feature exists;
 *  · a stale scan is refused, in a browser, with words a person can act on.
 */
import { test, expect, type Browser, type BrowserContext } from '@playwright/test';
import { fixtures, signIn, withDb, BASE_URL } from './helpers';

const base = () => `/business/${fixtures().orgs.grandSahyadri}`;

/**
 * Longer than the suite's 60s default, because a test here may have to wait out
 * a 30-second pass window before it can scan — see `currentCode` below. The
 * alternative, weakening the replay check so the tests run faster, would be
 * testing a product nobody ships.
 */
test.describe.configure({ timeout: 120_000 });

/**
 * The code the customer's phone is showing — one the counter has not seen before.
 *
 * A pass mints one code per 30-second window, and the counter refuses a code it
 * has already been shown; the refusal is a unique index, so it is Postgres
 * saying no rather than the application remembering. Two tests inside the same
 * window therefore receive the *same* string and the second is correctly
 * rejected as a replay.
 *
 * So this asks the database whether this exact presentation already exists and,
 * if it does, waits for the window to roll — which is precisely what a member of
 * staff does when the till says "already used": ask for the current code. It
 * asks Postgres rather than remembering in a variable because Playwright reloads
 * this module on a retry, and a retry that quietly reused a spent code was the
 * flake that sent this file round twice.
 */
async function currentCode(context: BrowserContext): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await context.request.get(`${BASE_URL}/api/me/pass`);
    expect(res.status(), 'the consumer pass endpoint should mint a token').toBe(200);
    const body = (await res.json()) as { token: string; expiresInSeconds: number };
    expect(body.token).toMatch(/^OP1\|/);

    const [, passRef, , counter] = body.token.split('|');
    const spent = await withDb(async (sql) => {
      const rows = await sql`
        select 1
          from pass_presentations pp
          join passes p on p.id = pp.pass_id
         where p.pass_ref = ${passRef!}
           and pp.counter = ${Number(counter)}
           and pp.organization_id = ${fixtures().orgs.grandSahyadri}
         limit 1
      `;
      return rows.length > 0;
    });

    if (!spent) return body.token;

    // The endpoint says exactly how long the window has left, so this is a
    // precise wait rather than a guessed one.
    await new Promise((resolve) => setTimeout(resolve, (body.expiresInSeconds + 1) * 1000));
  }
  throw new Error('the pass kept minting a code that had already been spent at this counter');
}

/**
 * Sign the customer in somewhere else and take the code off their screen.
 *
 * A separate context so the till's session is never the customer's — the counter
 * must work with nothing but the code, which is the security claim being made.
 */
async function codeFromCustomerPhone(browser: Browser): Promise<string> {
  const phone = await browser.newContext();
  try {
    await signIn(phone, fixtures().consumerEmail);
    return await currentCode(phone);
  } finally {
    await phone.close();
  }
}

test.beforeEach(async ({ context }) => {
  await signIn(context, fixtures().hotelDeskEmail);
});

test('counter staff can reach the counter, and it asks for a pass first', async ({ page }) => {
  await page.goto(`${base()}/counter`);

  await expect(page.getByRole('heading', { level: 1, name: 'Counter' })).toBeVisible();

  // The page opens on identification, not on a basket. A till that let you ring
  // up a sale before knowing who it was for would be collecting an order it
  // could not deliver.
  await expect(page.getByLabel(/pass code/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /identify customer/i })).toBeVisible();

  // And the honesty the page owes: no money moves here.
  await expect(page.getByText(/No money moves on this page/i)).toBeVisible();
});

test('a sale rings up, prices itself, and lands on the customer’s pass', async ({ page, browser }) => {
  const token = await codeFromCustomerPhone(browser);
  await page.goto(`${base()}/counter`);

  await page.getByLabel(/pass code/i).fill(token);
  await page.getByRole('button', { name: /identify customer/i }).click();

  // The buyer, as the shop is allowed to know them.
  await expect(page.getByText('Selling to')).toBeVisible();
  await expect(page.getByText('Pass verified')).toBeVisible();

  // Named per run, and visibly a test artefact.
  //
  // This test rings up a *real* sale: a receipt, a warranty and an owned product
  // land on the seeded consumer's account and stay there. Ten runs later the
  // shelf held ten identical "Steam iron, 1600W" warranties, and the consumer
  // spec's fixture — which used to mean "the warranty that expires last" —
  // started pointing at one of them instead of the seeded kettle. A unique name
  // keeps this spec's leavings from ever impersonating seeded data, and tells
  // anyone reading the database where the row came from.
  const item = `Steam iron (e2e ${Date.now().toString(36)})`;
  await page.getByLabel('Item 1').fill(item);
  await page.getByLabel('Unit price (₹)').first().fill('1899.50');
  await page.getByLabel('Tax %').first().fill('18');
  await page.getByLabel('Warranty (months)').first().fill('24');
  await page.getByLabel('Returns accepted for (days)').fill('7');
  await page.getByLabel('Paid with').fill('UPI');

  await page.getByRole('button', { name: /price this sale/i }).click();

  // 1899.50 + 18% = 2241.41. The arithmetic is the receipt service's; what this
  // asserts is that the figure offered to the customer is the one on the button
  // they are about to be charged by.
  const issue = page.getByRole('button', { name: /issue receipt for/i });
  await expect(issue).toBeVisible();
  await expect(issue).toContainText('₹2,241.41');
  await expect(page.getByRole('row', { name: /^Total/ })).toContainText('₹2,241.41');

  await issue.click();

  await expect(page.getByText('Receipt issued')).toBeVisible();
  // The figure appears in three places once the sale is written — the verdict,
  // today's running total and the recent-receipts table. Assert on the verdict,
  // which is the one the operator reads back to the customer.
  await expect(page.getByText(/₹2,241\.41 to cus_/)).toBeVisible();
  // Scoped to the verdict: the same reference also appears in the recent-sales
  // list beside earlier ones, and an unscoped match would be ambiguous.
  const verdict = page.locator('.verdict');
  const reference = verdict.getByText(/^rcp_/);
  await expect(reference).toBeVisible();
  const ref = (await reference.textContent())!.trim();

  // A warranty was promised on the line, so one exists — not a sentence on a
  // page, a row the customer can claim against.
  await expect(page.getByText(/1 — the customer can claim without the paper/)).toBeVisible();

  // It is on the partner's own ledger…
  await page.goto(`${base()}/receipts?ref=${encodeURIComponent(ref)}`);
  await expect(page.getByText(item)).toBeVisible();
  await expect(page.getByText(ref).first()).toBeVisible();

  // …and, the point of the whole thing, on the customer's.
  const phone = await browser.newContext();
  try {
    await signIn(phone, fixtures().consumerEmail);
    const buyer = await phone.newPage();

    await buyer.goto('/receipts');
    await expect(buyer.getByText(ref).first()).toBeVisible();

    await buyer.goto('/warranties');
    await expect(buyer.getByText(item).first()).toBeVisible();

    // And they own it, so it can be transferred with the thing itself.
    await buyer.goto('/products');
    await expect(buyer.getByText(item).first()).toBeVisible();
  } finally {
    await phone.close();
  }
});

test('a code that was already used at this counter is refused in words staff can act on', async ({
  page,
  browser,
}) => {
  const token = await codeFromCustomerPhone(browser);
  await page.goto(`${base()}/counter`);

  await page.getByLabel(/pass code/i).fill(token);
  await page.getByRole('button', { name: /identify customer/i }).click();
  await expect(page.getByText('Selling to')).toBeVisible();

  // Same code, second time. The replay check is a unique index, so this is the
  // database refusing rather than the application remembering.
  await page.goto(`${base()}/counter`);
  await page.getByLabel(/pass code/i).fill(token);
  await page.getByRole('button', { name: /identify customer/i }).click();

  await expect(page.getByRole('alert').or(page.getByText(/already been used here/i))).toBeVisible();
  // It has not advanced: there is no basket to ring up against a refused code.
  await expect(page.getByRole('button', { name: /price this sale/i })).toHaveCount(0);
});

test('nonsense in the field is refused without saying whether any pass matched', async ({ page }) => {
  await page.goto(`${base()}/counter`);

  await page.getByLabel(/pass code/i).fill('OP1|px_notreal99|000000|1');
  await page.getByRole('button', { name: /identify customer/i }).click();

  // "could not be verified" is deliberately what an unknown pass and a bad
  // signature both say. A console that distinguished them would be an oracle.
  await expect(page.getByText(/could not be verified|not a .* code/i).first()).toBeVisible();
  await expect(page.getByText('Selling to')).toHaveCount(0);
});

test('the money columns on the review are the receipt’s, and nothing is added after it', async ({
  page,
  browser,
}) => {
  const token = await codeFromCustomerPhone(browser);
  await page.goto(`${base()}/counter`);

  await page.getByLabel(/pass code/i).fill(token);
  await page.getByRole('button', { name: /identify customer/i }).click();
  await expect(page.getByText('Selling to')).toBeVisible();

  await page.getByLabel('Item 1').fill('Table lamp');
  await page.getByLabel('Unit price (₹)').first().fill('1000');
  await page.getByLabel('Tax %').first().fill('18');
  await page.getByLabel('Discount (₹)').fill('100');

  await page.getByRole('button', { name: /price this sale/i }).click();

  // Tax follows what was actually charged: 18% of (1000 − 100), not of 1000.
  // Getting this backwards overcharges every discounted sale in the country.
  // Whole-rupee figures carry no paise anywhere in the product — `formatMoney`
  // drops them — so these read ₹162, not ₹162.00.
  await expect(page.getByRole('row', { name: /^Discount/ })).toContainText('₹100');
  await expect(page.getByRole('row', { name: /^Tax/ })).toContainText('₹162');
  await expect(page.getByRole('row', { name: /^Total/ })).toContainText('₹1,062');

  await expect(page.getByText(/Nothing is added after this screen/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /issue receipt for ₹1,062/i })).toBeVisible();
});
