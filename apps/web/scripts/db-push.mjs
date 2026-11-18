/**
 * `npm run db:push` — apply the schema, then put the isolation layer back.
 *
 * **Why this wrapper exists.** `drizzle-kit push` makes the database match
 * `src/db/schema.ts`, and anything the schema does not declare is, to it,
 * drift to be removed. The row-level-security policies and the consent view
 * `business_customer_view` live in `src/db/isolation.sql`, not in the schema —
 * so a bare push silently dropped all of them. Measured, not guessed: 34
 * policies before a push, 0 after, and the view gone. A database in that state
 * still serves every page, which is exactly why nobody would notice: tenant
 * isolation fails open, quietly, the first time anyone runs the documented
 * schema command against a live database.
 *
 * So the documented command now does both, in order, and refuses to report
 * success unless the isolation layer is verifiably present afterwards.
 * Arguments are forwarded to drizzle-kit unchanged (`npm run db:push -- --force`).
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import postgres from 'postgres';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
if (!process.env.DATABASE_URL) config({ path: path.join(root, '.env') });

const push = spawnSync('npx', ['drizzle-kit', 'push', ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
});
if (push.status !== 0) process.exit(push.status ?? 1);

const url = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
  console.error('db:push: DATABASE_URL is not set; cannot re-apply src/db/isolation.sql.');
  process.exit(1);
}

const sql = postgres(url, { max: 1, onnotice: () => {} });
try {
  // Idempotent by construction (CREATE OR REPLACE, DROP … IF EXISTS), so
  // re-applying after every push is safe.
  // The file is written for psql and opens with `\set ON_ERROR_STOP on`, a psql
  // meta-command the server itself does not understand. Stopping on the first
  // error is what the driver does anyway, so the meta-commands are dropped and
  // the SQL is sent as one simple-protocol batch.
  const script = readFileSync(path.join(root, 'src/db/isolation.sql'), 'utf8')
    .split('\n')
    .filter((line) => !/^\s*\\/.test(line))
    .join('\n');
  await sql.unsafe(script);

  const [{ policies }] = await sql`select count(*)::int as policies from pg_policies where schemaname = 'public'`;
  const [{ views }] = await sql`
    select count(*)::int as views from pg_views where viewname = 'business_customer_view'
  `;
  if (policies === 0 || views === 0) {
    console.error(`db:push: isolation layer missing after re-apply (policies=${policies}, view=${views}).`);
    process.exit(1);
  }
  console.log(`db:push: schema applied; isolation re-applied (${policies} row-level policies, consent view present).`);
} catch (err) {
  console.error(`db:push: could not re-apply src/db/isolation.sql — ${err instanceof Error ? err.message : err}`);
  process.exit(1);
} finally {
  await sql.end();
}
