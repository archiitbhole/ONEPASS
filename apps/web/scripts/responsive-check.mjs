/*
 * The responsive sweep: every important route, at every width that matters.
 *
 * Widths rather than "mobile and desktop": 320 is the narrowest screen anybody
 * still ships, 390 is a current phone, 768 a tablet, 1280 a laptop and 1920 a
 * desktop. A layout that works at the two ends and breaks at 768 is a layout
 * nobody checked in the middle.
 */
import { chromium, request as pwRequest } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { seededOrgId } from './seeded-org.mjs';

const base = process.argv[2] ?? 'http://localhost:4000';
const WIDTHS = [320, 390, 768, 1280, 1920];
// Resolved from the database, not written down — see scripts/seeded-org.mjs.
const ORG = await seededOrgId();
if (!ORG) {
  console.error('could not resolve the seeded organization; run scripts/bootstrap-dev.sh first');
  process.exit(1);
}

const ROUTES = [
  ['/', null], ['/pricing', null], ['/verify', null], ['/sign-in', null], ['/developers', null],
  ['/developers/api', null], ['/offline', null], ['/nope', null],
  ['/home', 'meera@example.in'], ['/pass', 'meera@example.in'], ['/wallet', 'meera@example.in'],
  ['/tickets', 'meera@example.in'], ['/receipts', 'meera@example.in'], ['/warranties', 'meera@example.in'],
  ['/returns', 'meera@example.in'], ['/bookings', 'meera@example.in'], ['/products', 'meera@example.in'],
  ['/savings', 'meera@example.in'], ['/explore', 'meera@example.in'], ['/deals', 'meera@example.in'],
  ['/plan', 'meera@example.in'], ['/split', 'meera@example.in'], ['/gifts', 'meera@example.in'],
  ['/city-pass', 'meera@example.in'], ['/explore-quests', 'meera@example.in'], ['/profile', 'meera@example.in'],
  ['/settings', 'meera@example.in'], ['/notifications', 'meera@example.in'], ['/help', 'meera@example.in'],
  ['/disclosures', 'meera@example.in'], ['/travel', 'meera@example.in'], ['/travel/flights', 'meera@example.in'],
  ['/travel/trips', 'meera@example.in'], ['/travel/airindex', 'meera@example.in'],
  ['/travel/stay', 'meera@example.in'], ['/travel/rewards', 'meera@example.in'],
  ['/travel/discounts', 'meera@example.in'],
  [`/business/${ORG}/dashboard`, 'owner@grand-sahyadri.example'],
  [`/business/${ORG}/bookings`, 'owner@grand-sahyadri.example'],
  [`/business/${ORG}/door`, 'owner@grand-sahyadri.example'],
  [`/business/${ORG}/counter`, 'owner@grand-sahyadri.example'],
  [`/business/${ORG}/inventory`, 'owner@grand-sahyadri.example'],
  [`/business/${ORG}/receipts`, 'owner@grand-sahyadri.example'],
  [`/business/${ORG}/returns`, 'owner@grand-sahyadri.example'],
  [`/business/${ORG}/loyalty`, 'owner@grand-sahyadri.example'],
  [`/business/${ORG}/insights`, 'owner@grand-sahyadri.example'],
  [`/business/${ORG}/api`, 'owner@grand-sahyadri.example'],
  [`/business/${ORG}/settings`, 'owner@grand-sahyadri.example'],
  ['/control', 'admin@onepass.in'], ['/control/users', 'admin@onepass.in'],
  ['/control/partners', 'admin@onepass.in'], ['/control/transactions', 'admin@onepass.in'],
  ['/control/security', 'admin@onepass.in'], ['/control/audit', 'admin@onepass.in'],
  ['/control/credentials', 'admin@onepass.in'], ['/control/health', 'admin@onepass.in'],
];

/*
  The session jar, shared with `ui-shots.mjs` so a QA sweep does not spend the
  sign-in rate limit (eight per account per fifteen minutes, correctly).
  Missing is the normal first-run case, not an error — this crashed with ENOENT
  on a clean checkout.
*/
const JAR = process.env.SESSION_JAR ?? '/tmp/.ui-shots-sessions.json';
let jar = {};
try {
  jar = JSON.parse(await readFile(JAR, 'utf8'));
} catch {
  jar = {};
}
async function cookiesFor(email) {
  if (!email) return [];
  if (jar[email]) return jar[email];
  const api = await pwRequest.newContext({ baseURL: base });
  const res = await api.post('/api/auth/sign-in', {
    data: { email, password: 'onepass-sample-password', devicePlatform: 'qa', deviceLabel: 'responsive' },
    headers: { origin: base },
  });
  if (!res.ok()) throw new Error(`sign-in ${email}: ${res.status()}`);
  jar[email] = (await api.storageState()).cookies;
  await api.dispose();
  await writeFile(JAR, JSON.stringify(jar, null, 2));
  return jar[email];
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium' });
let checked = 0;
const problems = [];

for (const width of WIDTHS) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, locale: 'en-IN', timezoneId: 'Asia/Kolkata' });
  const page = await ctx.newPage();
  for (const [path, as] of ROUTES) {
    const cookies = await cookiesFor(as);
    if (cookies.length) await ctx.addCookies(cookies);
    try {
      await page.goto(base + path, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(200);
    } catch (e) {
      problems.push({ width, path, what: 'goto: ' + String(e).slice(0, 80) });
      continue;
    }
    const over = await page.evaluate(() => {
      const doc = document.documentElement;
      const overflow = doc.scrollWidth - doc.clientWidth;
      if (overflow <= 0) return { overflow: 0, culprits: [] };
      const culprits = [];
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect();
        if (r.right > doc.clientWidth + 1 || r.width > doc.clientWidth + 1) {
          const parent = el.parentElement;
          const pr = parent ? parent.getBoundingClientRect() : null;
          const parentOver = pr ? pr.right > doc.clientWidth + 1 || pr.width > doc.clientWidth + 1 : false;
          // Content inside its own scroll box is meant to be wider.
          const scrolls = parent && ['auto', 'scroll'].includes(getComputedStyle(parent).overflowX);
          if (!parentOver && !scrolls) {
            culprits.push(`${el.tagName.toLowerCase()}.${String(el.className || '').slice(0, 30)} ${Math.round(r.width)}px`);
          }
        }
      }
      return { overflow, culprits: culprits.slice(0, 3) };
    });
    checked += 1;
    if (over.overflow > 0) problems.push({ width, path, what: `${over.overflow}px — ${over.culprits.join('; ') || 'no single culprit'}` });
  }
  // Per width rather than at the end: a sweep of 275 page loads that prints
  // nothing until it finishes is a sweep nobody can tell has stalled.
  console.log(`${width}px — ${ROUTES.length} routes checked, ${problems.filter((p) => p.width === width).length} problem(s)`);
  await ctx.close();
}
await browser.close();

console.log(`${checked} page-widths checked (${ROUTES.length} routes × ${WIDTHS.length} widths)`);
if (problems.length === 0) console.log('no horizontal overflow anywhere');
for (const p of problems) console.log(`  ${String(p.width).padStart(4)}px ${p.path} — ${p.what}`);
