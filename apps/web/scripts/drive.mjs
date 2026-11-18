/**
 * Drive a flow in the browser as a sample account, for visual QA.
 *
 * A screenshot of an empty state is not verification of a screen that is meant
 * to show something. This signs in once — through the same cached jar the
 * screenshot tool uses, so a QA session does not spend the sign-in rate limit —
 * and then runs whatever steps a small script file asks for.
 *
 *   node scripts/drive.mjs <steps.mjs> [baseUrl]
 *
 * The steps file default-exports `async ({ page, base }) => { ... }`.
 */
import { chromium, request as pwRequest } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const [stepsFile, baseUrl = 'http://localhost:3000'] = process.argv.slice(2);
if (!stepsFile) {
  console.error('usage: node scripts/drive.mjs <steps.mjs> [baseUrl]');
  process.exit(1);
}
const PASSWORD = process.env.SAMPLE_PASSWORD ?? 'onepass-sample-password';
const JAR = process.env.SESSION_JAR ?? '/tmp/.ui-shots-sessions.json';

let jar = {};
try { jar = JSON.parse(await readFile(JAR, 'utf8')); } catch { jar = {}; }

export async function cookiesFor(email) {
  if (jar[email]) return jar[email];
  const api = await pwRequest.newContext({ baseURL: baseUrl });
  const res = await api.post('/api/auth/sign-in', {
    data: { email, password: PASSWORD, devicePlatform: 'qa', deviceLabel: 'drive' },
    headers: { origin: baseUrl },
  });
  if (!res.ok()) throw new Error(`sign-in failed for ${email}: ${res.status()} ${await res.text()}`);
  jar[email] = (await api.storageState()).cookies;
  await api.dispose();
  await writeFile(JAR, JSON.stringify(jar, null, 2));
  return jar[email];
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ locale: 'en-IN', timezoneId: 'Asia/Kolkata' });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 200)); });

const steps = (await import(pathToFileURL(stepsFile).href)).default;
try {
  await steps({ page, ctx, base: baseUrl, cookiesFor });
} finally {
  await browser.close();
}
