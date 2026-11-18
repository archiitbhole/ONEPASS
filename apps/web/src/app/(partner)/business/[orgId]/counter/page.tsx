/**
 * The counter.
 *
 * The door admits a ticket somebody already bought. This is the other half of
 * what happens at a shop front: something is bought here, now, and the person
 * buying it should end up with the receipt, the warranty and the product on
 * their pass rather than a slip of thermal paper that fades by March.
 *
 * Before this page existed, that only worked for purchases made inside the app.
 * A sale across the counter produced nothing the platform knew about, so the
 * buyer had no warranty to claim and no product to transfer — which made the
 * warranty and ownership features quietly conditional on how you happened to pay.
 *
 * ON IDENTIFYING THE BUYER — the honest answer, on the page as well as here.
 * There is no customer search on this screen and there should not be. Letting
 * staff pick a name would turn every till into a browsable directory of the
 * shop's customers, and would prove nothing about who is actually standing
 * there — which matters, because a receipt creates a warranty and transfers
 * ownership of goods. So the customer presents their pass. The code it shows
 * rolls every thirty seconds and is signed with a secret the server never sends
 * anywhere, and it is refused unless that person has an active connection with
 * this business.
 *
 * ON CAMERA SCANNING — the same answer the door gives, for the same reason.
 * `packages/pass` is a QR *encoder*; there is no decoder in this repository, so
 * a browser here has nothing to decode with. The field takes the code as text,
 * which is what a USB or Bluetooth scanner types anyway.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { receipts, venues } from '@/db/schema';
import { Card, CardHead, Empty, Notice, TableScroll, formatDateTime, formatMoney } from '@/components/ui';
import { requirePartner } from '@/components/partner/guard';
import { CounterConsole } from '@/components/partner/counter-console';
import { PageHeader, Summary } from '@/components/partner/shell';
import { startOfBusinessDay } from '@/components/partner/time';
import { COUNTER_WINDOW_MINUTES } from '@/lib/commerce/counter';
import { BRAND } from '@/lib/brand';
import { amendAction, identifyAction, issueAction, nextCustomerAction, reviewAction } from './actions';

export const metadata: Metadata = { title: 'Counter' };
export const dynamic = 'force-dynamic';

export default async function CounterPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  // The permission a counter already needs to take money. Recording what was
  // sold is the same job, so it is not gated behind an administrator.
  const ctx = await requirePartner('partner.transaction:create', orgId, `/business/${orgId}/counter`);
  const organizationId = ctx.organizationId;
  const dayStart = startOfBusinessDay();

  const [shops, today, recent] = await Promise.all([
    db
      .select({ id: venues.id, name: venues.name })
      .from(venues)
      .where(eq(venues.organizationId, organizationId))
      .orderBy(venues.name)
      .limit(50),
    db
      .select({
        count: sql<number>`count(*)::int`,
        totalMinor: sql<string>`coalesce(sum(${receipts.totalMinor}), 0)::bigint`,
        taxMinor: sql<string>`coalesce(sum(${receipts.taxMinor}), 0)::bigint`,
      })
      .from(receipts)
      .where(
        and(
          eq(receipts.organizationId, organizationId),
          eq(receipts.channel, 'IN_STORE'),
          gte(receipts.issuedAt, dayStart),
        ),
      ),
    db
      .select({
        publicRef: receipts.publicRef,
        issuedAt: receipts.issuedAt,
        totalMinor: receipts.totalMinor,
        currency: receipts.currency,
        merchantReceiptNo: receipts.merchantReceiptNo,
      })
      .from(receipts)
      .where(and(eq(receipts.organizationId, organizationId), eq(receipts.channel, 'IN_STORE')))
      .orderBy(desc(receipts.issuedAt))
      .limit(10),
  ]);

  const counts = today[0];

  return (
    <div className="stack stack-5">
      <PageHeader
        eyebrow="Operate"
        title="Counter"
        lede={`Sell something across the counter and have it land on the customer's ${BRAND.name} — the receipt, any warranty it carries, and the product itself.`}
      />

      <div className="split split-trail">
        <Card>
          <CardHead title="Ring up a sale" />
          <CounterConsole
            identify={identifyAction.bind(null, organizationId)}
            review={reviewAction.bind(null, organizationId)}
            amend={amendAction.bind(null, organizationId)}
            issue={issueAction.bind(null, organizationId)}
            reset={nextCustomerAction.bind(null, organizationId)}
            venues={shops}
          />

          <Notice tone="info">
            <span>
              No money moves on this page. Take the payment however you normally do — card machine,
              UPI, cash — and record here what was sold. &ldquo;Paid with&rdquo; is a label on the
              receipt, not a payment {BRAND.name} observed.
            </span>
          </Notice>
        </Card>

        <div className="stack stack-4">
          <Card>
            <CardHead title="Counter sales today" />
            <Summary
              items={[
                { label: 'Receipts', value: counts?.count ?? 0 },
                { label: 'Total', value: formatMoney(Number(counts?.totalMinor ?? 0)) },
                { label: 'Tax', value: formatMoney(Number(counts?.taxMinor ?? 0)) },
              ]}
            />
          </Card>

          <Card>
            <CardHead title="How it works" />
            <ol className="numbered">
              <li>
                The customer opens their pass and you scan or type the code under it. It rolls every
                30 seconds, so it only works while they are here.
              </li>
              <li>
                Ring up the basket. Anything with a warranty period gets one, tracked against this
                receipt — they never have to find the paper.
              </li>
              <li>
                Price the sale, check the figure with the customer, then issue. The scan stays usable
                for {COUNTER_WINDOW_MINUTES} minutes so a long basket is not a problem.
              </li>
            </ol>
          </Card>

          <Card>
            <CardHead
              title="Recent counter receipts"
              action={
                <Link className="btn btn-sm" href={`/business/${organizationId}/receipts`}>
                  All receipts
                </Link>
              }
            />
            {recent.length === 0 ? (
              <Empty
                title="No counter sales yet"
                body="A receipt issued here appears in this list and on the customer's pass at the same moment."
              />
            ) : (
              <TableScroll>
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Receipt</th>
                      <th scope="col">Issued</th>
                      <th scope="col" className="table-num">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((row) => (
                      <tr key={row.publicRef}>
                        <td className="mono nowrap">
                          <Link href={`/business/${organizationId}/receipts?ref=${encodeURIComponent(row.publicRef)}`}>
                            {row.publicRef}
                          </Link>
                          {row.merchantReceiptNo ? (
                            <span className="tiny muted stacked">{row.merchantReceiptNo}</span>
                          ) : null}
                        </td>
                        <td className="small nowrap">{formatDateTime(row.issuedAt)}</td>
                        <td className="table-num">{formatMoney(row.totalMinor, row.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
