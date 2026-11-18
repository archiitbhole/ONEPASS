/**
 * Finish the standalone bundle.
 *
 * `output: 'standalone'` traces the server and its node_modules, but Next does
 * not copy `.next/static` or `public/` into it — that is left to the deployer.
 * The Dockerfile does it in two COPY lines, so container deploys were fine; a
 * deploy that runs `node .next/standalone/apps/web/server.js` directly — a VM, a
 * process-based host — got a server that booted, answered, and served every page
 * with no CSS and no client JavaScript. It looks like a broken stylesheet rather
 * than a missing build step, which is why it is worth doing here rather than in
 * each deployment target's runbook.
 *
 * Runs automatically after `npm run build`.
 */
import { cp, access, readdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const standalone = join(web, '.next', 'standalone', 'apps', 'web');

const exists = async (p) => access(p).then(() => true).catch(() => false);

if (!(await exists(standalone))) {
  console.log('postbuild: no standalone output — nothing to complete.');
  process.exit(0);
}

for (const [from, to, label] of [
  [join(web, '.next', 'static'), join(standalone, '.next', 'static'), '.next/static'],
  [join(web, 'public'), join(standalone, 'public'), 'public'],
]) {
  if (!(await exists(from))) continue;
  await cp(from, to, { recursive: true });
  console.log(`postbuild: copied ${label} into the standalone bundle`);
}

/**
 * Take the developer's `.env` back out of the bundle.
 *
 * Next traces `.env` files into the standalone output. That is convenient and it
 * is also how a build machine's secrets end up inside a deployable artifact:
 * this one carried DATABASE_URL and ENCRYPTION_KEY, so anyone holding the build
 * — a registry, a CI artifact store, a colleague's laptop — held the keys that
 * decrypt every sealed pass.
 *
 * Runtime configuration is the host's job, and it already works: real
 * environment variables take precedence over these files, so removing them
 * changes nothing about a correctly configured deployment and removes the
 * failure mode where a host that was *not* configured quietly boots against the
 * developer's database instead of refusing to start.
 */
let removed = 0;
for (const entry of await readdir(standalone)) {
  if (entry === '.env' || entry.startsWith('.env.')) {
    await rm(join(standalone, entry), { force: true });
    removed += 1;
  }
}
if (removed > 0) {
  console.log(
    `postbuild: removed ${removed} .env file(s) from the bundle — configure the host's environment instead`,
  );
}

console.log('postbuild: bundle is self-contained — node .next/standalone/apps/web/server.js');
