/**
 * Manufacture the three shapes the Suspicious Activity Shield looks for.
 *
 *   npm run security:scenario
 *
 * WHY THIS IS A SEPARATE COMMAND, not part of the seed.
 *
 * The seed builds a Pune ecosystem that trades normally, and the detectors find
 * nothing in it — which is the correct result and the honest empty state. But a
 * security console nobody can ever see working is a console nobody trusts, so
 * this writes the evidence a real incident would leave and lets the real
 * detectors find it.
 *
 * Every row it writes is synthetic and says so: the security events that come
 * out of the sweep carry `scenario: 'sample'` alongside their real arithmetic, and
 * the auth events use identifiers that exist nowhere else. Nothing here is a
 * claim that anything actually happened — it is a rehearsal, run against the
 * same code path production would run.
 *
 * Run `npm run db:push && npm run db:seed` to get back to a clean database.
 */
import 'dotenv/config';
import { and, desc, eq, gte, isNotNull, sql as raw } from 'drizzle-orm';
import { sql as pg, db } from './client';
import * as t from './schema';
import { ulid } from '@/lib/ids';
import { runDetectors } from '@/lib/security/detect';

/** A venue with coordinates, in a named city. */
/** Written into every row this script creates, so the next run can find them. */
const SCENARIO_MARK = 'sample-security-scenario';

async function venueIn(cityName: string) {
  const [row] = await db
    .select({ id: t.venues.id, organizationId: t.venues.organizationId, name: t.venues.name, city: t.cities.name })
    .from(t.venues)
    .innerJoin(t.cities, eq(t.cities.id, t.venues.cityId))
    .where(and(eq(t.cities.name, cityName), isNotNull(t.venues.latitude), eq(t.venues.isActive, true)))
    .limit(1);
  return row ?? null;
}

async function main() {
  const startedAt = new Date();
  const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);

  // ── Clear the last rehearsal ───────────────────────────────
  // Everything this script writes is identifiable, so running it twice replays
  // the same scenario rather than stacking a second one on top. Without this,
  // "five enrolments" becomes twenty and the evidence stops matching the story.
  await db.delete(t.devices).where(eq(t.devices.label, 'Sample enrolment'));
  await db.delete(t.authEvents).where(raw`${t.authEvents.detail} ->> 'scenario' = 'sample'`);
  await db.delete(t.securityEvents).where(raw`${t.securityEvents.metadata} ->> 'scenario' = 'sample'`);
  await db.delete(t.passPresentations).where(eq(t.passPresentations.requestId, SCENARIO_MARK));

  // ── 1. Impossible travel ───────────────────────────────────
  // One pass presented in two cities six minutes apart. This is what a cloned
  // pass looks like: not a stolen phone, but a code copied and used elsewhere
  // while the holder still has theirs.
  const pune = await venueIn('Pune');
  const mumbai = await venueIn('Mumbai');

  const [holder] = await db
    .select({ id: t.passes.id, userId: t.passes.userId })
    .from(t.passes)
    .where(eq(t.passes.status, 'ACTIVE'))
    .orderBy(desc(t.passes.createdAt))
    .limit(1);

  if (pune && mumbai && holder) {
    const [counterRow] = await db
      .select({ max: raw<number>`coalesce(max(${t.passPresentations.counter}), 0)::int` })
      .from(t.passPresentations)
      .where(eq(t.passPresentations.passId, holder.id));
    const max = Number(counterRow?.max ?? 0);

    await db.insert(t.passPresentations).values([
      {
        id: ulid(),
        passId: holder.id,
        organizationId: pune.organizationId,
        venueId: pune.id,
        counter: max + 1,
        result: 'ACCEPTED',
        requestId: SCENARIO_MARK,
        createdAt: minutesAgo(26),
      },
      {
        id: ulid(),
        passId: holder.id,
        organizationId: mumbai.organizationId,
        venueId: mumbai.id,
        counter: max + 2,
        result: 'ACCEPTED',
        requestId: SCENARIO_MARK,
        createdAt: minutesAgo(20),
      },
    ]);
    console.log(`travel   one pass at ${pune.name} (Pune) then ${mumbai.name} (Mumbai), six minutes apart`);
  } else {
    console.log('travel   skipped — the seed has no pass, or no venue with coordinates in both cities');
  }

  // ── 2. Credential stuffing ─────────────────────────────────
  // One origin, eight different accounts, four minutes. The identifier hashes
  // are synthetic and match no real account.
  const ipHash = Buffer.from('sample-stuffing-origin'.padEnd(32, '.'));
  await db.insert(t.authEvents).values(
    Array.from({ length: 8 }, (_, i) => ({
      id: ulid(),
      userId: null,
      kind: 'LOGIN_FAILED' as const,
      identifierHash: Buffer.from(`sample-target-${i}`.padEnd(32, '.')),
      ipHash,
      detail: { scenario: 'sample' },
      createdAt: minutesAgo(18 - i * 0.5),
    })),
  );
  console.log('stuffing eight failed sign-ins from one origin against eight accounts, four minutes');

  // ── 3. Device burst ────────────────────────────────────────
  const [second] = await db
    .select({ id: t.users.id })
    .from(t.users)
    .where(eq(t.users.status, 'ACTIVE'))
    .orderBy(desc(t.users.createdAt))
    .limit(1);

  if (second) {
    await db.insert(t.devices).values(
      Array.from({ length: 5 }, (_, i) => ({
        id: ulid(),
        userId: second.id,
        handle: ulid(),
        label: 'Sample enrolment',
        platform: i % 2 === 0 ? 'android' : 'ios',
        createdAt: minutesAgo(30 - i * 4),
      })),
    );
    console.log('devices  five enrolments on one account inside twenty minutes');
  }

  // ── Now let the real detectors find it ─────────────────────
  console.log('\nrunning the detectors over the last 60 minutes…\n');
  const report = await runDetectors({ lookbackMinutes: 60 });

  // Mark what this rehearsal filed, so the next run can clear it.
  await db
    .update(t.securityEvents)
    .set({ metadata: raw`coalesce(${t.securityEvents.metadata}, '{}'::jsonb) || '{"scenario":"sample"}'::jsonb` })
    .where(and(raw`${t.securityEvents.kind} like 'suspicious.%'`, gte(t.securityEvents.createdAt, startedAt)));

  console.log(`found ${report.found}   written ${report.written}   already filed ${report.suppressed}`);
  for (const f of report.findings) {
    console.log(`\n  [${f.severity}] ${f.kind}`);
    console.log(`    ${f.summary}`);
    console.log(`    ${JSON.stringify(f.evidence)}`);
  }
  console.log('\nOpen /control/security as security@onepass.in to see them in the queue.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pg.end());
