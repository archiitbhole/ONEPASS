/**
 * Screenshot one element rather than a whole page.
 *
 * `shot.mjs` gives a full-page image, which for a reference page is 16,000
 * pixels tall and useless for looking at a single component. This crops to one
 * selector — an endpoint block, an event card — which is the unit a change is
 * actually reviewed in.
 *
 * Run: node scripts/shot-el.mjs <out.png> <url> <selector> [width]
 */
import { chromium } from 'playwright';
const [out, url, selector, width] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: Number(width || 1440), height: 1000 } });
await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
await page.waitForTimeout(600);
const el = page.locator(selector).first();
await el.scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
await el.screenshot({ path: out });
console.log('ok', out);
await browser.close();
