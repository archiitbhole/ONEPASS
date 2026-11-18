/**
 * Walk the whole application and report what is actually wrong with it.
 *
 * Built because "check every page" done by hand is done once, badly, and never
 * again. This visits every route as each persona, follows every internal link it
 * finds, and records the things that do not show up in a unit test: a console
 * error, a hydration mismatch, a dead anchor, a page that scrolls sideways on a
 * phone, an image with no alt text, a form control with no label.
 *
 * It reports rather than asserts, because the point is to find the list — the
 * fixes and the regression tests that follow are separate work, and a crawler
 * that fails the build on its first finding tells you about one problem instead
 * of thirty.
 *
 * Run: node scripts/audit.mjs <baseUrl> [--width 390] [--json out.json]
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const args = process.argv.slice(2);
const baseUrl = (args.find((a) => !a.startsWith('--')) ?? 'http://localhost:3000').replace(/\/+$/, '');
const widthArg = args.indexOf('--width');
const width = widthArg === -1 ? 1280 : Number(args[widthArg + 1]);
const jsonArg = args.indexOf('--json');
const jsonOut = jsonArg === -1 ? null : args[jsonArg + 1];

/** Sessions minted by the e2e global setup; reused so this needs no sign-in flow. */
const SESSIONS = '/tmp/onepass-e2e-sessions.json';

/**
 * Who to walk as, and what each should be able to reach.
 *
 * `anonymous` is first because the public surface is the one a stranger judges
 * the product by, and it is the only one where a 404 is unambiguously a bug.
 */
const PERSONAS = [
  { name: 'anonymous', email: null, start: ['/', '/verify', '/pricing', '/developers', '/offline'] },
  { name: 'consumer', email: 'meera@example.in', start: ['/home', '/profile'] },
  { name: 'partner', email: 'owner@phoenix-cinemas.example', start: ['/business'] },
  { name: 'platform', email: 'admin@onepass.in', start: ['/control'] },
];

/** Routes that are meant to answer 404 for somebody — never counted as broken. */
const EXPECTED_MISSES = [/^\/business$/];

const findings = [];
function report(kind, persona, where, detail) {
  findings.push({ kind, persona, where, detail });
}

function sameOrigin(href) {
  try {
    const url = new URL(href, baseUrl);
    return url.origin === new URL(baseUrl).origin ? url : null;
  } catch {
    return null;
  }
}

/** Strip a path down to its shape, so 40 ticket ids are visited once. */
function shape(pathname) {
  return pathname
    .replace(/\/(?:tkt|bkg|rcp|ret|cred|ofr|con|chk|gft|spl)_[a-z0-9]+/gi, '/:ref')
    .replace(/\/[0-9A-HJKMNP-TV-Z]{26}/g, '/:id');
}

async function walk(browser, persona, sessions) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  if (persona.email) {
    const value = sessions[persona.email];
    if (!value) {
      report('setup', persona.name, '-', `no session for ${persona.email}; run the e2e global setup first`);
      await context.close();
      return;
    }
    await context.addCookies([
      {
        name: 'onepass_session',
        value,
        domain: new URL(baseUrl).hostname,
        path: '/',
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
  }

  // Abort everything that is not this origin.
  //
  // The application loads nothing from a third party, so anything cross-origin
  // is the browser itself — Chrome's autofill and variations endpoints. In a
  // sandbox with no egress those hang until they time out, and `networkidle`
  // waits for them: it turned a two-minute crawl into a five-minute one and
  // charged every page a delay that has nothing to do with the page.
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(baseUrl).origin) return route.continue();
    return route.abort();
  });

  const page = await context.newPage();
  const seen = new Set();
  const queue = [...persona.start];

  page.on('console', (message) => {
    const text = message.text();
    // A page that is *meant* to answer 404 makes the browser log the response.
    // Reporting that as a console error would mean the only way to have a clean
    // run is to stop refusing requests that ought to be refused.
    if (EXPECTED_MISSES.some((re) => re.test(new URL(page.url()).pathname))) return;
    if (message.type() !== 'error' && message.type() !== 'warning') return;
    // React's hydration complaint is the one warning that always matters: it
    // means the server and the browser disagreed about what the page says.
    const hydration = /hydrat|did not match|Text content does not match/i.test(text);
    if (message.type() === 'error' || hydration) {
      report(hydration ? 'hydration' : 'console', persona.name, page.url(), text.slice(0, 300));
    }
  });
  page.on('pageerror', (err) => {
    report('pageerror', persona.name, page.url(), String(err).slice(0, 300));
  });
  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText ?? '';
    // A cancelled navigation is normal; anything else is a resource that did
    // not load on a page somebody is looking at.
    if (/ERR_ABORTED|net::ERR_ABORTED/.test(failure)) return;
    report('requestfailed', persona.name, page.url(), `${request.url().slice(0, 160)} — ${failure}`);
  });

  while (queue.length > 0) {
    const path = queue.shift();
    const key = shape(path);
    if (seen.has(key)) continue;
    seen.add(key);

    let response;
    try {
      response = await page.goto(baseUrl + path, { waitUntil: 'networkidle', timeout: 30_000 });
    } catch (err) {
      report('navigation', persona.name, path, String(err).split('\n')[0]);
      continue;
    }

    const status = response?.status() ?? 0;
    if (status >= 400 && !EXPECTED_MISSES.some((re) => re.test(path))) {
      report('status', persona.name, path, `HTTP ${status}`);
      continue;
    }

    const page_ = await page.evaluate(() => {
      const doc = document;
      const out = {
        title: doc.title,
        h1s: [...doc.querySelectorAll('h1')].map((h) => h.textContent?.trim() ?? ''),
        overflow: doc.documentElement.scrollWidth - doc.documentElement.clientWidth,
        imagesWithoutAlt: [...doc.querySelectorAll('img')].filter((i) => !i.hasAttribute('alt')).length,
        // A control with no accessible name is a control a screen reader
        // announces as "edit text, blank".
        unlabelled: [...doc.querySelectorAll('input, select, textarea')].filter((el) => {
          if (el.type === 'hidden') return false;
          if (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')) return false;
          if (el.id && doc.querySelector(`label[for="${CSS.escape(el.id)}"]`)) return false;
          return !el.closest('label');
        }).length,
        buttonsWithoutName: [...doc.querySelectorAll('button')].filter(
          (b) => !(b.textContent ?? '').trim() && !b.getAttribute('aria-label'),
        ).length,
        // Anchors that go nowhere, and in-page anchors with no target.
        deadAnchors: [...doc.querySelectorAll('a[href]')]
          .map((a) => a.getAttribute('href'))
          .filter((h) => h === '#' || h === '' || h === 'javascript:void(0)'),
        brokenFragments: [...doc.querySelectorAll('a[href^="#"]')]
          .map((a) => a.getAttribute('href'))
          .filter((h) => h && h.length > 1 && !doc.querySelector(h)),
        links: [...doc.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')),
      };
      return out;
    });

    if (!page_.title || page_.title.trim() === '') report('meta', persona.name, path, 'no <title>');
    if (page_.h1s.length === 0) report('a11y', persona.name, path, 'no h1');
    if (page_.h1s.length > 1) report('a11y', persona.name, path, `${page_.h1s.length} h1 elements`);
    if (page_.overflow > 1) report('layout', persona.name, path, `scrolls ${page_.overflow}px sideways at ${width}px`);
    if (page_.imagesWithoutAlt > 0) report('a11y', persona.name, path, `${page_.imagesWithoutAlt} img without alt`);
    if (page_.unlabelled > 0) report('a11y', persona.name, path, `${page_.unlabelled} form control(s) with no label`);
    if (page_.buttonsWithoutName > 0) report('a11y', persona.name, path, `${page_.buttonsWithoutName} button(s) with no name`);
    for (const dead of new Set(page_.deadAnchors)) report('link', persona.name, path, `anchor goes nowhere: ${dead}`);
    for (const frag of new Set(page_.brokenFragments)) report('link', persona.name, path, `no target for ${frag}`);

    for (const href of page_.links) {
      if (!href) continue;
      const url = sameOrigin(href);
      if (!url) continue;
      if (url.pathname.startsWith('/api/')) continue;
      const next = url.pathname + url.search;
      if (!seen.has(shape(next))) queue.push(next);
    }
  }

  await context.close();
  return seen;
}

const sessions = fs.existsSync(SESSIONS) ? JSON.parse(fs.readFileSync(SESSIONS, 'utf8')) : {};
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
});

const visited = {};
for (const persona of PERSONAS) {
  const seen = await walk(browser, persona, sessions);
  visited[persona.name] = seen ? [...seen].sort() : [];
  console.log(`${persona.name}: ${visited[persona.name].length} routes`);
}
await browser.close();

// ── report ──
const byKind = {};
for (const f of findings) (byKind[f.kind] ??= []).push(f);

console.log(`\n${findings.length} finding(s) at ${width}px\n`);
for (const [kind, list] of Object.entries(byKind).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`── ${kind} (${list.length})`);
  const shown = new Set();
  for (const f of list) {
    const line = `   [${f.persona}] ${f.where} — ${f.detail}`;
    if (shown.has(line)) continue;
    shown.add(line);
    console.log(line);
  }
  console.log();
}

if (jsonOut) {
  fs.writeFileSync(jsonOut, JSON.stringify({ width, baseUrl, visited, findings }, null, 2));
  console.log(`written to ${jsonOut}`);
}

process.exit(findings.length === 0 ? 0 : 1);
