/**
 * Browser tests, against a real dev server and a real database.
 *
 * These are not unit tests with a browser attached: every spec signs in as a
 * seeded person, walks screens the way that person would, and asserts on the
 * words and figures that reach the page. The point is that the guarantees the
 * product claims — a tenant cannot read another tenant, a verification page says
 * what it checked, a deal shows what it saves you — are checked end to end and
 * would break loudly if they stopped being true.
 *
 * Deliberate choices:
 *  · Chromium only. A second engine would double the runtime and catch styling
 *    differences these tests do not assert on.
 *  · `reuseExistingServer` — the dev server is usually already up. Playwright
 *    starts one only when port 3000 is free.
 *  · A 60s test timeout, because the Next dev server compiles a route the first
 *    time it is requested and the first hit on a cold page is genuinely slow.
 *  · One worker. The suite shares one Postgres database and one dev server, and
 *    sign-in is rate limited per identifier — parallel workers would produce
 *    failures that look like bugs and are not.
 */
import { defineConfig, devices } from '@playwright/test';

/** Playwright's own browser download is not present here; the binary is. */
const CHROMIUM = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],

  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    // A first retry is the cheapest place to collect a trace: the failure is
    // already known to be reproducible and nobody pays for it on a green run.
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 15_000,
    navigationTimeout: 60_000,
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          executablePath: CHROMIUM,
          // This container's egress proxy denies Google's hosts, and Chromium's
          // background services (safebrowsing, autofill, component updates,
          // sign-in) retry against them on every page load. Nothing under test
          // needs any of it, and each blocked attempt costs a connection
          // timeout — enough of them to turn a two-minute suite into forty.
          args: [
            '--disable-background-networking',
            '--disable-component-update',
            '--disable-sync',
            '--disable-features=OptimizationHints,Translate,MediaRouter,AutofillServerCommunication,CalculateNativeWinOcclusion',
            '--safebrowsing-disable-auto-update',
            '--no-default-browser-check',
            '--no-first-run',
            '--metrics-recording-only',
          ],
        },
      },
    },
  ],

  // The server to test against, started only if nothing is already there.
  //
  // `url` follows `E2E_BASE_URL`, and `reuseExistingServer` does the rest: point
  // the suite at a production build on another port, a staging host, or the real
  // deployment after a release, and Playwright finds it answering and runs
  // against it without starting anything. Point it at nothing and it starts the
  // dev server, which is what CI does.
  //
  //   E2E_BASE_URL=https://your-onepass-host npx playwright test
  //
  // Keyed off `url` rather than omitting the block when `E2E_BASE_URL` is set:
  // CI sets that variable to localhost:3000 and still needs the server started
  // for it, so inferring "external target" from the variable alone would leave
  // CI testing nothing.
  webServer: {
    command: 'npm run dev',
    url: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
