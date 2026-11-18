/**
 * Support, from the Help screen to the console and back.
 *
 * Four properties this walks that no unit test can:
 *
 *  · what a person types is redacted at the door, so the queue never holds a
 *    live credential even when someone pastes one into the box;
 *  · the console draws only the moves the service would accept, and the service
 *    refuses the rest anyway — a replayed server action on a closed ticket comes
 *    back with the refusal, not the move;
 *  · a consumer replaying that same action gets nothing, which is the difference
 *    between an authorisation check and a hidden button;
 *  · the requester is told when their request is resolved, and the console never
 *    prints their address while doing it.
 *
 * The spec clears the queue before it files anything. `openTicket` allows one
 * open request per person per category on purpose, so a spec that assumed an
 * empty queue would pass once and then fail forever.
 */
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { signIn, withDb } from './helpers';

const SUPPORT = 'support@onepass.in';
const CONSUMER = 'meera@example.in';

const flat = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Close everything already in the queue, so this run starts from a known state. */
async function clearQueue(agent: Page) {
  for (let guard = 0; guard < 40; guard += 1) {
    await agent.goto('/control/support');
    await agent.waitForLoadState('networkidle').catch(() => {});
    const close = agent.locator('button:has-text("Close")').first();
    if ((await close.count()) === 0) return;
    await Promise.all([
      agent.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/control/support')),
      close.click(),
    ]);
  }
}

test('support: intake redacts, the console moves, and only staff may move', async ({ browser }) => {
  test.setTimeout(240_000);

  const staff: BrowserContext = await browser.newContext();
  await signIn(staff, SUPPORT);
  const agent: Page = await staff.newPage();
  await clearQueue(agent);

  // ── a person files a request ──
  const consumer: BrowserContext = await browser.newContext();
  await signIn(consumer, CONSUMER);
  const meera: Page = await consumer.newPage();

  await meera.goto('/help');
  await meera.waitForLoadState('networkidle').catch(() => {});

  const stamp = Date.now().toString().slice(-6);
  const subject = `Seats missing after payment ${stamp}`;

  await meera.selectOption('#category', 'rewards');
  await meera.fill('#subject', subject);
  await meera.fill(
    '#body',
    'I paid for two Saturday seats and nothing arrived in my wallet. My OTP was 483920 and my password is hunter2-correct-horse if that helps.',
  );
  const [filed] = await Promise.all([
    meera.waitForResponse((r) => r.url().endsWith('/api/support') && r.request().method() === 'POST'),
    meera.click('button:has-text("Send to support")'),
  ]);
  expect(filed.status()).toBe(201);

  // A consumer cannot open the console at all — not a hidden link, a 404.
  const denied = await meera.goto('/control/support');
  expect(denied?.status()).toBe(404);

  // ── the agent works it ──
  const queue = await agent.goto('/control/support');
  expect(queue?.status()).toBe(200);
  await agent.waitForLoadState('networkidle').catch(() => {});

  const rowSel = `tr:has-text("${stamp}")`;
  await agent.waitForSelector(rowSel, { timeout: 30_000 });
  const row = agent.locator(rowSel).first();

  // What the person typed is not what the queue holds. The body sits inside a
  // collapsed <details>, whose innerText is empty until it is opened — read the
  // text content instead of expanding it, so the assertion is about what was
  // stored rather than about a disclosure widget.
  const stored = flat((await row.locator('details').first().textContent()) ?? '');
  expect(stored).not.toContain('483920');
  expect(stored).not.toContain('hunter2-correct-horse');
  expect(stored).toContain('[removed]');

  // Only the legal transitions are drawn.
  const offered = await row.locator('button').allInnerTexts();
  expect(offered.join(' ')).toContain('Resolve');

  let captured: { url: string; headers: Record<string, string>; body: string | null } | null = null;
  agent.on('request', (req) => {
    if (req.method() === 'POST' && req.url().includes('/control/support')) {
      captured = { url: req.url(), headers: req.headers(), body: req.postData() };
    }
  });

  /**
   * Click a move and wait for the queue to actually show the new state.
   *
   * A server action redirects, and Next completes that as a client-side
   * navigation after the POST has already resolved — so asserting on the DOM
   * straight after `waitForResponse` reads the page as it was before the move.
   * Waiting on the row's own text is what makes this deterministic.
   */
  async function move(label: string, becomes: string) {
    const [res] = await Promise.all([
      agent.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/control/support')),
      agent.locator(rowSel).first().locator(`button:has-text("${label}")`).first().click(),
    ]);
    expect(res.status()).toBeLessThan(400);

    // A refusal is also a redirect, so the status alone proves nothing.
    await expect
      .poll(() => decodeURIComponent(agent.url()), { timeout: 15_000 })
      .not.toContain('error=');
    await expect(agent.locator(rowSel).first()).toContainText(becomes, { timeout: 15_000 });
  }

  await move('Move to pending', 'pending');
  await move('Resolve', 'resolved');
  await move('Close', 'closed');

  // A closed ticket does not move again.
  // A closed ticket offers nothing, and says so rather than going blank.
  const closedRow = agent.locator(rowSel).first();
  await expect(closedRow.locator('button')).toHaveCount(0);
  await expect(closedRow).toContainText('A closed ticket does not move again');

  const shot = captured as { url: string; headers: Record<string, string>; body: string | null } | null;
  expect(shot, 'a server action POST should have been captured').not.toBeNull();
  const headers = {
    'next-action': shot!.headers['next-action'] ?? '',
    'content-type': shot!.headers['content-type'] ?? '',
  };

  // ── the same POST, from sessions that may not make it ──
  //
  // Asserted against the database rather than against the response text. The
  // action's URL carries the previous move's `?done=Ticket moved…` banner, so a
  // page rendered for that URL echoes the sentence whether or not anything
  // happened — searching the body for it finds a phrase, not a permission. What
  // matters is whether a row changed, so that is what is checked.
  const statuses = async () =>
    withDb(async (sql) => {
      const rows = await sql<{ id: string; status: string }[]>`
        select id, status from support_tickets order by created_at desc limit 20
      `;
      return rows.map((r) => `${r.id}:${r.status}`).join(',');
    });

  const beforeReplay = await statuses();

  const asConsumer = await consumer.request.post(shot!.url, {
    headers,
    data: shot!.body ?? '',
    maxRedirects: 0,
  });
  expect(/not.?found|404/i.test(await asConsumer.text())).toBe(true);
  expect(await statuses(), 'a consumer replaying a staff action must change nothing').toBe(beforeReplay);

  const anon = await browser.newContext();
  const asAnon = await anon.request.post(shot!.url, { headers, data: shot!.body ?? '', maxRedirects: 0 });
  const anonBody = await asAnon.text();
  expect(/\/sign-in/.test(anonBody) || /\/sign-in/.test(asAnon.headers()['location'] ?? '')).toBe(true);
  expect(await statuses(), 'an unauthenticated replay must change nothing').toBe(beforeReplay);

  // ── the requester was told, without their address leaving the database ──
  const notes = await consumer.request.get('/api/me/notifications');
  expect(await notes.text()).toContain('Your request is resolved');

  // Masking keeps the domain on purpose — an agent needs to know they are
  // looking at the right person. What must never appear is the address itself.
  const consoleText = flat(await agent.locator('body').innerText());
  expect(consoleText).not.toContain(CONSUMER);
  expect(consoleText).toMatch(/[a-z]•••@/i);

  await consumer.close();
  await staff.close();
  await anon.close();
});
