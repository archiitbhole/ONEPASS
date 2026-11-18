/**
 * What the specs need from the database, read once.
 *
 * Nothing about a seeded row is hardcoded in a spec. Organization ids are ULIDs
 * minted at seed time, credential references are random by design, and the
 * kettle's warranty expires two years after whenever the seed ran — so a test
 * that spelled any of them out would be a test that passed only on the machine
 * it was written on.
 *
 * The queries run here rather than in each spec for two reasons: the connection
 * is opened and closed exactly once, and a missing seed fails immediately with a
 * sentence about running `npm run db:seed` instead of surfacing later as five
 * unrelated assertion errors.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import Redis from 'ioredis';
import { FIXTURES_ENV, withDb, type Fixtures } from './helpers';

/**
 * Put the sample window back on today before anything is asserted about it.
 *
 * The seed writes "tonight" as a wall-clock time, and every hour after it runs
 * that becomes less true: offers end, slots fall behind the clock, and tickets
 * expire. A suite that ran green an hour after seeding and failed the next
 * morning would be reporting the age of the fixture, not a regression — and a
 * spec that admits a ticket consumes it, so the second run of the day had
 * nothing left to admit and skipped rather than failed, which is worse.
 *
 * This is `npm run db:refresh`, run as its own process rather than imported:
 * the maintenance module reaches into the application through the `@/` alias
 * and is meant to be run by tsx, which is exactly what the script does.
 * Idempotent, and about a second.
 */
function refreshSampleWindow(): void {
  try {
    execFileSync('npx', ['tsx', 'src/db/refresh.ts'], {
      cwd: path.resolve(__dirname, '..'),
      stdio: 'pipe',
      timeout: 120_000,
    });
  } catch (err) {
    // Not fatal on its own: the specs that need a current window say so plainly
    // when they find it stale. Failing the whole suite here would hide that.
    const detail = err instanceof Error ? err.message : String(err);
    console.warn(`E2E setup: could not refresh the sample window (${detail}). Specs may skip.`);
  }
}

/** Delete the sliding windows the limiters keep in Redis. */
async function clearRateLimitWindows(): Promise<void> {
  const url = process.env.REDIS_URL;
  if (!url) return;

  const client = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 });
  try {
    await client.connect();
    let cursor = '0';
    do {
      const [next, keys] = await client.scan(cursor, 'MATCH', 'rl:*', 'COUNT', 500);
      cursor = next;
      if (keys.length) await client.del(...keys);
    } while (cursor !== '0');
  } catch {
    // No Redis in this environment means the limiter is using its in-memory
    // fallback, which starts empty in a fresh process anyway.
  } finally {
    client.disconnect();
  }
}

function required<T>(rows: T[], what: string): T {
  const first = rows[0];
  if (first === undefined) {
    throw new Error(
      `E2E setup: no ${what} in the database. These tests read the seeded Pune ecosystem — run \`npm run db:seed\`, and \`npx tsx src/db/seed-credential.ts\` for the credential.`,
    );
  }
  return first;
}

export default async function globalSetup(): Promise<void> {
  refreshSampleWindow();

  const fixtures = await withDb(async (sql): Promise<Fixtures> => {
    const orgs = await sql<{ id: string; slug: string }[]>`
      select id, slug from organizations where slug in ('grand-sahyadri', 'phoenix-cinemas')
    `;
    const hotel = orgs.find((o) => o.slug === 'grand-sahyadri');
    const cinema = orgs.find((o) => o.slug === 'phoenix-cinemas');
    if (!hotel || !cinema) {
      throw new Error('E2E setup: the two sample organizations are missing. Run `npm run db:seed`.');
    }

    const credentials = await sql<{ public_ref: string }[]>`
      select public_ref
        from credentials
       where status = 'ACTIVE'
         and valid_from <= now()
         and (valid_until is null or valid_until > now())
       order by issued_at desc
       limit 1
    `;

    /**
     * The *seeded* kettle, named — not "whichever warranty expires last".
     *
     * The old query took the latest expiry, which is only unambiguous while the
     * suite leaves no warranties behind. It does not: `counter.spec.ts` rings up
     * a real sale on every run, so meera's shelf accumulates one more 24-month
     * warranty each time, and the fixture started pointing at one of those while
     * the page rendered another. The spec is called "warranties shows the
     * kettle"; this makes the fixture mean that.
     */
    const warranties = await sql<{ product_name: string; expires_on: string; months: number }[]>`
      select w.product_name, w.expires_on::text as expires_on, w.months
        from warranties w
        join users u on u.id = w.user_id
       where u.email = 'meera@example.in'
         and w.product_name ilike '%kettle%'
       order by w.expires_on desc
       limit 1
    `;

    const receipts = await sql<{ public_ref: string; descriptions: string[] }[]>`
      select r.public_ref,
             r.issued_at,
             array_agg(l.description order by l.position) as descriptions
        from receipts r
        join users u on u.id = r.user_id
        join receipt_lines l on l.receipt_id = r.id
       where u.email = 'meera@example.in'
       group by r.public_ref, r.issued_at
       order by r.issued_at desc
       limit 1
    `;

    const warranty = required(warranties, 'warranty for meera@example.in');
    const receipt = required(receipts, 'receipt for meera@example.in');

    return {
      orgs: { grandSahyadri: hotel.id.trim(), phoenixCinemas: cinema.id.trim() },
      credentialRef: required(credentials, 'active credential').public_ref.trim(),
      warranty: {
        productName: warranty.product_name,
        expiresOn: warranty.expires_on,
        months: warranty.months,
      },
      receipt: { publicRef: receipt.public_ref.trim(), lineDescriptions: receipt.descriptions },
      consumerEmail: 'meera@example.in',
      cinemaOwnerEmail: 'owner@phoenix-cinemas.example',
      hotelDeskEmail: 'desk@grand-sahyadri.example',
    };
  });

  // Start each run with the rate-limit windows empty.
  //
  // The limiters are real and stay switched on inside the specs — `support:open`
  // allows five filings in ten minutes, and the support spec files one. What
  // this clears is the residue of the *previous* run, which would otherwise make
  // the suite pass once and then return 429 for the next ten minutes. Clearing
  // the window is not the same as disabling the limiter, and disabling it is
  // what a test must never do to the thing it is testing.
  await clearRateLimitWindows();

  // Workers are forked after this returns, so they inherit what is set here.
  process.env[FIXTURES_ENV] = JSON.stringify(fixtures);
}
