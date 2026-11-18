/**
 * The ONEPASS service worker.
 *
 * Registered from the consumer layout only. The partner and admin consoles are
 * desktop tools used on a connection that works, and an offline cache there
 * would only add a way for an operator to act on a stale figure.
 *
 * ── The caching rule, and why it is this way round ──────────────────────────
 *
 * NETWORK-FIRST for HTML documents and API responses. Everything a person opens
 * this app to look at is a fact about right now: whether a seat is still free,
 * what their points balance is, whether a ticket has already been admitted. A
 * stale ticket or a stale balance is worse than a slow one — it is the failure
 * that gets someone turned away at a door while their phone shows a pass the
 * server retired ten minutes ago. So the network is always asked first, and a
 * cached copy answers only when the network cannot.
 *
 * CACHE-FIRST for immutable static assets. Next fingerprints everything under
 * /_next/static, and the icons, fonts and manifest change only when the app is
 * rebuilt. Asking the network about them is latency spent on a question whose
 * answer cannot have changed.
 *
 * ── What is never cached, at all ────────────────────────────────────────────
 *
 * /api/auth/* and /api/me/* are passed straight through: never written to a
 * cache, never answered from one.
 *
 *   · They are per-person, and the Cache API is keyed by URL and shared by
 *     everyone who uses this browser profile. A cached /api/me would outlive a
 *     sign-out and could be replayed to whoever signed in next. Nothing keyed
 *     only by URL can be made account-aware, so the only safe answer is to keep
 *     them out of it entirely.
 *   · They are the things that must be true this second — a session, a device
 *     list, a pass, a points balance. Answering any of them from disk is
 *     answering with something the server may already have revoked.
 *
 * Beyond that hard rule, this worker obeys what the server says. A response
 * carrying `Cache-Control: no-store` or `private` is never stored, whatever
 * path it arrived on. ONEPASS marks every dynamic page and every personal API
 * response no-store, so in practice what settles in these caches is the static
 * asset layer — which is the correct outcome, not a defeated one: the app has
 * already decided its screens are not cacheable, and a worker that overrode
 * that would be caching secrets the application explicitly declined to cache.
 */

const VERSION = 'v2';
const STATIC_CACHE = `onepass-static-${VERSION}`;
const RUNTIME_CACHE = `onepass-runtime-${VERSION}`;
const CACHES = [STATIC_CACHE, RUNTIME_CACHE];

/** The real offline screen, not a string built in here. */
const OFFLINE_URL = '/offline';

/**
 * The shell, warmed at install.
 *
 * Only assets that are the same for everybody. Precaching a personal screen
 * would put one person's data on a shared, URL-keyed disk cache; precaching a
 * screen nobody opens offline would just spend their data.
 */
const SHELL = [
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  // The offline screen. It is the one page in the application that renders
  // nothing personal on the server — everything on it comes from this device —
  // so it is the same bytes for everybody and safe to hold in a shared,
  // URL-keyed cache. Precached rather than fetched on demand, because the
  // moment it is needed is the moment nothing can be fetched.
  OFFLINE_URL,
];

/** Requests whose responses must never be written to, or read from, a cache. */
function isNeverCacheable(url) {
  return url.pathname.startsWith('/api/auth/') || url.pathname.startsWith('/api/me/');
}

/** Fingerprinted or build-stable, therefore safe to answer from disk. */
function isImmutableAsset(url) {
  // A query string means somebody is busting a cache on purpose — the dev
  // server's `?v=` on every chunk is exactly that — so it is never immutable.
  if (url.search) return false;

  return (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/apple-touch-icon.png' ||
    url.pathname === '/manifest.webmanifest' ||
    /\.(?:woff2?|ttf|otf|png|jpe?g|svg|webp|avif|ico)$/.test(url.pathname)
  );
}

function isDocument(request) {
  return request.mode === 'navigate' || request.destination === 'document';
}

/** The server's own instruction, honoured rather than second-guessed. */
function isStorable(response) {
  if (!response || response.status !== 200 || response.type !== 'basic') return false;
  const directive = (response.headers.get('cache-control') || '').toLowerCase();
  return !directive.includes('no-store') && !directive.includes('private');
}

/**
 * The offline answer.
 *
 * The precached `/offline` page first, because it can do something: it reads
 * the tickets this device has kept and draws their codes in the browser, so
 * somebody at a cinema door with no signal still gets in. The string below is
 * the fallback for the case where even that is missing — a worker installed
 * before the page existed, or a cache a browser evicted — and it stays because
 * "no network and no answer" is worse than a plain sentence.
 */
async function offlineAnswer() {
  const cached = await caches.match(OFFLINE_URL);
  if (cached) return cached;
  return offlineDocument();
}

/** The last resort, built here so it needs neither a route nor a network. */
function offlineDocument() {
  const body = `<!doctype html>
<html lang="en-IN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Offline · ONEPASS</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100dvh; display:grid; place-items:center; padding:24px;
         background:#edf1ef; color:#0b211e;
         font:16px/1.55 "IBM Plex Sans",system-ui,-apple-system,sans-serif; }
  main { max-width:32rem; text-align:center; }
  h1 { font-size:1.5rem; margin:0 0 .5rem; letter-spacing:-.02em; }
  p { margin:0 0 1.25rem; color:#3d534f; }
  a { display:inline-block; padding:.7rem 1.2rem; border-radius:10px;
      background:#007253; color:#fff; text-decoration:none; font-weight:600; }
  @media (prefers-color-scheme: dark) {
    body { background:#08120f; color:#dfeae6; } p { color:#a6bab5; }
    a { background:#43bd99; color:#04211a; }
  }
</style></head>
<body><main>
  <h1>You are offline</h1>
  <p>ONEPASS shows you what is true right now, so it does not show you an old
     copy of your pass or your balance. Tickets you have already opened are kept
     on this device &mdash; try the offline screen.</p>
  <a href="/offline">Saved tickets</a>
</main></body></html>`;

  return new Response(body, {
    status: 503,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      // Generated here, so it carries its own policy rather than inheriting one.
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
    },
  });
}

/**
 * Warm the assets a precached page needs to actually run.
 *
 * Precaching `/offline` alone is a trap: the HTML arrives, and every script and
 * stylesheet it references is a fingerprinted URL this device may never have
 * requested. Offline, those fetches fail, the client component never mounts,
 * and the person at the cinema door gets a heading with nothing under it —
 * which is worse than the plain sentence it replaced, because it looks like the
 * app broke rather than like the network did.
 *
 * So the HTML is read at install and the build's own asset URLs are lifted out
 * of it. No manifest to keep in step with the bundler: the page names its own
 * dependencies and they change with it.
 */
async function warmPageAssets(cache, html) {
  const urls = new Set();
  // `src="/_next/static/…"` and `href="/_next/static/….css"`, in either quote.
  const pattern = /(?:src|href)=["'](\/_next\/static\/[^"']+)["']/g;
  let match;
  while ((match = pattern.exec(html)) !== null) urls.add(match[1]);

  await Promise.all(
    [...urls].map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => undefined)),
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      // Forgiving, one at a time: an asset missing from this build must not fail
      // the install and leave the app with no worker at all.
      await Promise.all(
        SHELL.map((path) =>
          cache.add(new Request(path, { cache: 'reload' })).catch(() => undefined),
        ),
      );

      try {
        const offline = await cache.match(OFFLINE_URL);
        if (offline) await warmPageAssets(cache, await offline.clone().text());
      } catch {
        /* A page that will render without its script is still better than none. */
      }

      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith('onepass-') && !CACHES.includes(name))
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

/** Network first; a stored copy answers only when the network does not. */
async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (isStorable(response)) {
      const cache = await caches.open(cacheName);
      void cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (isDocument(request)) return offlineAnswer();
    throw err;
  }
}

/** Cache first. Only ever reached for URLs whose content cannot change. */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response && response.status === 200 && response.type === 'basic') {
    void cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only GET is cacheable at all, and only our own origin is ours to cache.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // The live event stream must not be buffered or replayed.
  if (request.headers.get('accept') === 'text/event-stream') return;

  // Authentication and personal data: straight to the network, never stored,
  // never served from store. See the header comment for why.
  if (isNeverCacheable(url)) return;

  if (isImmutableAsset(url)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // Documents, API responses and everything else — RSC payloads included — are
  // fresh-first. Freshness is the product here.
  event.respondWith(networkFirst(request, RUNTIME_CACHE));
});

/**
 * Empty every cache on request.
 *
 * The page can post this after a sign-out, so nothing a previous session pulled
 * through survives into the next one on a shared device.
 */
self.addEventListener('message', (event) => {
  if (!event.data || event.data.type !== 'onepass:clear-caches') return;
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => name.startsWith('onepass-')).map((name) => caches.delete(name)),
      );
    })(),
  );
});
