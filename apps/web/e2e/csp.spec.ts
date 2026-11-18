/**
 * The Content Security Policy has to let the application run.
 *
 * This exists because of a bug that shipped and stayed shipped. The CSP is
 * nonce-based; a prerendered page carries a build-time nonce; every response
 * carries a fresh one. They never match, so the browser refused every script on
 * every statically generated page — `/pricing` and `/verify` had no client
 * runtime at all in production, and nothing anywhere said so. The pages looked
 * perfect. The whole test suite passed.
 *
 * It survived because `next dev` renders every page per request, so the nonce
 * always matched wherever anyone was looking. **A policy bug is only visible
 * against a production build**, which is what this file insists on: run it with
 * `E2E_BASE_URL` pointing at a built server, or it refuses to pretend it
 * checked anything.
 *
 * What it asserts is deliberately not "the header is well-formed". A CSP is not
 * a string, it is a behaviour, and the only question worth asking is whether the
 * browser ran the page.
 */
import { test, expect } from '@playwright/test';

/**
 * One page from each shape the application renders: marketing, the public
 * verification flow, authentication, the documentation shell. Each was static
 * or dynamic for a different reason, which is exactly the variation that made
 * the original bug so easy to miss.
 */
const PAGES = [
  '/',
  '/pricing',
  '/verify',
  '/sign-in',
  '/sign-up',
  '/recover',
  '/developers',
  '/developers/api',
  '/developers/webhooks',
  '/developers/status',
];

test.describe('content security policy', () => {
  test('no page serves a script the browser refuses', async ({ page, baseURL }) => {
    const refusals: string[] = [];
    page.on('console', (message) => {
      const text = message.text();
      if (text.includes('Content Security Policy')) refusals.push(text.slice(0, 160));
    });

    for (const path of PAGES) {
      refusals.length = 0;
      await page.goto(path, { waitUntil: 'networkidle' });
      expect(refusals, `${baseURL}${path} — the browser refused ${refusals.length} script(s)`).toEqual(
        [],
      );
    }
  });

  test('React actually hydrates, on every page', async ({ page }) => {
    for (const path of PAGES) {
      await page.goto(path, { waitUntil: 'networkidle' });
      // Next exposes its router on the window once the client bundle has run.
      // Its absence is the single cheapest proof that no JavaScript executed —
      // which is precisely the state a mismatched nonce leaves a page in.
      await expect
        .poll(
          () => page.evaluate(() => typeof (window as unknown as { next?: unknown }).next),
          { message: `${path} never hydrated — no client JavaScript ran`, timeout: 10_000 },
        )
        .toBe('object');
    }
  });

  test('still sends the policy it claims to send', async ({ page }) => {
    const response = await page.goto('/');
    const csp = response?.headers()['content-security-policy'] ?? '';

    // The nonce is the whole point: without it, `strict-dynamic` permits
    // nothing and `'self'` permits every script on the origin including an
    // injected one.
    expect(csp).toMatch(/script-src[^;]*'nonce-[^']+'/);
    expect(csp).toContain("'strict-dynamic'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");

    // `unsafe-inline` and `unsafe-eval` are allowed nowhere in script-src in a
    // production build. Style is the one documented relaxation.
    const scriptSrc = csp.split(';').find((d) => d.trim().startsWith('script-src')) ?? '';
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    if (process.env.NODE_ENV === 'production') {
      expect(scriptSrc).not.toContain("'unsafe-eval'");
    }
  });

  test('two responses never reuse a nonce', async ({ page }) => {
    const nonces = new Set<string>();
    for (let i = 0; i < 3; i += 1) {
      const response = await page.goto(`/?cache-bust=${i}`);
      const csp = response?.headers()['content-security-policy'] ?? '';
      const found = /'nonce-([^']+)'/.exec(csp)?.[1];
      expect(found, 'every response must carry a nonce').toBeTruthy();
      nonces.add(found!);
    }
    // A nonce that repeats is a nonce an attacker can learn from one page and
    // spend on the next, which is the same as having none.
    expect(nonces.size).toBe(3);
  });
});
