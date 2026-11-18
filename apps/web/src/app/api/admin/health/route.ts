/**
 * System health, in detail — the authenticated counterpart to /api/health.
 *
 * The split is the point. /api/health is a liveness probe: public, no database,
 * no internal detail. /api/ready is a readiness probe: public, a verdict and
 * nothing else. This route is the one that answers "how is the platform actually
 * doing", so it can carry real numbers, and it is behind platform.health:read.
 *
 * The numbers chosen are the ones an operator acts on. Outbox depth and the age of
 * the oldest unpublished row say whether the realtime publisher is keeping up —
 * an outbox that stops draining is silent, because every write still succeeds.
 * Unacknowledged security events say whether anyone is working the queue. Counts
 * only: no row here carries a person's details.
 */
import { count, gte, isNull, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { ts } from '@/db/sql-helpers';
import { organizations, outboxEvents, securityEvents, transactions, users } from '@/db/schema';
import { json, route } from '@/lib/api';
import { authorize } from '@/lib/authz/authorize';
import { getEnv } from '@/lib/env';
import { redis } from '@/lib/redis';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Stamped by the deployment; absent locally, where the honest answer is "dev". */
const VERSION = process.env.APP_VERSION?.slice(0, 40) || 'dev';

/**
 * Conditional counts in one pass over each table. Postgres returns bigint for
 * count(), which the driver hands back as a string — mapWith(Number) is what keeps
 * `"41"` out of a JSON field the console will do arithmetic on.
 */
const countWhere = (condition: ReturnType<typeof sql>) =>
  sql<number>`count(*) filter (where ${condition})`.mapWith(Number);

async function redisState(): Promise<'up' | 'down' | 'not-configured'> {
  const client = redis();
  if (!client) return 'not-configured';
  try {
    await client.ping();
    return 'up';
  } catch {
    return 'down';
  }
}

export const GET = route(
  { rateLimit: { name: 'api:general', subject: (ctx) => ctx.actor?.userId ?? ctx.ip ?? 'anonymous' } },
  async ({ actor }) => {
    await authorize({ permission: 'platform.health:read', actor: actor ?? undefined });

    // "Today" is UTC, deliberately: an operational number that shifts with whoever
    // is reading it cannot be compared between two people on a call.
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);

    const [userStats, organizationStats, todayStats, outboxStats, securityStats, cache] = await Promise.all([
      db
        .select({
          total: count(),
          active: countWhere(sql`${users.status} = 'ACTIVE'`),
          suspended: countWhere(sql`${users.status} = 'SUSPENDED'`),
          pendingVerification: countWhere(sql`${users.status} = 'PENDING_VERIFICATION'`),
          newToday: countWhere(sql`${users.createdAt} >= ${ts(startOfDay)}`),
        })
        .from(users),
      db
        .select({
          total: count(),
          active: countWhere(sql`${organizations.status} = 'ACTIVE'`),
          pendingReview: countWhere(sql`${organizations.status} = 'PENDING_REVIEW'`),
          suspended: countWhere(sql`${organizations.status} = 'SUSPENDED'`),
        })
        .from(organizations),
      db
        .select({
          total: count(),
          captured: countWhere(sql`${transactions.status} = 'CAPTURED'`),
          failed: countWhere(sql`${transactions.status} = 'FAILED'`),
          // Minor units, summed in the database so no rounding happens in transit.
          capturedMinor: sql<number>`coalesce(sum(${transactions.amountMinor}) filter (where ${transactions.status} = 'CAPTURED'), 0)`.mapWith(
            Number,
          ),
        })
        .from(transactions)
        .where(gte(transactions.createdAt, startOfDay)),
      db
        .select({
          unpublished: count(),
          // Depth alone is ambiguous — a hundred rows a second old is a healthy
          // burst, one row an hour old is a publisher that has stopped.
          oldestUnpublishedAt: sql<Date | null>`min(${outboxEvents.createdAt})`,
        })
        .from(outboxEvents)
        .where(isNull(outboxEvents.publishedAt)),
      db
        .select({
          unacknowledged: count(),
          urgent: countWhere(sql`${securityEvents.severity} in ('HIGH', 'CRITICAL')`),
        })
        .from(securityEvents)
        .where(isNull(securityEvents.acknowledgedAt)),
      redisState(),
    ]);

    return json({
      status: 'ok',
      version: VERSION,
      environment: getEnv().NODE_ENV,
      uptime: Math.round(process.uptime()),
      // The database answered every query above; saying so is a fact, not a probe.
      dependencies: { database: 'up', redis: cache },
      users: {
        total: userStats[0]?.total ?? 0,
        active: userStats[0]?.active ?? 0,
        suspended: userStats[0]?.suspended ?? 0,
        pendingVerification: userStats[0]?.pendingVerification ?? 0,
        newToday: userStats[0]?.newToday ?? 0,
      },
      organizations: {
        total: organizationStats[0]?.total ?? 0,
        active: organizationStats[0]?.active ?? 0,
        pendingReview: organizationStats[0]?.pendingReview ?? 0,
        suspended: organizationStats[0]?.suspended ?? 0,
      },
      transactionsToday: {
        total: todayStats[0]?.total ?? 0,
        captured: todayStats[0]?.captured ?? 0,
        failed: todayStats[0]?.failed ?? 0,
        capturedMinor: todayStats[0]?.capturedMinor ?? 0,
        currency: 'INR',
        since: startOfDay,
      },
      outbox: {
        unpublished: outboxStats[0]?.unpublished ?? 0,
        oldestUnpublishedAt: outboxStats[0]?.oldestUnpublishedAt ?? null,
      },
      securityEvents: {
        unacknowledged: securityStats[0]?.unacknowledged ?? 0,
        urgent: securityStats[0]?.urgent ?? 0,
      },
    });
  },
);
