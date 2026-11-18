/**
 * Screenshot a set of routes across widths and themes, for visual QA.
 *
 * Signs in through the API the form posts to (as e2e/helpers.ts does) once
 * per account, then captures each route at each width in light and dark,
 * full page. Also records console errors and horizontal overflow, which a
 * screenshot alone hides.
 *
 * Usage:
 *   node scripts/ui-shots.mjs <outdir> <baseUrl> <spec.json>
 * where spec.json is [{ "path": "/home", "as": "meera@example.in" }, ...]
 * Env: WIDTHS=390,1440  THEMES=light,dark  FULL=1  MOTION=reduce
 */
import { chromium, request as pwRequest } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const [outDir, baseUrl, specFile] = process.argv.slice(2);
if (!outDir || !baseUrl || !specFile) {
  console.error('usage: node scripts/ui-shots.mjs <outdir> <baseUrl> <spec.json>');
  process.exit(1);
}
const spec = JSON.parse(await readFile(specFile, 'utf8'));
const widths = (process.env.WIDTHS ?? '390,1440').split(',').map(Number);
const themes = (process.env.THEMES ?? 'light,dark').split(',');
const full = process.env.FULL !== '0';
const PASSWORD = process.env.SAMPLE_PASSWORD ?? 'onepass-sample-password';
await mkdir(outDir, { recursive: true });

/*
  Sessions, cached between runs as well as within one.

  Sign-in is rate limited to eight attempts per account per fifteen minutes —
  correctly — and a QA sweep that signs in afresh every time spends that budget
  in three runs and then fails with a 429 that looks like a broken tool. The jar
  is written beside the shots' parent directory and reused until the server
  rejects it.
*/
const sessions = new Map();
const JAR = process.env.SESSION_JAR ?? `${outDir}/../.ui-shots-sessions.json`;
let jar = {};
try { jar = JSON.parse(await readFile(JAR, 'utf8')); } catch { jar = {}; }

async function signIn(email) {
  const api = await pwRequest.newContext({ baseURL: baseUrl });
  const res = await api.post('/api/auth/sign-in', {
    data: { email, password: PASSWORD, devicePlatform: 'qa', deviceLabel: 'ui-shots' },
    headers: { origin: baseUrl },
  });
  if (!res.ok()) throw new Error(`sign-in failed for ${email}: ${res.status()} ${await res.text()}`);
  const c = (await api.storageState()).cookies;
  await api.dispose();
  return c;
}

/** Does this cookie jar still resolve to a signed-in session? */
async function stillValid(cookies) {
  const api = await pwRequest.newContext({ baseURL: baseUrl });
  await api.storageState();
  try {
    const res = await api.get('/api/me/notifications?limit=1', {
      headers: { cookie: cookies.map((c) => `${c.name}=${c.value}`).join('; ') },
    });
    return res.status() === 200;
  } catch {
    return false;
  } finally {
    await api.dispose();
  }
}

async function cookiesFor(email) {
  if (!email) return [];
  if (sessions.has(email)) return sessions.get(email);

  let cookies = jar[email];
  if (!cookies || !(await stillValid(cookies))) {
    cookies = await signIn(email);
    jar[email] = cookies;
    await writeFile(JAR, JSON.stringify(jar, null, 2));
  }
  sessions.set(email, cookies);
  return cookies;
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium' });
const report = [];
for (const item of spec) {
  const cookies = await cookiesFor(item.as);
  for (const theme of themes) {
    for (const width of widths) {
      const mobile = width < 700;
      const ctx = await browser.newContext({
        viewport: { width, height: mobile ? 844 : 900 },
        deviceScaleFactor: 1,
        colorScheme: theme,
        reducedMotion: process.env.MOTION === 'reduce' ? 'reduce' : 'no-preference',
        hasTouch: mobile,
        isMobile: mobile,
        locale: 'en-IN',
        timezoneId: 'Asia/Kolkata',
      });
      if (cookies.length) await ctx.addCookies(cookies);
      const page = await ctx.newPage();
      const errors = [];
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
      page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
      let status = 0;
      try {
        const res = await page.goto(baseUrl + item.path, { waitUntil: 'networkidle', timeout: 45000 });
        status = res?.status() ?? 0;
      } catch (e) { errors.push('goto: ' + String(e).slice(0, 120)); }
      await page.waitForTimeout(item.wait ?? 400);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      const name = `${item.path.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'root'}-${width}-${theme}.png`;
      // `animations: 'disabled'` for two reasons: a shot of a page mid-transition
      // is not comparable with the one before it, and Playwright waits for the
      // page to settle before it captures — so one element animating forever
      // (the ambient field, a pending spinner) times the whole capture out.
      // A failed shot is recorded and the sweep carries on: one slow page should
      // not cost the other thirty-nine.
      try {
        await page.screenshot({ path: `${outDir}/${name}`, fullPage: full, animations: 'disabled', timeout: 60000 });
      } catch (e) {
        errors.push('screenshot: ' + String(e).slice(0, 120));
      }
      report.push({ path: item.path, width, theme, status, overflow, errors, file: name });
      // Written after every shot rather than at the end: a sweep that is cut
      // short still leaves a readable report of what it did manage.
      await writeFile(`${outDir}/report.json`, JSON.stringify(report, null, 2));
      await ctx.close();
    }
  }
}
await browser.close();
await writeFile(`${outDir}/report.json`, JSON.stringify(report, null, 2));
for (const r of report) {
  const flags = [r.status !== 200 ? `status ${r.status}` : '', r.overflow > 0 ? `overflow ${r.overflow}px` : '', r.errors.length ? `${r.errors.length} console errors` : '']
    .filter(Boolean).join(', ');
  console.log(`${r.file}${flags ? '  ⚠ ' + flags : ''}`);
}
