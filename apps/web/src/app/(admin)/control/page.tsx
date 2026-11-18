/**
 * Overview — the platform in nine numbers, all of them counted.
 *
 * Every figure on this page is an aggregate over real rows: users grouped by
 * their status column, organizations by theirs, thirty days of transactions
 * summed in the database, credentials counted against their verification ledger,
 * unacknowledged security events grouped by severity. Nothing is modelled,
 * projected or smoothed, so nothing here needs an estimate label — and nothing a
 * reader cannot reconcile against a query.
 *
 * A section whose permission this actor's role does not hold is not queried at
 * all. Platform support opens this page and sees users, partners and credentials;
 * the money and the security queue are absent with the reason on the screen,
 * because a blank card reads as "nothing happening" and that is a different
 * statement entirely.
 *
 * The thirty-day window uses `gte()` rather than a raw `sql` template: a
 * JavaScript Date interpolated into a template reaches the driver with no type
 * mapper at all. See src/db/sql-helpers.ts.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { and, count, eq, gte, isNull, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  credentials,
  organizations,
  securityEvents,
  transactions,
  users,
  verifications,
} from '@/db/schema';
import {
  Card,
  CardHead,
  Empty,
  Stat,
  StatRow,
  StatusBadge,
  TableScroll,
  formatMoney,
} from '@/components/ui';
import { PageHeader, Summary } from '@/components/partner/shell';
import { requirePlatform } from '@/components/admin/guard';
import { Withheld } from '@/components/admin/parts';

export const metadata: Metadata = { title: 'Overview' };
export const dynamic = 'force-dynamic';

const WINDOW_DAYS = 30;

export default async function ControlOverviewPage() {
  const ctx = await requirePlatform('platform.user:read', '/control');
  const may = ctx.permissions;

  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000);

  const usersByStatus = await db
    .select({ status: users.status, total: count() })
    .from(users)
    .groupBy(users.status)
    .orderBy(users.status);

  const partnersByStatus = may.has('platform.partner:read')
    ? await db
        .select({ status: organizations.status, total: count() })
        .from(organizations)
        .where(isNull(organizations.deletedAt))
        .groupBy(organizations.status)
        .orderBy(organizations.status)
    : null;

  // Money is summed in the database, in minor units, so nothing rounds in transit.
  const money = may.has('platform.transaction:read')
    ? (
        await db
          .select({
            total: count(),
            captured: sql<number>`cast(count(*) filter (where ${transactions.status} = 'CAPTURED') as int)`,
            failed: sql<number>`cast(count(*) filter (where ${transactions.status} = 'FAILED') as int)`,
            refunded: sql<number>`cast(count(*) filter (where ${transactions.status} = 'REFUNDED') as int)`,
            capturedMinor: sql<string>`coalesce(sum(${transactions.amountMinor}) filter (where ${transactions.status} = 'CAPTURED'), 0)::bigint`,
            sandbox: sql<number>`cast(count(*) filter (where ${transactions.provider} = 'SANDBOX') as int)`,
          })
          .from(transactions)
          .where(gte(transactions.createdAt, since))
      )[0] ?? null
    : null;

  const credentialStats = may.has('platform.credential:read')
    ? (
        await db
          .select({
            total: count(),
            active: sql<number>`cast(count(*) filter (where ${credentials.status} = 'ACTIVE') as int)`,
            revoked: sql<number>`cast(count(*) filter (where ${credentials.status} = 'REVOKED') as int)`,
            expired: sql<number>`cast(count(*) filter (where ${credentials.status} = 'EXPIRED') as int)`,
          })
          .from(credentials)
      )[0] ?? null
    : null;

  const verificationStats = may.has('platform.credential:read')
    ? (
        await db
          .select({
            total: count(),
            verified: sql<number>`cast(count(*) filter (where ${verifications.outcome} = 'VERIFIED') as int)`,
            failed: sql<number>`cast(count(*) filter (where ${verifications.outcome} in ('INVALID','NOT_FOUND','REVOKED','EXPIRED')) as int)`,
          })
          .from(verifications)
      )[0] ?? null
    : null;

  const openSecurity = may.has('platform.security:read')
    ? await db
        .select({ severity: securityEvents.severity, total: count() })
        .from(securityEvents)
        .where(isNull(securityEvents.acknowledgedAt))
        .groupBy(securityEvents.severity)
    : null;

  const pendingPartners = may.has('platform.partner:read')
    ? (
        await db
          .select({ total: count() })
          .from(organizations)
          .where(and(eq(organizations.status, 'PENDING_REVIEW'), isNull(organizations.deletedAt)))
      )[0]?.total ?? 0
    : null;

  const totalUsers = usersByStatus.reduce((sum, row) => sum + row.total, 0);
  const activeUsers = usersByStatus.find((row) => row.status === 'ACTIVE')?.total ?? 0;
  const suspendedUsers = usersByStatus.find((row) => row.status === 'SUSPENDED')?.total ?? 0;
  const totalPartners = partnersByStatus?.reduce((sum, row) => sum + row.total, 0) ?? null;

  const SEVERITY_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] as const;
  const openBySeverity = openSecurity
    ? SEVERITY_ORDER.map((severity) => ({
        severity,
        total: openSecurity.find((row) => row.severity === severity)?.total ?? 0,
      }))
    : null;
  const openTotal = openSecurity?.reduce((sum, row) => sum + row.total, 0) ?? null;
  const urgent = openBySeverity
    ? openBySeverity.filter((row) => row.severity === 'CRITICAL' || row.severity === 'HIGH')
        .reduce((sum, row) => sum + row.total, 0)
    : null;

  return (
    <div className="stack stack-5">
      <PageHeader
        eyebrow="Platform"
        title="Overview"
        lede={`Counted from the platform's own rows. Money covers the last ${WINDOW_DAYS} days; user, partner, credential and security figures are the whole table as it stands right now.`}
      />

      <StatRow>
        <Stat label="Users" value={totalUsers} hint={`${activeUsers} active · ${suspendedUsers} suspended`} />
        <Stat
          label="Partners"
          value={totalPartners ?? '—'}
          hint={
            pendingPartners === null
              ? 'Needs platform.partner:read'
              : pendingPartners > 0
                ? `${pendingPartners} awaiting review`
                : 'Nothing awaiting review'
          }
          tone={pendingPartners ? 'warn' : undefined}
        />
        <Stat
          label={`Captured, ${WINDOW_DAYS} days`}
          value={money ? formatMoney(Number(money.capturedMinor)) : '—'}
          hint={money ? `${money.captured} of ${money.total} payments` : 'Needs platform.transaction:read'}
        />
        <Stat
          label="Open security events"
          value={openTotal ?? '—'}
          hint={
            openTotal === null
              ? 'Needs platform.security:read'
              : urgent
                ? `${urgent} high or critical`
                : 'Nothing high or critical'
          }
          tone={urgent ? 'bad' : undefined}
        />
      </StatRow>

      <div className="grid grid-2">
        <Card>
          <CardHead
            title="Users by status"
            action={
              <Link className="btn btn-sm" href="/control/users">
                Open directory
              </Link>
            }
          />
          {usersByStatus.length === 0 ? (
            <Empty title="No users" body="Nothing has been registered on this platform yet." />
          ) : (
            <TableScroll>
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Status</th>
                    <th scope="col" className="table-num">Accounts</th>
                    <th scope="col" className="table-num">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {usersByStatus.map((row) => (
                    <tr key={row.status}>
                      <td><StatusBadge status={row.status} /></td>
                      <td className="table-num">{row.total}</td>
                      <td className="table-num">
                        {totalUsers > 0 ? `${Math.round((row.total / totalUsers) * 100)}%` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          )}
        </Card>

        {partnersByStatus === null ? (
          <Withheld what="Partner organizations" permission="platform.partner:read" />
        ) : (
          <Card>
            <CardHead
              title="Partners by status"
              action={
                <Link className="btn btn-sm" href="/control/partners">
                  Open queue
                </Link>
              }
            />
            {partnersByStatus.length === 0 ? (
              <Empty title="No organizations" body="No business has applied to this platform yet." />
            ) : (
              <TableScroll>
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Status</th>
                      <th scope="col" className="table-num">Organizations</th>
                    </tr>
                  </thead>
                  <tbody>
                    {partnersByStatus.map((row) => (
                      <tr key={row.status}>
                        <td><StatusBadge status={row.status} /></td>
                        <td className="table-num">{row.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            )}
          </Card>
        )}
      </div>

      {money === null ? (
        <Withheld what="Platform-wide transactions" permission="platform.transaction:read" />
      ) : (
        <Card>
          <CardHead
            title={`Transactions, last ${WINDOW_DAYS} days`}
            action={
              <Link className="btn btn-sm" href="/control/transactions">
                Open ledger
              </Link>
            }
          />
          {money.total === 0 ? (
            <Empty
              title={`No transactions in the last ${WINDOW_DAYS} days`}
              body="A payment appears here the moment one is taken against any organization on the platform."
            />
          ) : (
            <Summary
              items={[
                { label: 'Payments', value: money.total },
                { label: 'Captured', value: money.captured },
                { label: 'Failed', value: money.failed },
                { label: 'Refunded', value: money.refunded },
                { label: 'Captured value', value: formatMoney(Number(money.capturedMinor)) },
                { label: 'Sandbox provider', value: `${money.sandbox} of ${money.total}` },
              ]}
            />
          )}
        </Card>
      )}

      <div className="grid grid-2">
        {credentialStats === null || verificationStats === null ? (
          <Withheld what="Credentials and verifications" permission="platform.credential:read" />
        ) : (
          <Card>
            <CardHead
              title="Credentials"
              action={
                <Link className="btn btn-sm" href="/control/credentials">
                  Open
                </Link>
              }
            />
            {credentialStats.total === 0 && verificationStats.total === 0 ? (
              <Empty
                title="Nothing issued yet"
                body="Credentials appear here once a partner issues one against a credential type."
              />
            ) : (
              <Summary
                items={[
                  { label: 'Issued', value: credentialStats.total },
                  { label: 'Active', value: credentialStats.active },
                  { label: 'Revoked', value: credentialStats.revoked },
                  { label: 'Verifications', value: verificationStats.total },
                  { label: 'Verified', value: verificationStats.verified },
                  { label: 'Refused', value: verificationStats.failed },
                ]}
              />
            )}
          </Card>
        )}

        {openBySeverity === null ? (
          <Withheld what="The security queue" permission="platform.security:read" />
        ) : (
          <Card>
            <CardHead
              title="Open security events by severity"
              action={
                <Link className="btn btn-sm" href="/control/security">
                  Work the queue
                </Link>
              }
            />
            {openTotal === 0 ? (
              <Empty
                title="The queue is clear"
                body="Every security event recorded so far has been acknowledged by someone."
              />
            ) : (
              <TableScroll>
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Severity</th>
                      <th scope="col" className="table-num">Unacknowledged</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openBySeverity
                      .filter((row) => row.total > 0)
                      .map((row) => (
                        <tr key={row.severity}>
                          <td>
                            <Link href={`/control/security?severity=${row.severity.toLowerCase()}&state=open`}>
                              {row.severity.toLowerCase()}
                            </Link>
                          </td>
                          <td className="table-num">{row.total}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </TableScroll>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
