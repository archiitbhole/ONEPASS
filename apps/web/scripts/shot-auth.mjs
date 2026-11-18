/**
 * Screenshot signed-in routes.
 *
 * Signs in through the same API the form posts to and injects the session
 * cookie, exactly as e2e/helpers.ts does — driving the sign-in form for every
 * shot would add a dozen chances to fail for a reason nobody is looking at.
 *
 * Usage: node scripts/shot-auth.mjs <outdir> <email> <baseUrl> <path> [path...]
 */
import { chromium, request as pwRequest } from 'playwright';
import { mkdir } from 'node:fs/promises';

const [outDir, email, baseUrl, ...paths] = process.argv.slice(2);
if (!outDir || !email || !baseUrl || paths.length === 0) {
  console.error('usage: node scripts/shot-auth.mjs <outdir> <email> <baseUrl> <path> [path...]');
  process.exit(1);
}

const PASSWORD = process.env.SAMPLE_PASSWORD ?? 'onepass-sample-password';
await mkdir(outDir, { recursive: true });

const api = await pwRequest.newContext({ baseURL: baseUrl });
// The API refuses a mutating request without a same-origin Origin header —
// see checkOrigin in src/lib/api.ts. e2e/helpers.ts sends the same thing.
const res = await api.post('/api/auth/sign-in', {
  data: { email, password: PASSWORD },
  headers: { origin: baseUrl },
});
if (!res.ok()) {
  console.error(`sign-in failed for ${email}: ${res.status()} ${await res.text()}`);
  process.exit(1);
}
const cookies = (await api.storageState()).cookies;
await api.dispose();

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});

for (const [label, width, height] of [
  ['mobile', 390, 844],
  ['desktop', 1440, 900],
]) {
  const ctx = await browser.newContext({ viewport: { width, height }, baseURL: baseUrl });
  await ctx.addCookies(cookies);
  for (const path of paths) {
    const slug = path.replace(/\W+/g, '_') || 'root';
    const page = await ctx.newPage();
    try {
      await page.goto(path, { waitUntil: 'networkidle', timeout: 45_000 });
      await page.waitForTimeout(700);
      const file = `${outDir}/${slug}-${label}.png`;
      await page.screenshot({ path: file, fullPage: label === 'desktop' });
      console.log(`ok ${file}`);
    } catch (err) {
      console.log(`FAIL ${path} @${label}: ${err.message.split('\n')[0]}`);
    } finally {
      await page.close();
    }
  }
  await ctx.close();
}

await browser.close();
