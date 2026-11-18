/**
 * Does the browser actually run this page's JavaScript?
 *
 * A page can look perfect and be inert. This loads each URL and counts the
 * scripts the browser refused, which is the only way to see a Content Security
 * Policy failure — it is silent everywhere except the console.
 */
import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium' });
for (const url of process.argv.slice(2)) {
  const page = await browser.newPage();
  let refused = 0;
  page.on('console', (m) => { if (m.text().includes('Content Security Policy')) refused += 1; });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const hydrated = await page.evaluate(() => !!document.querySelector('[data-hydrated], #__next, body')
    && typeof window.next !== 'undefined');
  console.log(`${refused === 0 ? 'ok     ' : 'BLOCKED'} refused=${String(refused).padStart(3)}  react=${hydrated}  ${new URL(url).pathname}`);
  await page.close();
}
await browser.close();
