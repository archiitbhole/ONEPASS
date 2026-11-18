/**
 * System health.
 *
 * The figures are the ones an operator acts on rather than the ones that look
 * busy. Outbox depth *and* the age of its oldest unpublished row, because depth
 * alone is ambiguous — a hundred rows a second old is a healthy burst, one row an
 * hour old is a publisher that has stopped, and a stopped publisher is silent:
 * every write still succeeds. Unacknowledged security events, because a queue
 * nobody is working looks exactly like a quiet week.
 *
 * ── Database isolation, read from the running process ─────────
 * The card at the top is `isolationStatus()` from src/db/domains.ts, not a claim
 * written into this page. It reports which of the three domain roles actually
 * have a connection string configured *right now*, and it says plainly when they
 * do not: three unset URLs means all three domains share one connection, and
 * grant-level separation — the thing that makes `select * from users` fail on a
 * business connection with "permission denied" rather than returning rows — is
 * not in force. A deployment that has not enabled it should read that here rather
 * than infer it from a document that was true when it was written.
 *
 * Every date filter here goes through `ts()`. Interpolating a JavaScript Date
 * into a `sql` template hands the driver a value with no type mapper and fails
 * with a message that says nothing about dates; see src/db/sql-helpers.ts. The
 * admin health *API* still does it, and 500s for that reason — the counts below
 * are read directly rather than through it.
 */
import type { Metadata } from 'next';
import { count, isNull, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { ts } from '@/db/sql-helpers';
import { isolationStatus } from '@/db/domains';
import { organizations, outboxEvents, securityEvents, transactions, users } from '@/db/schema';
import {
  Badge,
  Card,
  CardHead,
  DefinitionList,
  Notice,
  Stat,
  TableScroll,
  formatDateTime,
  formatMoney,
  formatRelative,
} from '@/components/ui';
import { PageHeader } from '@/components/partner/shell';
import { requirePlatform } from '@/components/admin/guard';
import { getEnv } from '@/lib/env';
import { redis } from '@/lib/redis';

export const metadata: Metadata = { title: 'Health' };
export const dynamic = 'force-dynamic';

/** Stamped by the deployment; absent locally, where the honest answer is "dev". */
const VERSION = process.env.APP_VERSION?.slice(0, 40) || 'dev';

type Reachability = 'up' | 'down' | 'not-configured';

async function redisState(): Promise<Reachability> {
  const client = redis();
  if (!client) return 'not-configured';
  try {
    await client.ping();
    return 'up';
  } catch {
    return 'down';
  }
}

/** A real round trip, not an inference from "the page rendered". */
async function databaseState(): Promise<Reachability> {
  try {
    await db.execute(sql`select 1`);
    return 'up';
  } catch {
    return 'down';
  }
}

function reachabilityBadge(state: Reachability) {
  if (state === 'up') return <Badge tone="ok" dot>up</Badge>;
  if (state === 'down') return <Badge tone="bad" dot>down</Badge>;
  return <Badge tone="neutral" dot>not configured</Badge>;
}

export default async function ControlHealthPage() {
  await requirePlatform('platform.health:read', '/control/health');

  // "Today" is UTC, deliberately: an operational number that shifts with whoever
  // is reading it cannot be compared between two people on a call.
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const isolation = isolationStatus();

  const [database, cache, userStats, organizationStats, todayStats, outboxStats, securityStats] =
    await Promise.all([
      databaseState(),
      redisState(),
      db
        .select({
          total: count(),
          active: sql<number>`cast(count(*) filter (where ${users.status} = 'ACTIVE') as int)`,
          suspended: sql<number>`cast(count(*) filter (where ${users.status} = 'SUSPENDED') as int)`,
          pendingVerification: sql<number>`cast(count(*) filter (where ${users.status} = 'PENDING_VERIFICATION') as int)`,
          // ts(), not a bare Date. This is the line the API gets wrong.
          newToday: sql<number>`cast(count(*) filter (where ${users.createdAt} >= ${ts(startOfDay)}) as int)`,
        })
        .from(users),
      db
        .select({
          total: count(),
          active: sql<number>`cast(count(*) filter (where ${organizations.status} = 'ACTIVE') as int)`,
          pendingReview: sql<number>`cast(count(*) filter (where ${organizations.status} = 'PENDING_REVIEW') as int)`,
          suspended: sql<number>`cast(count(*) filter (where ${organizations.status} = 'SUSPENDED') as int)`,
        })
        .from(organizations),
      db
        .select({
          total: sql<number>`cast(count(*) filter (where ${transactions.createdAt} >= ${ts(startOfDay)}) as int)`,
          captured: sql<number>`cast(count(*) filter (where ${transactions.createdAt} >= ${ts(startOfDay)} and ${transactions.status} = 'CAPTURED') as int)`,
          failed: sql<number>`cast(count(*) filter (where ${transactions.createdAt} >= ${ts(startOfDay)} and ${transactions.status} = 'FAILED') as int)`,
          capturedMinor: sql<string>`coalesce(sum(${transactions.amountMinor}) filter (where ${transactions.createdAt} >= ${ts(startOfDay)} and ${transactions.status} = 'CAPTURED'), 0)::bigint`,
        })
        .from(transactions),
      db
        .select({
          unpublished: count(),
          oldestUnpublishedAt: sql<Date | null>`min(${outboxEvents.createdAt})`,
          attempted: sql<number>`cast(count(*) filter (where ${outboxEvents.attempts} > 0) as int)`,
          failing: sql<number>`cast(count(*) filter (where ${outboxEvents.lastError} is not null) as int)`,
        })
        .from(outboxEvents)
        .where(isNull(outboxEvents.publishedAt)),
      db
        .select({
          unacknowledged: count(),
          urgent: sql<number>`cast(count(*) filter (where ${securityEvents.severity} in ('HIGH','CRITICAL')) as int)`,
        })
        .from(securityEvents)
        .where(isNull(securityEvents.acknowledgedAt)),
    ]);

  const outbox = outboxStats[0];
  const oldest = outbox?.oldestUnpublishedAt ? new Date(outbox.oldestUnpublishedAt) : null;
  const backlogAgeMinutes = oldest ? Math.round((Date.now() - oldest.getTime()) / 60_000) : null;
  const backlogStalled = backlogAgeMinutes !== null && backlogAgeMinutes > 5;

  const domains = [
    { key: 'consumer' as const, label: 'Consumer', reads: 'A person’s own account, pass, receipts and consents.' },
    { key: 'business' as const, label: 'Business', reads: 'One tenant’s own rows, plus the consented customer view.' },
    { key: 'platform' as const, label: 'Platform', reads: 'This console: users, partners, audit, security, health.' },
  ];

  const configuredCount = domains.filter((domain) => isolation.domains[domain.key].configured).length;

  return (
    <div className="stack stack-5">
      <PageHeader
        eyebrow="Platform"
        title="Health"
        lede="Read from this process and this database, now. Nothing on this page is cached and nothing is inferred from a document."
      />

      <Card>
        <CardHead
          title="Database isolation"
          action={
            isolation.separated ? (
              <Badge tone="ok" dot>three roles, separated</Badge>
            ) : (
              <Badge tone="warn" dot>
                {configuredCount} of 3 configured
              </Badge>
            )
          }
        />
        <div className="stack stack-4">
          <Notice tone={isolation.separated ? 'ok' : 'warn'}>
            <p>{isolation.note}</p>
          </Notice>

          <TableScroll>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Domain</th>
                  <th scope="col">Database role</th>
                  <th scope="col">Connection</th>
                  <th scope="col">What it is allowed to read</th>
                </tr>
              </thead>
              <tbody>
                {domains.map((domain) => {
                  const state = isolation.domains[domain.key];
                  return (
                    <tr key={domain.key}>
                      <td className="small" style={{ fontWeight: 600 }}>{domain.label}</td>
                      <td className="small mono">{state.role}</td>
                      <td>
                        {state.configured ? (
                          <Badge tone="ok" dot>own role</Badge>
                        ) : (
                          <Badge tone="warn" dot>shared connection</Badge>
                        )}
                      </td>
                      <td className="tiny muted">{domain.reads}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>

          <p className="tiny muted measure-wide">
            When a domain has its own role, a query it has no grant for fails at the database —
            <span className="mono"> permission denied for table users</span> — rather than returning a
            filtered result that depended on somebody remembering a WHERE clause. When the URLs are
            unset, all three share one connection: <span className="mono">authorize()</span> and
            row-level security still apply, but the grant-level boundary below the application code
            is not there. Set <span className="mono">DATABASE_URL_CONSUMER</span>,{' '}
            <span className="mono">DATABASE_URL_BUSINESS</span> and{' '}
            <span className="mono">DATABASE_URL_PLATFORM</span> to enable it.
          </p>
        </div>
      </Card>

      <div className="grid grid-4">
        <Stat
          label="Database"
          value={database === 'up' ? 'Up' : database === 'down' ? 'Down' : 'Not configured'}
          hint="A select 1 round trip, run for this page"
          tone={database === 'up' ? 'ok' : 'bad'}
        />
        <Stat
          label="Redis"
          value={cache === 'up' ? 'Up' : cache === 'down' ? 'Down' : 'Not configured'}
          hint={
            cache === 'not-configured'
              ? 'Rate limits and realtime fall back to this process only'
              : 'A PING round trip, run for this page'
          }
          tone={cache === 'up' ? 'ok' : cache === 'down' ? 'bad' : 'warn'}
        />
        <Stat
          label="Outbox backlog"
          value={outbox?.unpublished ?? 0}
          hint={
            backlogAgeMinutes === null
              ? 'Nothing waiting to publish'
              : `oldest ${backlogAgeMinutes} min old`
          }
          tone={backlogStalled ? 'warn' : undefined}
        />
        <Stat
          label="Security queue"
          value={securityStats[0]?.unacknowledged ?? 0}
          hint={`${securityStats[0]?.urgent ?? 0} high or critical`}
          tone={(securityStats[0]?.urgent ?? 0) > 0 ? 'bad' : undefined}
        />
      </div>

      {backlogStalled ? (
        <Notice tone="warn">
          <p>
            The oldest unpublished outbox row is {backlogAgeMinutes} minutes old. Depth alone would
            not say this: a publisher that has stopped is silent, because every write that enqueues a
            row still succeeds.
          </p>
        </Notice>
      ) : null}

      <div className="grid grid-2">
        <Card>
          <CardHead title="Process" />
          <DefinitionList
            items={[
              ['Version', <span key="v" className="mono">{VERSION}</span>],
              ['Environment', <span key="e" className="mono">{getEnv().NODE_ENV}</span>],
              ['Uptime', `${Math.round(process.uptime())} seconds`],
              ['Redis', reachabilityBadge(cache)],
              ['Database', reachabilityBadge(database)],
            ]}
          />
        </Card>

        <Card>
          <CardHead title="Outbox" />
          <DefinitionList
            items={[
              ['Unpublished rows', <span key="u" className="mono">{outbox?.unpublished ?? 0}</span>],
              [
                'Oldest unpublished',
                oldest ? `${formatDateTime(oldest)} · ${formatRelative(oldest)}` : 'Nothing waiting',
              ],
              ['Rows that have been attempted', <span key="a" className="mono">{outbox?.attempted ?? 0}</span>],
              ['Rows carrying an error', <span key="f" className="mono">{outbox?.failing ?? 0}</span>],
            ]}
          />
        </Card>
      </div>

      <div className="grid grid-2">
        <Card>
          <CardHead title="Accounts" />
          <DefinitionList
            items={[
              ['Total', <span key="t" className="mono">{userStats[0]?.total ?? 0}</span>],
              ['Active', <span key="a" className="mono">{userStats[0]?.active ?? 0}</span>],
              ['Suspended', <span key="s" className="mono">{userStats[0]?.suspended ?? 0}</span>],
              ['Awaiting verification', <span key="p" className="mono">{userStats[0]?.pendingVerification ?? 0}</span>],
              ['Registered today (UTC)', <span key="n" className="mono">{userStats[0]?.newToday ?? 0}</span>],
              ['Organizations', <span key="o" className="mono">{organizationStats[0]?.total ?? 0}</span>],
              ['Organizations active', <span key="oa" className="mono">{organizationStats[0]?.active ?? 0}</span>],
              ['Awaiting review', <span key="or" className="mono">{organizationStats[0]?.pendingReview ?? 0}</span>],
            ]}
          />
        </Card>

        <Card>
          <CardHead title="Payments today (UTC)" />
          <DefinitionList
            items={[
              ['Since', formatDateTime(startOfDay)],
              ['Payments', <span key="t" className="mono">{todayStats[0]?.total ?? 0}</span>],
              ['Captured', <span key="c" className="mono">{todayStats[0]?.captured ?? 0}</span>],
              ['Failed', <span key="f" className="mono">{todayStats[0]?.failed ?? 0}</span>],
              ['Captured value', formatMoney(Number(todayStats[0]?.capturedMinor ?? 0))],
            ]}
          />
        </Card>
      </div>
    </div>
  );
}
