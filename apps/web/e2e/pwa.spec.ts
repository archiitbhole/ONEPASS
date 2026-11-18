/**
 * The installable app, and the one caching rule that matters.
 *
 * A service worker is a cache that sits between a person and the truth, so the
 * tests here are less about "does it install" and more about "does it refuse to
 * keep the things it must not keep". The last test is the important one: after
 * the worker has been through a real session it must hold no copy of any
 * authentication or personal-data response.
 */
import { test, expect } from '@playwright/test';
import { fixtures, signIn } from './helpers';
import { BRAND } from '../src/lib/brand';

test('the manifest is valid, linked, and describes an installable app', async ({ page, request }) => {
  const res = await request.get('/manifest.webmanifest');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('manifest+json');

  const manifest = JSON.parse(await res.text()) as {
    name: string;
    short_name: string;
    display: string;
    start_url: string;
    orientation: string;
    theme_color: string;
    background_color: string;
    icons: { src: string; sizes: string; purpose?: string }[];
  };

  // Read from the brand config, as the manifest is — a rename must not need
  // this test edited to keep passing.
  expect(manifest.name).toBe(BRAND.name);
  expect(manifest.short_name).toBe(BRAND.shortName);
  expect(manifest.display).toBe('standalone');
  expect(manifest.start_url).toBe('/');
  expect(manifest.orientation).toBe('portrait');
  // The browser chrome matches the page ground (tokens.css --paper-2), so a
  // launching app does not flash a different colour before first paint.
  expect(manifest.theme_color).toBe(BRAND.themeColor.light);
  expect(manifest.background_color).toBe(BRAND.themeColor.light);

  expect(manifest.icons.map((i) => i.sizes)).toEqual(
    expect.arrayContaining(['192x192', '512x512']),
  );
  // A maskable icon is what stops a launcher cropping the corners off the mark.
  expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true);

  // Every icon it names has to exist and be a real image.
  for (const icon of manifest.icons) {
    const asset = await request.get(icon.src);
    expect(asset.status(), `${icon.src} should be served`).toBe(200);
    expect(asset.headers()['content-type']).toContain('image/png');
    expect((await asset.body()).byteLength).toBeGreaterThan(1000);
  }

  await page.goto('/');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    'href',
    '/manifest.webmanifest',
  );
});

test('the consumer app registers the service worker', async ({ page, context, baseURL }) => {
  await signIn(context, fixtures().consumerEmail);
  await page.goto('/pass');

  const scope = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return registration.scope;
  });
  // Compared against the base URL rather than a literal origin: this suite also
  // runs against a deployed host via E2E_BASE_URL, where the scope is that
  // origin. A hardcoded localhost here made the suite unable to verify the very
  // deployment it exists to check.
  expect(scope).toBe(new URL('/', baseURL).toString());
});

test('the partner console does not register a service worker', async ({ page, context }) => {
  // A fresh context, so nothing the consumer tests registered is in scope here.
  await signIn(context, fixtures().cinemaOwnerEmail);
  await page.goto(`/business/${fixtures().orgs.phoenixCinemas}/dashboard`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Phoenix Cinemas');

  const registrations = await page.evaluate(async () =>
    (await navigator.serviceWorker.getRegistrations()).length,
  );
  expect(registrations, 'the desktop console must not install a cache in front of it').toBe(0);
});

test('no authentication or personal response is ever left in a cache', async ({ page, context }) => {
  await signIn(context, fixtures().consumerEmail);

  await page.goto('/pass');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });

  // Reload so the worker is actually controlling the page, then exercise the
  // endpoints it is forbidden to keep.
  await page.reload();
  await page.evaluate(async () => {
    await fetch('/api/me', { credentials: 'same-origin' });
  });
  await page.goto('/wallet');
  await page.goto('/tickets');

  const cached = await page.evaluate(async () => {
    const names = await caches.keys();
    const urls: string[] = [];
    for (const name of names) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) urls.push(new URL(request.url).pathname);
    }
    return urls;
  });

  expect(cached.filter((path) => path.startsWith('/api/auth/'))).toEqual([]);
  expect(cached.filter((path) => path.startsWith('/api/me'))).toEqual([]);

  // And nothing the app marked no-store, which is every screen that renders a
  // person: what the worker is allowed to keep is the static layer.
  for (const personal of ['/pass', '/wallet', '/tickets', '/profile']) {
    expect(cached, `${personal} is served no-store and must not be cached`).not.toContain(personal);
  }

  // The precached shell did land, so this is a working cache refusing the right
  // things rather than a cache that never ran.
  expect(cached).toContain('/manifest.webmanifest');
});

/**
 * The offline promise, kept and bounded.
 *
 * The product's caching stance is that nothing personal is stored, because the
 * Cache API is shared by every account on the browser profile. Tickets are the
 * one deliberate exception: a ticket's code is a reference the door reads, not
 * a secret, and single use is enforced server-side — so a stale copy can only
 * ever be refused. These tests assert both halves of that: the exception works,
 * and it stops exactly where it was drawn.
 */
/**
 * Wait until the device has kept a ticket.
 *
 * The copy is written by an effect, so it lands after hydration rather than
 * with the HTML. Asserting immediately after `goto` is a race that passes on a
 * fast machine and fails on a loaded one — which is the worst kind of test.
 */
async function keptTickets(page: import('@playwright/test').Page) {
  await expect
    .poll(
      () => page.evaluate(() => localStorage.getItem('onepass.offline.tickets.v1')),
      { message: 'the ticket page should copy the ticket to this device', timeout: 10_000 },
    )
    .toBeTruthy();
  return (await page.evaluate(() => localStorage.getItem('onepass.offline.tickets.v1')))!;
}

test.describe('offline', () => {
  test('a ticket opened once can be shown with the network down', async ({ page, context }) => {
    await signIn(context, fixtures().consumerEmail);

    // Open a real ticket, which is what copies it to the device.
    await page.goto('/tickets');
    const first = page.locator('a[href^="/tickets/tkt_"]').first();
    await expect(first).toBeVisible();
    const href = await first.getAttribute('href');
    await page.goto(href!);
    const reference = href!.split('/').pop()!;
    await keptTickets(page);

    // The offline screen is served by the worker from its precache, so the
    // worker has to have installed and finished warming before the network can
    // be taken away. Waiting for it is not test-fudging: it is the honest
    // precondition — a first visit that is cut off mid-install genuinely has
    // nothing to show, and the product does not pretend otherwise.
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            if (!('serviceWorker' in navigator)) return false;
            await navigator.serviceWorker.ready;
            return (await caches.match('/offline')) !== undefined;
          }),
        { message: 'the worker should precache the offline screen', timeout: 15_000 },
      )
      .toBe(true);

    // Now take the network away entirely and go to the offline screen.
    await context.setOffline(true);
    try {
      await page.goto('/offline');

      // The ticket is drawn from the device, code and all.
      await expect(page.getByRole('heading', { level: 1 })).toContainText('What you can still show');
      // `.ticket` — the object class. This said `article.tk`, which was the
      // class before the ticket became drawn stock; the selector had outlived
      // the markup and would have passed vacuously if `.first()` had matched
      // anything at all.
      const stub = page.locator('.ticket').first();
      await expect(stub).toBeVisible();
      // Exact, because the SVG's own <title> also names the reference.
      await expect(stub.getByText(reference, { exact: true })).toBeVisible();
      // A drawn code, not a placeholder: the QR is generated in the browser
      // from the reference, which is the whole reason this works with the radio
      // off.
      await expect(stub.locator('svg')).toBeVisible();
    } finally {
      await context.setOffline(false);
    }
  });

  test('offline says plainly what it cannot do, and the pass is on that list', async ({
    page,
    context,
  }) => {
    await signIn(context, fixtures().consumerEmail);
    await page.goto('/offline');

    const limits = page.locator('.card').filter({ hasText: 'What does not work offline' });
    await expect(limits).toBeVisible();
    // The pass is a rotating code and an old one is refused at a counter. A
    // cached pass is the single worst thing this product could ship, so the
    // screen has to say it is absent rather than leave it to be discovered.
    await expect(limits.getByText(/Your pass/)).toBeVisible();
    await expect(limits.getByText(/changes every thirty seconds/i)).toBeVisible();
  });

  test('never keeps a pass token on the device', async ({ page, context }) => {
    await signIn(context, fixtures().consumerEmail);
    await page.goto('/pass');
    await page.waitForTimeout(500);
    await page.goto('/offline');

    const stored = await page.evaluate(() => {
      const out: string[] = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key) out.push(`${key}=${localStorage.getItem(key) ?? ''}`);
      }
      return out.join('\n');
    });

    // Whatever else is on this device, it is not a pass. The minted token is a
    // TOTP envelope; storing one would let a screenshot outlive its window.
    expect(stored).not.toContain('px_');
    expect(stored.toLowerCase()).not.toContain('token');
    expect(stored.toLowerCase()).not.toContain('secret');
  });

  test('what is kept about a ticket is a ticket, not an identity', async ({ page, context }) => {
    await signIn(context, fixtures().consumerEmail);
    await page.goto('/tickets');
    const first = page.locator('a[href^="/tickets/tkt_"]').first();
    await page.goto((await first.getAttribute('href'))!);

    const kept = await keptTickets(page);

    const lowered = kept.toLowerCase();
    // A phone picked up by someone else should show them a cinema ticket, not
    // who it belongs to.
    expect(lowered).not.toContain('meera');
    expect(lowered).not.toContain('@example.in');
    expect(lowered).not.toContain('amountminor');
    expect(lowered).not.toContain('userid');
  });
});
