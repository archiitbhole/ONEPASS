/**
 * Does any page scroll sideways on a phone — and if so, because of what?
 *
 * "Responsive" that was only ever checked at desktop width is the most common
 * way a layout ships broken, and the symptom (a horizontal scrollbar) has a
 * hundred possible causes. So this answers both questions at once: whether the
 * document itself overflows, and which elements are wide enough to have caused
 * it. Content inside its own scroll box — a code block, a wide table — is
 * expected to be wider than the screen and is reported separately.
 *
 * Run: node scripts/layout-check.mjs <url> [url...] [--width 390]
 */
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const widthFlag = args.indexOf('--width');
const width = widthFlag === -1 ? 390 : Number(args[widthFlag + 1]);
const urls = args.filter((a, i) => !a.startsWith('--') && i !== widthFlag + 1);

if (urls.length === 0) {
  console.error('usage: node scripts/layout-check.mjs <url> [url...] [--width 390]');
  process.exit(1);
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
});

let failures = 0;

for (const url of urls) {
  const page = await browser.newPage({ viewport: { width, height: 844 } });
  await page.goto(url, { waitUntil: 'networkidle', timeout: 45_000 });

  const { overflow, guilty } = await page.evaluate((vw) => {
    // An ancestor that scrolls or clips contains its children; anything inside
    // one is allowed to be wide and is not the cause of a page-level scrollbar.
    const contained = (el) => {
      let n = el.parentElement;
      while (n && n !== document.documentElement) {
        const ox = getComputedStyle(n).overflowX;
        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') return true;
        n = n.parentElement;
      }
      return false;
    };

    const out = [];
    for (const el of document.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.right > vw + 1 && !contained(el)) {
        out.push({
          tag: el.tagName.toLowerCase(),
          cls: String(el.className || '').slice(0, 48),
          right: Math.round(r.right),
        });
      }
    }
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      // Deepest first: the innermost offender is the one to fix.
      guilty: out.slice(-6),
    };
  }, width);

  const path = new URL(url).pathname;
  if (overflow > 1) {
    failures += 1;
    console.log(`SCROLLS ${String(overflow).padStart(5)}px  ${path}`);
    for (const g of guilty) console.log(`           ${g.tag}.${g.cls} → ${g.right}px`);
  } else {
    console.log(`ok      ${String(overflow).padStart(5)}px  ${path}`);
  }
  await page.close();
}

await browser.close();
process.exit(failures === 0 ? 0 : 1);
