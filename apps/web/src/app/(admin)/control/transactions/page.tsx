/**
 * Platform-wide transactions.
 *
 * The only view in the system that crosses tenants on purpose, which is exactly
 * why it is behind `platform.transaction:read` — a permission no partner role can
 * ever hold, because a `partner.*` permission is computed per membership and is
 * incapable of reaching this page.
 *
 * What it shows is money and references, not people. A consumer's email address
 * and mobile number are not part of a reconciliation question, so those columns
 * are not selected at all: the safest masking is the field you never read.
 * Provider order and payment ids are here because they are what a dispute is
 * actually settled with; they are references at the payment provider, not
 * credentials.
 *
 * The provider is a column rather than a footnote, and every SANDBOX row carries
 * a Sample tag. This platform's entire ledger is currently sandbox, and a console
 * that let a sample figure be read as revenue would be lying by omission.
 *
 * Date filters use `gte`/`lte`, never a Date interpolated into a `sql` template —
 * see src/db/sql-helpers.ts for what that costs.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { and, count, desc, eq, gte, lte, sql, type SQL } from 'drizzle-orm';
import { db } from '@/db/client';
import { organizations, transactions, userProfiles } from '@/db/schema';
import {
  Card,
  CardHead,
  SampleTag,
  Empty,
  StatusBadge,
  TableScroll,
  formatDateTime,
  formatMoney,
} from '@/components/ui';
import { FilterLinks, PageHeader, Summary } from '@/components/partner/shell';
import { requirePlatform } from '@/components/admin/guard';
import { dayParam, firstParam, oneOf, withParam } from '@/components/admin/redact';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = { title: 'Transactions' };
export const dynamic = 'force-dynamic';

const STATUSES = ['INITIATED', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'REFUNDED', 'CANCELLED'] as const;
const PROVIDERS = ['RAZORPAY', 'STRIPE', 'SANDBOX'] as const;
const BASE = '/control/transactions';
const LIMIT = 100;

export default async function ControlTransactionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePlatform('platform.transaction:read', BASE);
  const query = await searchParams;

  const status = oneOf(query.status, STATUSES);
  const provider = oneOf(query.provider, PROVIDERS);
  const fromRaw = firstParam(query.from);
  const toRaw = firstParam(query.to);
  const from = dayParam(query.from);
  const to = dayParam(query.to, true);

  const where: (SQL | undefined)[] = [];
  if (status) where.push(eq(transactions.status, status));
  if (provider) where.push(eq(transactions.provider, provider));
  // Typed operators carry the column's type mapper. A raw Date in a template does not.
  if (from) where.push(gte(transactions.createdAt, from));
  if (to) where.push(lte(transactions.createdAt, to));
  const filter = where.length ? and(...where) : undefined;

  // Totals are computed over the whole filter rather than over the page, so the
  // figure at the top is not silently "the first hundred rows".
  const [totals] = await db
    .select({
      rows: count(),
      captured: sql<number>`cast(count(*) filter (where ${transactions.status} = 'CAPTURED') as int)`,
      failed: sql<number>`cast(count(*) filter (where ${transactions.status} = 'FAILED') as int)`,
      refunded: sql<number>`cast(count(*) filter (where ${transactions.status} = 'REFUNDED') as int)`,
      capturedMinor: sql<string>`coalesce(sum(${transactions.amountMinor}) filter (where ${transactions.status} = 'CAPTURED'), 0)::bigint`,
      refundedMinor: sql<string>`coalesce(sum(${transactions.amountMinor}) filter (where ${transactions.status} = 'REFUNDED'), 0)::bigint`,
      sandbox: sql<number>`cast(count(*) filter (where ${transactions.provider} = 'SANDBOX') as int)`,
    })
    .from(transactions)
    .where(filter);

  const rows = await db
    .select({
      id: transactions.id,
      status: transactions.status,
      amountMinor: transactions.amountMinor,
      currency: transactions.currency,
      description: transactions.description,
      provider: transactions.provider,
      providerOrderId: transactions.providerOrderId,
      providerPaymentId: transactions.providerPaymentId,
      failureCode: transactions.failureCode,
      createdAt: transactions.createdAt,
      capturedAt: transactions.capturedAt,
      organizationId: transactions.organizationId,
      organizationName: organizations.name,
      organizationSlug: organizations.slug,
      userId: transactions.userId,
      userDisplayName: userProfiles.displayName,
    })
    .from(transactions)
    .innerJoin(organizations, eq(organizations.id, transactions.organizationId))
    .leftJoin(userProfiles, eq(userProfiles.userId, transactions.userId))
    .where(filter)
    // Ids are ULIDs, so newest-first is `id desc`.
    .orderBy(desc(transactions.id))
    .limit(LIMIT);

  const current = { status, provider, from: fromRaw, to: toRaw };
  const rowCount = totals?.rows ?? 0;
  const sandboxCount = totals?.sandbox ?? 0;

  return (
    <div className="stack stack-5">
      <PageHeader
        eyebrow="Platform"
        title="Transactions"
        lede="Every payment on the platform, across every organization. Amounts are stored and summed in minor units; the totals below cover the whole filter, not just the rows on screen."
      />

      {rowCount > 0 && sandboxCount === rowCount ? (
        <Card>
          <p className="row" style={{ gap: 8, alignItems: 'baseline' }}>
            <SampleTag />
            <span className="small muted">
              Every payment matching this filter was taken through the SANDBOX provider. These are
              simulated settlements, not money that moved.
            </span>
          </p>
        </Card>
      ) : null}

      <Card>
        <div className="stack stack-4">
          <FilterLinks
            label="Filter transactions by status"
            current={status}
            options={[
              { href: withParam(BASE, current, { status: null }), label: 'All', value: null },
              ...STATUSES.map((value) => ({
                href: withParam(BASE, current, { status: value }),
                label: value.toLowerCase(),
                value,
              })),
            ]}
          />

          <FilterLinks
            label="Filter transactions by provider"
            current={provider}
            options={[
              { href: withParam(BASE, current, { provider: null }), label: 'Any provider', value: null },
              ...PROVIDERS.map((value) => ({
                href: withParam(BASE, current, { provider: value }),
                label: value.toLowerCase(),
                value,
              })),
            ]}
          />

          <form method="get" action={BASE} className="row-wrap" style={{ gap: 12 }}>
            {status ? <input type="hidden" name="status" value={status} /> : null}
            {provider ? <input type="hidden" name="provider" value={provider} /> : null}
            <div className="field">
              <label className="label" htmlFor="from">
                From
              </label>
              <input id="from" className="input" type="date" name="from" defaultValue={fromRaw ?? ''} />
            </div>
            <div className="field">
              <label className="label" htmlFor="to">
                To
              </label>
              <input id="to" className="input" type="date" name="to" defaultValue={toRaw ?? ''} />
            </div>
            <div className="row" style={{ gap: 8, alignSelf: 'flex-end', paddingBottom: 2 }}>
              <button type="submit" className="btn btn-primary">
                Apply dates
              </button>
              {from || to ? (
                <Link className="btn" href={withParam(BASE, current, { from: null, to: null })}>
                  Clear dates
                </Link>
              ) : null}
            </div>
          </form>

          <Summary
            items={[
              { label: 'Payments', value: rowCount },
              { label: 'Captured', value: totals?.captured ?? 0 },
              { label: 'Captured value', value: formatMoney(Number(totals?.capturedMinor ?? 0)) },
              { label: 'Refunded', value: `${totals?.refunded ?? 0} · ${formatMoney(Number(totals?.refundedMinor ?? 0))}` },
              { label: 'Failed', value: totals?.failed ?? 0 },
              { label: 'Sandbox rows', value: `${sandboxCount} of ${rowCount}` },
            ]}
          />
        </div>
      </Card>

      <Card>
        <CardHead
          title="Ledger"
          action={
            <span className="small muted">
              Newest first · {rows.length} shown{rowCount > rows.length ? ` of ${rowCount}` : ''}
            </span>
          }
        />
        {rows.length === 0 ? (
          <Empty
            title="No transactions match"
            body={
              status || provider || from || to
                ? 'Nothing on the platform sits inside those filters.'
                : 'A payment appears here the moment one is taken against any organization.'
            }
            action={
              status || provider || from || to ? (
                <Link className="btn btn-sm" href={BASE}>
                  Clear the filters
                </Link>
              ) : null
            }
          />
        ) : (
          <TableScroll>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Organization</th>
                  <th scope="col">Description</th>
                  <th scope="col">Provider</th>
                  <th scope="col">Provider references</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="table-num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="small">
                      {formatDateTime(row.createdAt)}
                      {row.capturedAt ? (
                        <div className="tiny muted">captured {formatDateTime(row.capturedAt)}</div>
                      ) : null}
                    </td>
                    <td className="small">
                      {row.organizationName}
                      <div className="tiny muted mono">{row.organizationSlug}</div>
                    </td>
                    <td className="small">
                      {row.description ?? <span className="muted">no description</span>}
                      <div className="tiny muted">
                        {row.userDisplayName ?? BRAND.fallbackPersonName}
                        {row.failureCode ? ` · ${row.failureCode}` : ''}
                      </div>
                    </td>
                    <td>
                      <span className="row-wrap" style={{ gap: 6 }}>
                        <span className="mono small">{row.provider.toLowerCase()}</span>
                        {row.provider === 'SANDBOX' ? <SampleTag>Sandbox</SampleTag> : null}
                      </span>
                    </td>
                    <td className="tiny mono break-all" style={{ maxWidth: 220 }}>
                      {row.providerOrderId ?? '—'}
                      {row.providerPaymentId ? <div className="muted">{row.providerPaymentId}</div> : null}
                    </td>
                    <td><StatusBadge status={row.status} /></td>
                    <td className="table-num">{formatMoney(row.amountMinor, row.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
        <p className="tiny muted" style={{ marginTop: 10 }}>
          No contact detail for the payer is selected by this page. A payment is identified by its
          provider references and the organization it was taken by.
        </p>
      </Card>
    </div>
  );
}
