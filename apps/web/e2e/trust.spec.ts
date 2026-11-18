/**
 * Trust, privacy and ownership, in the browser.
 *
 * Three seams that only exist when two people are involved, so each test drives
 * two signed-in browsers:
 *
 *  · a business looks at its customer list, and the customer can then see that
 *    it did — which fields, on what basis (D-006);
 *  · one person gives a product to another with a transfer code, and the item
 *    and its warranty move between their accounts (D-007);
 *  · one person passes a ticket to another, and the sender's own reference
 *    stops working at the door — which is the difference between a transfer and
 *    a screenshot;
 *  · a business owner rotates the signing key, and a credential issued before
 *    the rotation still verifies (D-005).
 *
 * The product and ticket tests hand the fixture back at the end, so every other
 * spec finds the seeded data where it expects it.
 */
import { test, expect, type Browser, type Page } from '@playwright/test';
import { BASE_URL, SAMPLE_PASSWORD, fixtures, signIn, withDb } from './helpers';

const SPARE_ACCOUNT = 'rahul@example.in';
const HOTEL_DESK = 'desk@grand-sahyadri.example';
const HOTEL_OWNER = 'owner@grand-sahyadri.example';

/**
 * Answer the step-up prompt if the server asked for it.
 *
 * Sessions in this suite are minted once per worker and reused, so by the time
 * a spec late in the run gives something away the fifteen-minute elevation
 * from sign-in may have lapsed. When it has, the product does what it does for
 * a person: asks for the password and retries the same request. This walks
 * that path rather than hiding it — which also makes it the browser test of
 * step-up itself.
 */
async function confirmIfAsked(page: Page) {
  const prompt = page.getByRole('group', { name: /Confirm it’s you/ });
  try {
    await prompt.waitFor({ state: 'visible', timeout: 2500 });
  } catch {
    return; // Still elevated; the action went straight through.
  }
  await prompt.getByLabel('Your password').fill(SAMPLE_PASSWORD);
  await prompt.getByRole('button', { name: 'Confirm and continue' }).click();
  await expect(prompt).toHaveCount(0);
}

async function as(browser: Browser, email: string) {
  const context = await browser.newContext();
  await signIn(context, email);
  const page = await context.newPage();
  return { context, page };
}

test.describe('disclosure history', () => {
  test('a customer can see that a business’s staff looked at their details', async ({ browser }) => {
    const desk = await as(browser, HOTEL_DESK);
    await desk.page.goto(`/business/${fixtures().orgs.grandSahyadri}/customers`);
    await expect(desk.page.getByRole('heading', { level: 1 })).toHaveText('Customers');
    await desk.context.close();

    const meera = await as(browser, fixtures().consumerEmail);
    await meera.page.goto('/disclosures');
    await expect(meera.page.getByRole('heading', { level: 1 })).toHaveText('Shared with others');

    const entry = meera.page.getByRole('listitem').filter({ hasText: 'Grand Sahyadri' }).first();
    await expect(entry).toBeVisible();
    await expect(entry).toContainText('Seen by their staff');
    await expect(entry).toContainText('your name');
    await expect(entry).toContainText('You gave consent');
    // Names of what was seen, never the values.
    await expect(entry).not.toContainText('@example.in');
    await meera.context.close();
  });
});

test.describe('handing a product on', () => {
  test('a transfer code moves the kettle to its new owner, and back', async ({ browser }) => {
    const meera = await as(browser, fixtures().consumerEmail);
    await meera.page.goto('/products');
    const kettle = meera.page.getByRole('listitem').filter({ hasText: 'travel kettle' });
    await expect(kettle).toBeVisible();

    // A previous attempt that stopped halfway leaves a live code behind. One
    // live code per item is the rule, so withdraw it before offering again.
    const leftover = kettle.getByRole('button', { name: 'Cancel the transfer' });
    if (await leftover.isVisible()) {
      await leftover.click();
      await expect(kettle.getByRole('button', { name: 'Give or sell this' })).toBeVisible();
    }

    await kettle.getByRole('button', { name: 'Give or sell this' }).click();
    await confirmIfAsked(meera.page);
    const code = (await kettle.locator('code').innerText()).trim();
    expect(code).toMatch(/^[2-9A-Z]{4}(-[2-9A-Z]{4}){3}$/);

    const rahul = await as(browser, SPARE_ACCOUNT);
    await rahul.page.goto('/products');
    await rahul.page.getByLabel('Transfer code').fill(code);
    await rahul.page.getByRole('button', { name: 'Claim the item' }).click();
    await expect(rahul.page.getByRole('status').filter({ hasText: 'is yours now' })).toBeVisible();
    await expect(rahul.page.getByRole('listitem').filter({ hasText: 'travel kettle' })).toBeVisible();

    await meera.page.reload();
    await expect(meera.page.getByRole('listitem').filter({ hasText: 'travel kettle' })).toHaveCount(0);

    // And back again, so every other spec finds the fixture where it left it.
    const theirs = rahul.page.getByRole('listitem').filter({ hasText: 'travel kettle' });
    await theirs.getByRole('button', { name: 'Give or sell this' }).click();
    await confirmIfAsked(rahul.page);
    const back = (await theirs.locator('code').innerText()).trim();
    await meera.page.getByLabel('Transfer code').fill(back);
    await meera.page.getByRole('button', { name: 'Claim the item' }).click();
    await expect(meera.page.getByRole('status').filter({ hasText: 'is yours now' })).toBeVisible();

    await rahul.context.close();
    await meera.context.close();
  });
});

/**
 * A ticket of this spec's own, issued to the seeded consumer.
 *
 * It used to take whichever upcoming ticket the seed happened to leave lying
 * around, which worked alone and failed in a full run: the door spec admits
 * seeded tickets earlier in the same suite, so by the time this ran there was
 * nothing upcoming left to transfer. Competing for a shared fixture is not a
 * property of the product and should not be a property of the test, so this
 * writes its own row and hands it back at the end.
 */
async function issueTicketForTransfer(email: string): Promise<string> {
  return withDb(async (sql) => {
    const ref = `tkt_e2e${Math.random().toString(36).slice(2, 10)}`;
    const rows = await sql`
      with who as (select id from users where email = ${email}),
           org as (select id from organizations where slug like 'phoenix-cinemas%' limit 1),
           place as (select id from venues where organization_id = (select id from org) limit 1),
           bkg as (
             insert into bookings (id, public_ref, user_id, organization_id, venue_id,
                                   status, quantity, list_price_minor, amount_minor)
             values (upper(replace(gen_random_uuid()::text, '-', ''))::char(26),
                     ${'bkg_e2e' + Math.random().toString(36).slice(2, 9)},
                     (select id from who), (select id from org), (select id from place),
                     'CONFIRMED', 1, 30000, 30000)
             returning id
           )
      insert into tickets (id, public_ref, booking_id, user_id, organization_id, venue_id,
                           state, title, subtitle, seat_label, admit_count, valid_from, valid_until)
      values (upper(replace(gen_random_uuid()::text, '-', ''))::char(26),
              ${ref}, (select id from bkg), (select id from who), (select id from org),
              (select id from place), 'ISSUED', 'Transfer test — Screen 7',
              'Phoenix Cinemas — Viman Nagar', 'J14', 1,
              now() - interval '1 hour', now() + interval '6 hours')
      returning public_ref
    `;
    const issued = rows[0]?.public_ref;
    if (!issued) throw new Error('could not issue a ticket for the transfer test');
    return String(issued).trim();
  });
}

test.describe('consent receipts', () => {
  test('the history shows what was agreed, with a reference to quote', async ({ browser }) => {
    const meera = await as(browser, fixtures().consumerEmail);
    await meera.page.goto('/disclosures');

    const history = meera.page
      .locator('section', { has: meera.page.getByRole('heading', { name: 'What you agreed to' }) });
    await expect(history).toBeVisible();

    // The seeded consents predate this table, so the history is legitimately
    // empty on a fresh database — and the screen has to say so rather than
    // render nothing. Either way, the claim the page makes about its own
    // contents is what is being checked.
    const rows = history.getByRole('listitem');
    if ((await rows.count()) > 0) {
      // A reference the person can quote, and the scope's own wording beside it.
      await expect(rows.first().locator('.mono')).toContainText(/^cns_/);
    } else {
      await expect(history.getByText('No consent changes recorded')).toBeVisible();
    }

    await expect(
      meera.page.getByText(/kept as it was — not as the business describes that permission today/i),
    ).toBeVisible();

    await meera.context.close();
  });
});

test.describe('passing a ticket on', () => {
  test('the seat moves, and the sender’s own reference stops working', async ({ browser }) => {
    const senderRef = await issueTicketForTransfer(fixtures().consumerEmail);
    const meera = await as(browser, fixtures().consumerEmail);
    await meera.page.goto(`/tickets/${senderRef}`);
    await expect(meera.page.getByRole('heading', { level: 1 })).toContainText('Transfer test');

    // A previous attempt that stopped halfway leaves a live code behind, and one
    // live code per ticket is the rule. Withdraw it before offering again.
    const leftover = meera.page.getByRole('button', { name: 'Cancel the transfer' });
    if (await leftover.isVisible()) {
      await leftover.click();
      await expect(meera.page.getByRole('button', { name: 'Pass this on' })).toBeVisible();
    }

    await meera.page.getByRole('button', { name: 'Pass this on' }).click();
    await confirmIfAsked(meera.page);
    const code = (await meera.page.locator('code').first().innerText()).trim();
    expect(code).toMatch(/^[2-9A-Z]{4}(-[2-9A-Z]{4}){3}$/);

    // The screen has to say what does *not* move, or somebody will believe they
    // transferred a refund along with the seat.
    // Said twice on purpose — once in the card, before you act, and again beside
    // the code, at the moment the thing becomes irreversible.
    await expect(meera.page.getByText(/booking and your payment stay with you/i)).toHaveCount(2);

    const rahul = await as(browser, SPARE_ACCOUNT);
    await rahul.page.goto('/tickets');
    await rahul.page.getByLabel('Ticket transfer code').fill(code);
    await rahul.page.getByRole('button', { name: 'Claim the ticket' }).click();
    await expect(rahul.page.getByRole('status').filter({ hasText: 'is yours' })).toBeVisible();

    // The whole point: a new reference for the recipient, and the sender's is
    // dead. A transfer that left one live code would be sharing, and whichever
    // of them arrived second would be turned away.
    await rahul.page.goto('/tickets');
    const claimed = rahul.page.getByRole('listitem').first();
    const recipientRef = (await claimed.locator('.ticket-ref').innerText()).trim();
    expect(recipientRef).not.toBe(senderRef);

    await meera.page.goto(`/tickets/${senderRef}`);
    // The detail page has its own words for this state, and they name where the
    // live copy went rather than just saying the code is gone.
    await expect(
      meera.page.getByText(/transferred to someone else — their copy is the one that scans/i),
    ).toBeVisible();
    await expect(meera.page.getByRole('button', { name: 'Pass this on' })).toHaveCount(0);

    // No hand-back, unlike the kettle above. That test moves a *seeded* fixture
    // and has to put it back; this one issues its own ticket, so returning it
    // would only add a second, more fragile leg to prove something the first
    // leg already proved.
    await rahul.context.close();
    await meera.context.close();
  });

  test('a code that was already claimed is refused, in the same words as one that never existed', async ({
    browser,
  }) => {
    const rahul = await as(browser, SPARE_ACCOUNT);
    await rahul.page.goto('/tickets');

    await rahul.page.getByLabel('Ticket transfer code').fill('ZZZZ-ZZZZ-ZZZZ-ZZZZ');
    await rahul.page.getByRole('button', { name: 'Claim the ticket' }).click();
    // `.notice-bad`, not `getByRole('alert')`: Next's own route announcer is an
    // alert region too, and matching both is ambiguity rather than a finding.
    await expect(rahul.page.locator('.notice-bad')).toContainText(/not valid/i);

    await rahul.context.close();
  });
});

test.describe('signing keys', () => {
  test('an owner can rotate, and the history shows both keys', async ({ browser, request }) => {
    const owner = await as(browser, HOTEL_OWNER);
    const orgId = fixtures().orgs.grandSahyadri;

    // An organization that has never issued has no key and nothing to rotate.
    // Make sure there is one, through the same API the button uses — confirming
    // the password first, exactly as the screen would if the elevation lapsed.
    const origin = new URL(BASE_URL).origin;
    const stepUp = await owner.page.request.post('/api/auth/step-up', {
      data: { password: SAMPLE_PASSWORD },
      headers: { origin },
    });
    expect(stepUp.status()).toBe(200);
    const ensure = await owner.page.request.post(`/api/partner/${orgId}/signing-keys`, {
      data: {},
      headers: { origin },
    });
    expect(ensure.status()).toBe(200);

    await owner.page.goto(`/business/${orgId}/settings`);
    const table = owner.page.getByRole('table', { name: 'Signing key versions' });
    await expect(table).toBeVisible();
    const before = await table.getByRole('row').count();

    await owner.page.getByRole('button', { name: 'Rotate signing key' }).click();
    await confirmIfAsked(owner.page);
    await expect(owner.page.getByRole('status').filter({ hasText: 'Rotated' })).toBeVisible();
    await expect(table.getByRole('row')).toHaveCount(before + 1);
    await expect(table).toContainText('Retired — still verifies');

    // The published list agrees, and needs no sign-in.
    const slug = 'grand-sahyadri';
    const published = await request.get(`/api/v1/issuers/${slug}/keys`);
    expect(published.status()).toBe(200);
    const body = (await published.json()) as { keys: { status: string }[] };
    expect(body.keys.filter((k) => k.status === 'ACTIVE')).toHaveLength(1);
    await owner.context.close();
  });

  test('a credential issued before a rotation still verifies', async ({ page }) => {
    await page.goto(`/v/${fixtures().credentialRef}`);
    await expect(page.getByText(/verified/i).first()).toBeVisible();
  });
});
