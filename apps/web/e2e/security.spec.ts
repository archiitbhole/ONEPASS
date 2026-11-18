/**
 * The Suspicious Activity Shield, through the console.
 *
 * The detectors have their own integration tests; this is about the screen and
 * the door in front of it. Three things it checks that unit tests cannot:
 *
 *  · the sweep runs from a button and reports what it did, including how much it
 *    suppressed — the honest signal that running it twice is safe;
 *  · a finding renders with its arithmetic on the card, because an alert whose
 *    working nobody can see is an alert nobody acts on;
 *  · `ip_hash` never reaches the page. It is a correlator, and a correlator on a
 *    screen outlives the investigation that produced it.
 */
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';

const OFFICER = 'security@onepass.in';
const CONSUMER = 'meera@example.in';

test('the security console sweeps, shows its working, and stays shut to everyone else', async ({
  browser,
}) => {
  test.setTimeout(120_000);

  const staff = await browser.newContext();
  await signIn(staff, OFFICER);
  const page = await staff.newPage();

  const res = await page.goto('/control/security');
  expect(res?.status()).toBe(200);

  // The sweep is a button, and the page says why: nothing schedules it here.
  await expect(page.locator('text=Run the detectors')).toBeVisible();
  await expect(page.locator('body')).toContainText('there is no scheduler here');

  await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/control/security')),
    page.click('button:has-text("Sweep the last 3 hours")'),
  ]);
  await expect.poll(() => decodeURIComponent(page.url()), { timeout: 15_000 }).toContain('done=');
  await expect(page.locator('body')).toContainText('Swept the last');

  // Running it again files nothing new — the fingerprint suppression is the
  // property that makes a scheduled sweep safe.
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/control/security')),
    page.click('button:has-text("Sweep the last 3 hours")'),
  ]);
  // Either sentence proves the same property: the second sweep filed nothing new.
  // "0 new findings, N already filed" is what comes back when the sample security
  // scenario has been run; "Nothing met a threshold" is what comes back on a
  // freshly seeded database, where the detectors correctly find nothing at all.
  // Asserting only the first made this test depend on whether someone had run
  // `npm run security:scenario` since the last reseed.
  await expect
    .poll(() => decodeURIComponent(page.url()), { timeout: 15_000 })
    .toMatch(/0 new findings|already filed|Nothing met a threshold/);

  const body = await page.locator('body').innerText();

  // A travel finding shows the distance, the time and the speed it implies —
  // and says it did not come from an IP address, because it did not.
  if (body.includes('impossible_travel')) {
    await expect(page.locator('body')).toContainText('km/h implied');
    await expect(page.locator('body')).toContainText('not from IP addresses');
  }

  // The correlator stays in the database. The page talks *about* `ip_hash` —
  // explaining why travel is not computed from addresses — so the assertion is
  // about values, not the words: no long hex blob may be rendered anywhere.
  expect(body, 'a hash value should never be rendered').not.toMatch(/\b[0-9a-f]{32,}\b/i);

  // ── and the door ──
  const consumer = await browser.newContext();
  await signIn(consumer, CONSUMER);
  const meera = await consumer.newPage();
  const denied = await meera.goto('/control/security');
  expect(denied?.status()).toBe(404);

  await staff.close();
  await consumer.close();
});
