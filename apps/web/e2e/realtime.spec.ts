/**
 * The event stream, end to end, in a browser.
 *
 * This is the test the real-time layer never had. ONEPASS has carried an outbox,
 * a Redis fan-out and an SSE endpoint since the first schema, and every one of
 * them was exercised by unit tests while no browser had ever subscribed — so the
 * property that actually matters to a person at a door, that the screen changes
 * on its own, was never checked.
 *
 * Two contexts, deliberately: the merchant watches the door console while an
 * admission happens somewhere else entirely. Nothing in the watching page is
 * clicked, reloaded or polled by the test — if it updates, it updated because an
 * event travelled.
 */
import { test, expect } from '@playwright/test';
import { fixtures, signIn, withDb } from './helpers';

test('the door console updates when a ticket is admitted elsewhere', async ({ browser }) => {
  test.setTimeout(120_000);

  // A ticket that can be admitted *right now*, and the organization it belongs to.
  //
  // The validity window is part of the precondition, not a detail: `admitTicket`
  // rejects a ticket whose show has not started with NOT_YET_VALID, so asking
  // only for state = 'ISSUED' picks up tomorrow's tickets and the test then
  // fails on an admission the door was right to refuse.
  const ticket = await withDb(async (sql) => {
    const rows = await sql<{ public_ref: string; org: string }[]>`
      select t.public_ref, o.id as org
        from tickets t
        join organizations o on o.id = t.organization_id
       where t.state = 'ISSUED'
         and t.valid_from <= now()
         and (t.valid_until is null or t.valid_until > now())
       order by t.created_at desc
       limit 1
    `;
    return rows[0] ?? null;
  });
  test.skip(!ticket, 'no currently-admittable ticket in the sample data — run npm run db:refresh');

  const staff = await browser.newContext();
  await signIn(staff, fixtures().cinemaOwnerEmail);
  const console_ = await staff.newPage();

  // The stream is a client connection, so the page has to be live before the
  // event is emitted — an event published to nobody is not redelivered.
  await console_.goto(`/business/${ticket!.org}/door`);
  await console_.waitForLoadState('networkidle').catch(() => {});
  await expect(console_.getByRole('heading', { name: 'Door', exact: true })).toBeVisible();

  const streamOpen = await console_.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        const es = new EventSource('/api/events/stream');
        const done = (ok: boolean) => {
          es.close();
          resolve(ok);
        };
        es.onopen = () => done(true);
        es.onerror = () => done(false);
        setTimeout(() => done(false), 10_000);
      }),
  );
  expect(streamOpen, 'the SSE endpoint should accept a signed-in browser').toBe(true);

  // Admit from a second context — a different browser, as a different person at a
  // different door would.
  const scanner = await browser.newContext();
  await signIn(scanner, fixtures().cinemaOwnerEmail);
  const other = await scanner.newPage();
  await other.goto(`/business/${ticket!.org}/door`);
  await other.fill('input[name="reference"]', ticket!.public_ref);
  await other.click('button[type="submit"]');
  await other.waitForLoadState('networkidle').catch(() => {});

  // The watching page was never touched. It should catch up on its own.
  await expect
    .poll(
      async () => {
        const text = await console_.locator('body').innerText();
        return /live update/i.test(text);
      },
      { timeout: 30_000, message: 'the door console should report a live update' },
    )
    .toBe(true);

  await staff.close();
  await scanner.close();
});
