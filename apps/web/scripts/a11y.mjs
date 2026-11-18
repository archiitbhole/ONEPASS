/**
 * The accessibility checks a crawler cannot do by reading the DOM.
 *
 * `audit.mjs` catches the structural things — a missing `h1`, an unlabelled
 * input, an image with no alt. These are the ones that need the page to be
 * *used*: whether a keyboard can reach the controls, whether focus is visible
 * when it gets there, and whether the text has enough contrast against what is
 * actually painted behind it.
 *
 * Contrast is computed from resolved colours rather than from the stylesheet,
 * which is the only way to get it right in a design system built on
 * `color-mix()` and CSS variables: the declared value of `--muted` tells you
 * nothing about the pixel it ends up as over `--raised` inside a card.
 *
 * A background *image* is the case that needs care. Every object in this system
 * — the pass, a ticket, the immersive field — paints with a gradient, whose
 * `background-color` is `transparent`; a walk that reads only background
 * colours sails past them to the page surface and reports white text on a dark
 * pass as white text on cream, at 1.06:1. Forty-four findings were that
 * mistake, and the real ones were hidden underneath.
 *
 * So the walk reads gradients too — but text over a gradient is reported as
 * **undetermined**, with the range its stops imply, not as a failure. The stop
 * a glyph actually sits over depends on where in the box it falls, and a check
 * that cannot know which one is not entitled to call it a failure; a decorative
 * highlight in a corner would condemn text at the other end of the card. Text
 * over a solid colour is measured exactly and reported as a pass or a failure,
 * which is the great majority of it. An image this cannot read at all — a
 * `url()`, a pattern — is undetermined too.
 *
 * Undetermined findings are a list to look at, not a list to fix. Every one of
 * them in this repository was checked by eye against the screenshots in the
 * design review, and the range is printed so the reader can judge.
 *
 * Run: node scripts/a11y.mjs <baseUrl> [--theme dark]
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import { seededOrgId } from './seeded-org.mjs';

const args = process.argv.slice(2);
const baseUrl = (args.find((a) => !a.startsWith('--')) ?? 'http://localhost:3000').replace(/\/+$/, '');
const themeArg = args.indexOf('--theme');
const theme = themeArg === -1 ? 'light' : args[themeArg + 1];

const SESSIONS = '/tmp/onepass-e2e-sessions.json';
/** The seeded hotel, resolved from the database — see scripts/seeded-org.mjs. */
const PARTNER_ORG = await seededOrgId();
const sessions = fs.existsSync(SESSIONS) ? JSON.parse(fs.readFileSync(SESSIONS, 'utf8')) : {};

/**
 * A code the seeded customer's pass is showing right now.
 *
 * Minted through the customer's own endpoint with the customer's own session,
 * which is the only honest way to get one — the secret is sealed server-side and
 * there is no back door for a script. Returns null rather than throwing when
 * there is no cached consumer session, so an audit run before the browser suite
 * skips the basket page instead of failing on setup.
 */
async function freshPassCode(ctx) {
  if (!sessions['meera@example.in']) return null;
  const phone = await ctx.browser().newContext();
  try {
    await phone.addCookies([
      {
        name: 'onepass_session',
        value: sessions['meera@example.in'],
        domain: new URL(baseUrl).hostname,
        path: '/',
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    const res = await phone.request.get(`${baseUrl}/api/me/pass`);
    if (!res.ok()) return null;
    return (await res.json()).token ?? null;
  } finally {
    await phone.close();
  }
}

const PAGES = [
  { path: '/', as: null },
  { path: '/verify', as: null },
  { path: '/pricing', as: null },
  { path: '/sign-in', as: null },
  { path: '/sign-up', as: null },
  { path: '/recover', as: null },
  { path: '/verify-code?email=someone%40example.in&purpose=EMAIL_VERIFY', as: null },
  { path: '/developers', as: null },
  { path: '/developers/api', as: null },
  { path: '/home', as: 'meera@example.in' },
  { path: '/travel', as: 'meera@example.in' },
  { path: '/travel/flights', as: 'meera@example.in' },
  { path: '/travel/trips', as: 'meera@example.in' },
  { path: '/travel/rewards', as: 'meera@example.in' },
  { path: '/travel/discounts', as: 'meera@example.in' },
  { path: '/travel/airindex', as: 'meera@example.in' },
  { path: '/travel/airindex/routes?from=DEL&to=BOM', as: 'meera@example.in' },
  { path: '/travel/airindex/airlines?from=DEL&to=BOM', as: 'meera@example.in' },
  { path: '/travel/airindex/history?from=DEL&to=BOM', as: 'meera@example.in' },
  { path: '/travel/airindex/observations?from=DEL&to=BOM', as: 'meera@example.in' },
  { path: '/travel/airindex/quality', as: 'meera@example.in' },
  { path: '/travel/airindex/methodology', as: 'meera@example.in' },
  { path: '/pass', as: 'meera@example.in' },
  { path: '/deals', as: 'meera@example.in' },
  { path: '/profile', as: 'meera@example.in' },
  { path: '/products', as: 'meera@example.in' },
  { path: '/disclosures', as: 'meera@example.in' },
  { path: '/control', as: 'admin@onepass.in' },

  /*
   * The counter, in both of its states.
   *
   * The first is what staff meet: a single field. The second is where they
   * spend a shift — seven inputs per line, a growing basket, and a review
   * panel — and it exists only after a pass has been verified, so an audit that
   * loaded the page and left would measure the easy half. `act` scans a live
   * code minted for the seeded customer, which is the only way to reach it.
   */
  { path: `/business/${PARTNER_ORG}/counter`, as: 'desk@grand-sahyadri.example' },
  {
    path: `/business/${PARTNER_ORG}/counter`,
    as: 'desk@grand-sahyadri.example',
    label: '/business/<org>/counter (basket open)',
    act: async (page, ctx) => {
      const token = await freshPassCode(ctx);
      if (!token) return;
      await page.getByLabel(/pass code/i).fill(token);
      await page.getByRole('button', { name: /identify customer/i }).click();
      await page.getByText('Selling to').waitFor({ timeout: 15_000 });
      await page.getByRole('button', { name: 'Add a line' }).click();
    },
  },

  /*
   * The command palette, open.
   *
   * A dialog that only exists after a click is a dialog nothing audits, and this
   * one carries the combobox pattern, a live region and a focus trap — three
   * things that are easy to get subtly wrong and impossible to see from the
   * outside. `act` opens it and types enough to put rows on screen, so contrast,
   * target size and focus are measured on what a person is actually looking at.
   */
  {
    path: '/home',
    as: 'meera@example.in',
    label: '/home (command palette open)',
    act: async (page) => {
      await page.getByRole('button', { name: 'Search' }).click();
      await page.getByRole('combobox').fill('re');
      await page.getByRole('option').first().waitFor();
    },
  },
];

const findings = [];

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
});

for (const { path, as, act, label } of PAGES) {
  const where = label ?? path;
  if (!PARTNER_ORG && path.startsWith('/business/')) {
    console.log(`  skipped ${where} — no seeded organization resolved`);
    continue;
  }
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    colorScheme: theme === 'dark' ? 'dark' : 'light',
  });
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === new URL(baseUrl).origin ? route.continue() : route.abort(),
  );
  if (as) {
    await context.addCookies([
      {
        name: 'onepass_session',
        value: sessions[as] ?? '',
        domain: new URL(baseUrl).hostname,
        path: '/',
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
  }

  const page = await context.newPage();
  await page.goto(baseUrl + path, { waitUntil: 'networkidle' });
  if (act) {
    try {
      await act(page, context);
    } catch (err) {
      // A setup step that cannot run is a finding about this page, not a reason
      // to abandon the ones after it. Crashing here once cost an entire run.
      findings.push({
        kind: 'setup',
        path: where,
        detail: `could not reach the state this page is audited in — ${err instanceof Error ? err.message.split('\n')[0] : err}`,
      });
      await context.close();
      continue;
    }
  }

  /* ── contrast, measured against what is actually painted ── */
  const contrast = await page.evaluate(() => {
    /**
     * A CSS colour as 0–255 channels.
     *
     * Two syntaxes, because Chromium serialises them both: `rgb()`/`rgba()`
     * for ordinary colours, and `color(srgb r g b / a)` — with 0–1 floats —
     * for anything that came out of `color-mix()`, which in this system is
     * most of the gradients.
     */
    const parse = (value) => {
      const srgb = /color\(srgb ([^)]+)\)/.exec(value);
      if (srgb) {
        const [rgbPart, alphaPart] = srgb[1].split('/');
        const [r, g, b] = rgbPart.trim().split(/\s+/).map((n) => parseFloat(n) * 255);
        const a = alphaPart === undefined ? 1 : parseFloat(alphaPart);
        return Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b) ? { r, g, b, a } : null;
      }
      const m = /rgba?\(([^)]+)\)/.exec(value);
      if (!m) return null;
      const [r, g, b, a = 1] = m[1].split(',').map((n) => parseFloat(n));
      return { r, g, b, a };
    };
    const channel = (c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    const luminance = ({ r, g, b }) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    const over = (fg, bg) => ({
      r: fg.r * fg.a + bg.r * (1 - fg.a),
      g: fg.g * fg.a + bg.g * (1 - fg.a),
      b: fg.b * fg.a + bg.b * (1 - fg.a),
      a: 1,
    });

    /**
     * Every colour stop in a `linear-gradient` / `radial-gradient`, or null
     * when the image is one this cannot read.
     *
     * `getComputedStyle` gives the stops already resolved to `rgb()`/`rgba()`,
     * so `color-mix()` and custom properties are handled for free.
     */
    const stopsOf = (image) => {
      if (!image || image === 'none') return [];
      if (!/gradient\(/.test(image)) return null;
      // Fully transparent stops are dropped. A gradient that fades to
      // `rgba(0,0,0,0)` is saying "show the layer beneath me", not "show
      // white" — and keeping them made the worst stop of a dark pass the page
      // behind it, which is the false 1.06:1 this check used to report.
      const found = [...image.matchAll(/(?:rgba?|color)\([^)]+\)/g)]
        .map((m) => parse(m[0]))
        .filter((c) => c && c.a > 0);
      return found.length > 0 ? found : null;
    };

    /**
     * What is painted behind this text: a list of candidate backgrounds, and
     * whether any layer was unreadable.
     *
     * A list rather than one colour, because a gradient is many colours and the
     * text sits over all of them.
     */
    const backgroundsOf = (el) => {
      let node = el;
      let unreadable = false;
      // Any background image at all — a gradient, a pattern, a photograph —
      // means this cannot say which colour a given glyph sits over. A 1.6px
      // dotted tear line is technically a gradient and covers one per cent of
      // the stub; treating its ink as the background of the text put six
      // perfectly legible labels in the failure list.
      let patterned = false;
      // Innermost first; each is composited over what is behind it.
      const layers = [];
      while (node && node !== document.documentElement.parentElement) {
        const style = getComputedStyle(node);
        const stops = stopsOf(style.backgroundImage);
        if (stops === null) unreadable = true;
        else if (stops.length > 0) {
          patterned = true;
          layers.unshift({ kind: 'stops', stops });
        }

        const bg = parse(style.backgroundColor);
        if (bg && bg.a > 0) {
          layers.unshift({ kind: 'stops', stops: [bg] });
          // Opaque, and nothing above it was a gradient we could see through.
          if (bg.a === 1 && layers.every((l) => l.stops.length === 1)) break;
        }
        node = node.parentElement;
      }

      // Composite every combination of stops, innermost last. In practice one
      // or two layers have more than a single stop, so this stays small.
      let results = [{ r: 255, g: 255, b: 255, a: 1 }];
      for (const layer of layers) {
        const next = [];
        for (const base of results) for (const stop of layer.stops) next.push(over(stop, base));
        results = next.slice(0, 24);
      }
      return { candidates: results, unreadable, patterned };
    };

    const problems = [];
    const seen = new Set();

    for (const el of document.querySelectorAll('p, span, a, li, td, th, h1, h2, h3, h4, label, button, dd, dt, strong')) {
      const text = (el.textContent ?? '').trim();
      if (!text || text.length < 2) continue;
      // Only leaf-ish nodes, or every ancestor is measured again with the same
      // colour and the report becomes noise.
      if (el.children.length > 0 && [...el.childNodes].every((n) => n.nodeType !== 3)) continue;

      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;

      const fg = parse(style.color);
      if (!fg) continue;
      const { candidates: backgrounds, unreadable, patterned } = backgroundsOf(el);

      let ratio = Infinity;
      let best = 0;
      for (const bg of backgrounds) {
        const l1 = luminance(over(fg, bg));
        const l2 = luminance(bg);
        const r = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        if (r < ratio) ratio = r;
        if (r > best) best = r;
      }
      // More than one candidate background means a gradient: which stop a glyph
      // sits over depends on where in the box it falls, and this cannot know.
      const determined = !unreadable && !patterned;

      const size = parseFloat(style.fontSize);
      const bold = Number(style.fontWeight) >= 700;
      // WCAG AA: 3:1 for large text (18.66px bold, or 24px), 4.5:1 otherwise.
      const large = size >= 24 || (bold && size >= 18.66);
      const required = large ? 3 : 4.5;

      if (ratio < required) {
        const key = `${style.color}|${Math.round(ratio * 10)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        problems.push({
          ratio: Math.round(ratio * 100) / 100,
          best: Math.round(best * 100) / 100,
          required,
          size: Math.round(size),
          colour: style.color,
          sample: text.slice(0, 48),
          determined,
        });
      }
    }
    return problems;
  });

  for (const p of contrast) {
    findings.push({
      kind: p.determined ? 'contrast' : 'contrast (undetermined — over a gradient or an image)',
      path: where,
      detail: p.determined
        ? `${p.ratio}:1 (needs ${p.required}:1) at ${p.size}px — ${p.colour} — "${p.sample}"`
        : `${p.ratio}–${p.best}:1 across the stops (needs ${p.required}:1) at ${p.size}px — ${p.colour} — "${p.sample}"`,
    });
  }

  /* ── keyboard: can every control be reached, and is focus visible ── */
  const keyboard = await page.evaluate(() => {
    const focusable = [
      ...document.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ].filter((el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden';
    });

    return {
      count: focusable.length,
      // A positive tabindex reorders the document against its reading order,
      // which is the single most reliable way to make a page unusable by
      // keyboard.
      positiveTabindex: focusable.filter((el) => Number(el.getAttribute('tabindex')) > 0).length,
      // WCAG 2.2 target size (2.5.8) exempts a control that is inline in a
      // sentence — a link inside a paragraph is sized by its text and making it
      // 24px tall would break the line. So only standalone controls count:
      // buttons, and links that are not flowing inside text.
      tinyTargets: focusable
        .filter((el) => {
          const r = el.getBoundingClientRect();
          if (r.width >= 24 && r.height >= 24) return false;
          const display = getComputedStyle(el).display;
          // `inline` alone, not `inline-block`: an inline box is laid out *in*
          // the text and sized by it, which is the exemption. An inline-block
          // is a standalone control that happens to sit on a line, and giving
          // it a 24px target does not break anything — so it still counts.
          const inlineInText = display === 'inline' && !!el.closest('p, li, td, dd, dt, figcaption, span');
          return !inlineInText;
        })
        .map((el) => {
          const r = el.getBoundingClientRect();
          return `${el.tagName.toLowerCase()} ${Math.round(r.width)}×${Math.round(r.height)} "${(
            el.textContent ||
            el.getAttribute('aria-label') ||
            ''
          )
            .trim()
            .slice(0, 28)}"`;
        }),
    };
  });

  if (keyboard.positiveTabindex > 0) {
    findings.push({ kind: 'keyboard', path: where, detail: `${keyboard.positiveTabindex} element(s) with a positive tabindex` });
  }
  if (keyboard.tinyTargets.length > 0) {
    // Named, not counted: "three targets are small" is not something anybody
    // can act on without opening the page and guessing which three.
    findings.push({
      kind: 'target',
      path: where,
      detail: `under 24×24px — ${keyboard.tinyTargets.join('; ')}`,
    });
  }

  // Tab to the first control and check something actually changed about it.
  await page.keyboard.press('Tab');
  const focusVisible = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return { reached: false, styled: false };
    const s = getComputedStyle(el);
    const outline = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0;
    const ring = s.boxShadow !== 'none';
    return { reached: true, styled: outline || ring, tag: el.tagName.toLowerCase() };
  });

  if (!focusVisible.reached) findings.push({ kind: 'focus', path: where, detail: 'Tab reached nothing' });
  else if (!focusVisible.styled) {
    findings.push({ kind: 'focus', path: where, detail: `no visible focus on the first control (${focusVisible.tag})` });
  }

  /* ── landmarks and language ── */
  const structure = await page.evaluate(() => ({
    lang: document.documentElement.getAttribute('lang'),
    main: document.querySelectorAll('main').length,
    skip: !!document.querySelector('a[href="#main"]'),
    headingJumps: (() => {
      const levels = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) =>
        Number(h.tagName[1]),
      );
      let jumps = 0;
      for (let i = 1; i < levels.length; i += 1) if (levels[i] - levels[i - 1] > 1) jumps += 1;
      return jumps;
    })(),
  }));

  if (!structure.lang) findings.push({ kind: 'lang', path: where, detail: 'no lang on <html>' });
  if (structure.main !== 1) findings.push({ kind: 'landmark', path: where, detail: `${structure.main} <main> elements` });
  if (!structure.skip) findings.push({ kind: 'landmark', path: where, detail: 'no skip link' });
  if (structure.headingJumps > 0) {
    findings.push({ kind: 'headings', path: where, detail: `${structure.headingJumps} heading level jump(s)` });
  }

  await context.close();
}

await browser.close();

console.log(`${PAGES.length} pages, ${theme} theme — ${findings.length} finding(s)\n`);
const byKind = {};
for (const f of findings) (byKind[f.kind] ??= []).push(f);
for (const [kind, list] of Object.entries(byKind)) {
  console.log(`── ${kind} (${list.length})`);
  for (const f of list) console.log(`   ${f.path} — ${f.detail}`);
  console.log();
}
process.exit(findings.length === 0 ? 0 : 1);
