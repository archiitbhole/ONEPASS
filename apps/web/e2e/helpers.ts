/**
 * The shared machinery, so the specs stay readable.
 *
 * Two jobs:
 *  · Sign in without driving the sign-in form. The form itself is tested once,
 *    in auth.spec.ts; everywhere else it is setup, and typing a password twelve
 *    times would only add twelve chances to fail for a reason nobody cares
 *    about. Sign-in here posts to the same API the form posts to and injects the
 *    session cookie the server issued — the session is real, it is just not
 *    typed.
 *  · Read the seeded ids out of Postgres. Nothing in these specs is hardcoded:
 *    organization ids are ULIDs, credential references are random, and the
 *    kettle's warranty expires two years after whenever the seed last ran.
 *
 * Sign-in is memoised per email for the life of the worker. That is not just
 * speed: `auth:login:identifier` allows eight attempts per fifteen minutes, and
 * a suite that signed in afresh in every test would eventually rate-limit
 * itself and report it as a product failure.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import postgres from 'postgres';
import { expect, type BrowserContext, type Page } from '@playwright/test';

export const SAMPLE_PASSWORD = 'onepass-sample-password';
export const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

/** The env var global setup leaves the fixtures in, for the workers to read. */
export const FIXTURES_ENV = 'ONEPASS_E2E_FIXTURES';

export interface Fixtures {
  orgs: { grandSahyadri: string; phoenixCinemas: string };
  /** A real, active credential — the /v/<ref> page must verify it. */
  credentialRef: string;
  warranty: { productName: string; expiresOn: string; months: number };
  receipt: { publicRef: string; lineDescriptions: string[] };
  consumerEmail: string;
  cinemaOwnerEmail: string;
  /** Counter staff at Grand Sahyadri — the least-privileged partner role. */
  hotelDeskEmail: string;
}

// ── database ─────────────────────────────────────────────────

/**
 * Open one connection, run the queries, close it.
 *
 * Deliberately not a pool held open for the run: a lingering connection keeps
 * the worker process alive after the last test and turns a green run into a
 * hang.
 */
export async function withDb<T>(fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  loadEnv({ path: path.resolve(__dirname, '..', '.env') });
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set, and .env did not supply one.');

  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    return await fn(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** What global setup read out of the database, as the workers see it. */
export function fixtures(): Fixtures {
  const raw = process.env[FIXTURES_ENV];
  if (!raw) {
    throw new Error(
      `${FIXTURES_ENV} is not set — global setup did not run. Run the suite through \`npx playwright test\` rather than invoking a spec directly.`,
    );
  }
  return JSON.parse(raw) as Fixtures;
}

// ── sign-in ──────────────────────────────────────────────────

interface SessionCookie {
  name: string;
  value: string;
}

/**
 * Sessions survive between runs, on purpose.
 *
 * The cookie is cached outside the project and re-validated against `/api/me`
 * before it is trusted. A revoked or expired session simply fails that check and
 * a new one is minted, so the cache can never make a test pass against a session
 * the server no longer honours — and a second run of the suite costs the login
 * rate limiter nothing at all.
 */
const CACHE_FILE = path.join(os.tmpdir(), 'onepass-e2e-sessions.json');

const sessions = new Map<string, SessionCookie>();

function readCache(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) as Record<string, string>;
  } catch {
    return {};
  }
}

function writeCache(email: string, value: string): void {
  try {
    const all = readCache();
    all[email] = value;
    fs.writeFileSync(CACHE_FILE, JSON.stringify(all), { mode: 0o600 });
  } catch {
    // A cache that cannot be written is a slower suite, not a broken one.
  }
}

function cookieName(): string {
  return process.env.SESSION_COOKIE_NAME ?? 'onepass_session';
}

/** Does the server still honour this token? The only question worth asking. */
async function stillValid(value: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/api/me`, {
      headers: { cookie: `${cookieName()}=${value}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Post the credentials the form would post, and keep the cookie that comes back. */
async function mintSession(email: string, password: string): Promise<SessionCookie> {
  const res = await fetch(`${BASE_URL}/api/auth/sign-in`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // The API refuses a mutating request without a same-origin Origin header.
      // A browser always sends one; this helper stands in for a browser, so it
      // must too — and the check staying enforced is itself worth not bypassing.
      origin: BASE_URL,
    },
    body: JSON.stringify({ email, password, devicePlatform: 'e2e', deviceLabel: 'playwright' }),
  });

  if (res.status === 429) {
    throw new Error(
      `Sign-in for ${email} was rate limited (auth:login:identifier allows 8 attempts per 15 minutes). ` +
        'This is the rate limiter working, not a product failure — wait for the window, or clear the ' +
        `key with \`redis-cli del rl:auth:login:identifier:${email}\`.`,
    );
  }
  if (!res.ok) {
    throw new Error(`Sign-in for ${email} failed with HTTP ${res.status}: ${await res.text()}`);
  }

  // Node exposes each Set-Cookie separately; the session is the only one that matters.
  const name = cookieName();
  for (const header of res.headers.getSetCookie()) {
    const pair = header.split(';', 1)[0] ?? '';
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    if (pair.slice(0, eq).trim() !== name) continue;
    const value = pair.slice(eq + 1).trim();
    if (value) return { name, value };
  }

  throw new Error(`Sign-in for ${email} returned no ${name} cookie.`);
}

/**
 * Give this browser context a live session for the given sample account.
 *
 * The session is resolved once per email per worker — from the cross-run cache
 * where the server still honours it, otherwise minted — and then injected into
 * every context that asks, so a spec that opens twelve contexts still costs the
 * server one sign-in at most.
 */
export async function signIn(
  context: BrowserContext,
  email: string,
  password: string = SAMPLE_PASSWORD,
): Promise<void> {
  let cookie = sessions.get(email);

  if (!cookie) {
    const cached = readCache()[email];
    if (cached && (await stillValid(cached))) {
      cookie = { name: cookieName(), value: cached };
    } else {
      cookie = await mintSession(email, password);
      writeCache(email, cookie.value);
    }
    sessions.set(email, cookie);
  }

  await context.addCookies([
    {
      name: cookie.name,
      value: cookie.value,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    },
  ]);
}

/**
 * Drop a session from both caches after a test has ended it.
 *
 * Sessions are memoised for the life of the worker, which is right until a test
 * signs one out: the cache then keeps handing a revoked cookie to every later
 * spec, and those specs fail as "signed out" for a reason that has nothing to do
 * with them. A test that ends a session calls this, so the next `signIn` mints
 * a fresh one.
 */
export function forgetSession(email: string): void {
  sessions.delete(email);
  const cache = readCache();
  if (email in cache) {
    delete cache[email];
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache), { mode: 0o600 });
  }
}

/** Sign in and land on a page, which is what nearly every spec wants. */
export async function signInAndVisit(page: Page, email: string, pathname: string): Promise<void> {
  await signIn(page.context(), email);
  await page.goto(pathname);
}

// ── assertions the specs share ───────────────────────────────

/**
 * Assert that a path is a 404 for whoever this page is signed in as.
 *
 * Both halves matter. The status is the machine-readable answer and the words
 * are what a person sees; a page that rendered someone else's dashboard under a
 * 404 status would pass a status-only check.
 */
export async function expectNotFound(page: Page, pathname: string): Promise<void> {
  const response = await page.goto(pathname);
  expect(response?.status(), `${pathname} should answer 404`).toBe(404);
  await expect(page.getByText(/could not be found/i)).toBeVisible();
}

/** ₹1,234 or ₹1,234.50 — the app formats every figure through Intl for en-IN. */
export const RUPEES = /₹\s?[\d,]+(\.\d{2})?/;

/**
 * The date as `formatDate` in src/components/ui.tsx renders it, e.g. "6 Sep 2028".
 *
 * The specs compare against the page's own formatting rather than the ISO date,
 * because asserting on a raw `2028-09-06` would pass only if the page were
 * broken.
 */
export function formatSeededDate(isoDate: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(`${isoDate}T06:00:00Z`));
}

/**
 * A statistic on any console, found by its label.
 *
 * These used to be located with `.card` + `.num`, which tied five assertions
 * about *numbers* to the class names a component happened to be styled with —
 * so restyling `Stat` broke tests that had nothing to do with styling. `Stat`
 * now renders a named group, which is both the accessible thing and the stable
 * contract.
 */
export function stat(page: Page, label: string) {
  return page.getByRole('group', { name: label, exact: true });
}

/** The figure inside one of those groups. */
export function statValue(page: Page, label: string) {
  return stat(page, label).locator('.stat-value');
}
