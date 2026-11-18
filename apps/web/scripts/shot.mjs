/**
 * Screenshot a list of routes, so a visual change can be looked at rather than
 * assumed. Run: node scripts/shot.mjs <outdir> <url> [url...]
 *
 * Two widths per route — 390px and 1440px — because "responsive" that was only
 * ever checked at desktop is the most common way a layout ships broken.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const [outDir, ...urls] = process.argv.slice(2);
if (!outDir || urls.length === 0) {
  console.error('usage: node scripts/shot.mjs <outdir> <url> [url...]');
  process.exit(1);
}

await mkdir(outDir, { recursive: true });
// The sandbox ships a Chromium build at a fixed path; the version Playwright
// expects by default may not match it, so point at the one that is here.
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
});

for (const url of urls) {
  const slug = new URL(url).pathname.replace(/\W+/g, '_') || 'root';
  for (const [label, width, height] of [
    ['mobile', 390, 844],
    ['desktop', 1440, 900],
  ]) {
    const page = await browser.newPage({ viewport: { width, height } });
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 45_000 });
      // Let the reveal animations settle so the shot is the resting state.
      await page.waitForTimeout(900);
      const file = `${outDir}/${slug}-${label}.png`;
      await page.screenshot({ path: file, fullPage: label === 'desktop' });
      console.log(`ok ${file}`);
    } catch (err) {
      console.log(`FAIL ${url} @${label}: ${err.message.split('\n')[0]}`);
    } finally {
      await page.close();
    }
  }
}

await browser.close();
