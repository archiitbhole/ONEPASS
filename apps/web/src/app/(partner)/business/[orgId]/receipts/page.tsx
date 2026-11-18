/**
 * Receipts — what this organization issued, and what it adds up to.
 *
 * Every money column here is stored, not recomputed on the page: the receipt
 * service computes subtotal, discount, tax and total from the lines at issue time
 * and refuses to write a receipt whose supplied total disagrees. So the sums
 * below are sums of figures that were themselves derived from lines, and a
 * merchant can reconcile any row against its own POS.
 *
 * Opening one goes through `getOrganizationReceipt`, which re-applies the tenant
 * filter inside the service — a reference from another organization comes back
 * null rather than as a distinguishable refusal.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { receipts, venues } from '@/db/schema';
import { getOrganizationReceipt, returnWindowClosesAt } from '@/lib/commerce/receipts';
import {
  Badge,
  Card,
  CardHead,
  Empty,
  Notice,
  StatusBadge,
  Stat,
  TableScroll,
  formatDate,
  formatDateTime,
  formatMoney,
} from '@/components/ui';
import { requirePartner } from '@/components/partner/guard';
import { ConsentNote, PageHeader, Summary } from '@/components/partner/shell';
import { startOfBusinessDaysAgo } from '@/components/partner/time';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = { title: 'Receipts' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 100;

function first(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw ?? null;
}

export default async function ReceiptsPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { orgId } = await params;
  const query = await searchParams;
  const ctx = await requirePartner('partner.transaction:read', orgId, `/business/${orgId}/receipts`);
  const organizationId = ctx.organizationId;
  const base = `/business/${organizationId}/receipts`;

  const monthFrom = startOfBusinessDaysAgo(29);

  const [rows, allTime, lastMonth] = await Promise.all([
    db
      .select({ receipt: receipts, venueName: venues.name, venueLocality: venues.locality })
      .from(receipts)
      .leftJoin(venues, eq(venues.id, receipts.venueId))
      // The guard's id, never params.orgId.
      .where(eq(receipts.organizationId, organizationId))
      .orderBy(desc(receipts.issuedAt))
      .limit(PAGE_SIZE),
    db
      .select({
        count: sql<number>`count(*)::int`,
        subtotalMinor: sql<string>`coalesce(sum(${receipts.subtotalMinor}), 0)::bigint`,
        discountMinor: sql<string>`coalesce(sum(${receipts.discountMinor}), 0)::bigint`,
        taxMinor: sql<string>`coalesce(sum(${receipts.taxMinor}), 0)::bigint`,
        totalMinor: sql<string>`coalesce(sum(${receipts.totalMinor}), 0)::bigint`,
      })
      .from(receipts)
      .where(eq(receipts.organizationId, organizationId)),
    db
      .select({
        count: sql<number>`count(*)::int`,
        totalMinor: sql<string>`coalesce(sum(${receipts.totalMinor}), 0)::bigint`,
      })
      .from(receipts)
      // A typed operator, so the Date is serialised by the column's own mapper.
      .where(and(eq(receipts.organizationId, organizationId), gte(receipts.issuedAt, monthFrom))),
  ]);

  const totals = allTime[0];
  const month = lastMonth[0];

  const openRef = first(query.ref);
  const detail = openRef
    ? await getOrganizationReceipt({ publicRef: openRef, organizationId })
    : null;

  return (
    <div className="stack stack-5">
      <PageHeader
        eyebrow="Relationships"
        title="Receipts"
        lede="Receipts this organization issued, newest first. Totals are the stored figures the receipt service computed from each receipt's own lines."
      />

      <div className="grid grid-4">
        <Stat
          label="Receipts issued"
          value={totals?.count ?? 0}
          hint={`${month?.count ?? 0} in the last 30 days`}
        />
        <Stat
          label="Gross issued"
          value={formatMoney(Number(totals?.totalMinor ?? 0))}
          hint={`${formatMoney(Number(month?.totalMinor ?? 0))} in the last 30 days`}
        />
        <Stat
          label="Tax on those receipts"
          value={formatMoney(Number(totals?.taxMinor ?? 0))}
          hint="Charged on the amount after discount, per line"
        />
        <Stat
          label="Discount given"
          value={formatMoney(Number(totals?.discountMinor ?? 0))}
          hint="Apportioned across lines before tax"
        />
      </div>

      {openRef && !detail ? (
        <Notice tone="warn">
          <span role="alert">
            No receipt with reference <span className="mono">{openRef}</span> belongs to this
            organization.
          </span>
        </Notice>
      ) : null}

      {detail ? (
        <Card>
          <CardHead
            title={
              <>
                Receipt <span className="mono">{detail.receipt.publicRef}</span>
              </>
            }
            action={
              <Link className="btn btn-sm" href={base}>
                Close
              </Link>
            }
          />

          <div className="grid grid-2">
            <dl className="dl">
              <div>
                <dt>Issued</dt>
                <dd>{formatDateTime(detail.receipt.issuedAt)}</dd>
              </div>
              <div>
                <dt>Channel</dt>
                <dd>{detail.receipt.channel.replace(/_/g, ' ').toLowerCase()}</dd>
              </div>
              <div>
                <dt>Venue</dt>
                <dd>{detail.venue?.name ?? '—'}</dd>
              </div>
              <div>
                <dt>Merchant number</dt>
                <dd className="mono">{detail.receipt.merchantReceiptNo ?? '—'}</dd>
              </div>
              <div>
                <dt>Paid with</dt>
                <dd>{detail.receipt.paymentLabel ?? '—'}</dd>
              </div>
              <div>
                <dt>GSTIN</dt>
                <dd className="mono">{detail.receipt.gstin ?? '—'}</dd>
              </div>
            </dl>

            <dl className="dl">
              <div>
                <dt>Subtotal</dt>
                <dd className="mono">{formatMoney(detail.receipt.subtotalMinor, detail.receipt.currency)}</dd>
              </div>
              <div>
                <dt>Discount</dt>
                <dd className="mono">−{formatMoney(detail.receipt.discountMinor, detail.receipt.currency)}</dd>
              </div>
              <div>
                <dt>Tax</dt>
                <dd className="mono">{formatMoney(detail.receipt.taxMinor, detail.receipt.currency)}</dd>
              </div>
              <div>
                <dt>Total</dt>
                <dd className="mono" style={{ fontWeight: 700 }}>
                  {formatMoney(detail.receipt.totalMinor, detail.receipt.currency)}
                </dd>
              </div>
              <div>
                <dt>Return window</dt>
                <dd>
                  {detail.receipt.returnWindowDays > 0
                    ? `${detail.receipt.returnWindowDays} days · closes ${formatDate(returnWindowClosesAt(detail.receipt))}`
                    : 'Not accepted on this receipt'}
                </dd>
              </div>
              <div>
                <dt>Open return cases</dt>
                <dd>{detail.openReturns.length}</dd>
              </div>
            </dl>
          </div>

          <div style={{ marginTop: 16 }}>
            <TableScroll>
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">Line</th>
                    <th scope="col">SKU</th>
                    <th scope="col" className="table-num">Qty</th>
                    <th scope="col" className="table-num">Unit</th>
                    <th scope="col" className="table-num">Line total</th>
                    <th scope="col" className="table-num">Tax rate</th>
                    <th scope="col">Returnable</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.lines.map((line) => (
                    <tr key={line.id}>
                      <td className="mono">{line.position}</td>
                      <td>
                        <span style={{ fontWeight: 600 }}>{line.description}</span>
                        {line.warrantyMonths ? (
                          <span className="tiny muted stacked">
                            {line.warrantyMonths}-month warranty
                            {line.serialNumber ? ` · serial ${line.serialNumber}` : ''}
                          </span>
                        ) : null}
                      </td>
                      <td className="tiny mono muted">{line.sku ?? '—'}</td>
                      <td className="table-num">{line.quantity}</td>
                      <td className="table-num">
                        {formatMoney(line.unitPriceMinor, detail.receipt.currency)}
                      </td>
                      <td className="table-num">
                        {formatMoney(line.lineTotalMinor, detail.receipt.currency)}
                      </td>
                      <td className="table-num">{(line.taxRateBp / 100).toFixed(2)}%</td>
                      <td>
                        {line.isReturnable ? (
                          <Badge tone="ok">yes</Badge>
                        ) : (
                          <Badge tone="neutral">no</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          </div>

          {detail.openReturns.length > 0 ? (
            <Notice tone="warn">
              <span>
                {detail.openReturns.length} open return{' '}
                {detail.openReturns.length === 1 ? 'case' : 'cases'} against this receipt:{' '}
                {detail.openReturns.map((request) => request.publicRef).join(', ')}.
              </span>
            </Notice>
          ) : null}
        </Card>
      ) : null}

      <Card>
        <div className="stack stack-4">
          <Summary
            items={[
              { label: 'Shown', value: rows.length },
              { label: 'Subtotal', value: formatMoney(Number(totals?.subtotalMinor ?? 0)) },
              { label: 'Tax', value: formatMoney(Number(totals?.taxMinor ?? 0)) },
              { label: 'Total', value: formatMoney(Number(totals?.totalMinor ?? 0)) },
            ]}
          />

          {rows.length === 0 ? (
            <Empty
              title="No receipts issued"
              body={`A receipt is written when this organization records a sale against a customer's ${BRAND.name}. Its lines, totals and warranties are derived in the same transaction.`}
            />
          ) : (
            <>
              <TableScroll>
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Receipt</th>
                      <th scope="col">Issued</th>
                      <th scope="col">Venue</th>
                      <th scope="col">Channel</th>
                      <th scope="col" className="table-num">Subtotal</th>
                      <th scope="col" className="table-num">Discount</th>
                      <th scope="col" className="table-num">Tax</th>
                      <th scope="col" className="table-num">Total</th>
                      <th scope="col">Returns</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(({ receipt, venueName, venueLocality }) => (
                      <tr key={receipt.id}>
                        <td className="mono nowrap">
                          <Link href={`${base}?ref=${encodeURIComponent(receipt.publicRef)}`}>
                            {receipt.publicRef}
                          </Link>
                          {receipt.merchantReceiptNo ? (
                            <span className="tiny muted stacked">
                              {receipt.merchantReceiptNo}
                            </span>
                          ) : null}
                        </td>
                        <td className="small nowrap">
                          {formatDateTime(receipt.issuedAt)}
                        </td>
                        <td className="small">
                          {venueName ? (
                            <>
                              {venueName}
                              {venueLocality ? <span className="muted"> · {venueLocality}</span> : null}
                            </>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td className="small muted">{receipt.channel.replace(/_/g, ' ').toLowerCase()}</td>
                        <td className="table-num">{formatMoney(receipt.subtotalMinor, receipt.currency)}</td>
                        <td className="table-num">
                          {receipt.discountMinor > 0 ? (
                            `−${formatMoney(receipt.discountMinor, receipt.currency)}`
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td className="table-num">{formatMoney(receipt.taxMinor, receipt.currency)}</td>
                        <td className="table-num" style={{ fontWeight: 600 }}>
                          {formatMoney(receipt.totalMinor, receipt.currency)}
                        </td>
                        <td>
                          {receipt.returnWindowDays > 0 ? (
                            <StatusBadge
                              status={
                                returnWindowClosesAt(receipt).getTime() > Date.now() ? 'ACTIVE' : 'EXPIRED'
                              }
                            />
                          ) : (
                            <Badge tone="neutral">none</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>

              <ConsentNote>
                A receipt is listed by its reference. Who bought it is not part of this query — the
                customer&rsquo;s identity is disclosed only through the consent view on Customers,
                and only where they granted it.
              </ConsentNote>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
