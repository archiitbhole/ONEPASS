/**
 * Travel rewards — cashback, and where it is in its life.
 *
 * Cashback is shown as a lifecycle rather than a balance, because that is what
 * it is: recorded when a booking confirms, credited once the airline can no
 * longer take the ticket away, and reversed if it does. Showing it as a single
 * number would mean either overstating what the customer has (counting pending
 * as money) or hiding what they are owed (counting only credited).
 *
 * Every row carries the working — "3% of ₹8,451, capped at ₹600" — because a
 * cashback figure nobody can reproduce is a figure nobody can dispute.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Badge,
  ButtonLink,
  Card,
  CardHead,
  Empty,
  Notice,
  PageHead,
  Stack,
  Stat,
  StatRow,
  TableScroll,
  formatDate,
  formatMoney,
} from '@/components/ui';
import { dayLabel } from '@/components/travel/format';
import { cashbackFor, cashbackTotals } from '@/lib/travel/cashback';
import { walletSummary } from '@/lib/commerce/rewards';
import { currentActor } from '../../_queries';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = {
  title: 'Travel rewards',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const TONE: Record<string, 'ok' | 'warn' | 'neutral' | 'bad'> = {
  PENDING: 'warn',
  APPROVED: 'warn',
  CREDITED: 'ok',
  REVERSED: 'neutral',
  EXPIRED: 'neutral',
};

export default async function TravelRewardsPage() {
  const actor = await currentActor();
  const [rows, totals, wallet] = await Promise.all([
    cashbackFor(actor.userId, 100),
    cashbackTotals(actor.userId),
    walletSummary(actor.userId),
  ]);

  return (
    // The horizontal container. `(app)/layout.tsx` supplies vertical rhythm
    // only, so a page without this renders edge to edge beside neighbours that
    // have gutters — which reads as a broken page rather than a different one.
    <div className="wrap stack stack-5">
      <PageHead
        eyebrow={
          <>
            <Link href="/travel">Travel</Link> · Rewards
          </>
        }
        title="What your travel has earned"
        lede={
          <>
            Cashback on a flight is recorded when the booking confirms and credited as {BRAND.name} points
          once the airline’s cancellation window has passed. Until then it is shown as pending — because
          it is.
          </>
        }
      />

      <StatRow>
        <Stat
          label="Pending"
          value={formatMoney(totals.pendingMinor)}
          hint={
            totals.pendingCount === 0
              ? 'Nothing waiting'
              : `${totals.pendingCount} booking${totals.pendingCount === 1 ? '' : 's'} still inside the airline’s window`
          }
          tone="warn"
        />
        <Stat label="Credited" value={formatMoney(totals.creditedMinor)} tone="ok" />
        <Stat
          label="Points balance"
          value={wallet.totalPoints.toLocaleString('en-IN')}
          hint={`Worth ${formatMoney(wallet.totalValueMinor)} against a booking`}
          tone="accent"
        />
      </StatRow>

      <Notice tone="info">
        Pending cashback is not money you have yet. It becomes points on the date shown against each
        booking, and it is reversed if the booking is cancelled or refunded — which is why it is not
        added to your balance before then.
      </Notice>

      <Card>
        <Stack gap={3}>
          <CardHead
            title="Cashback"
            action={<ButtonLink href="/wallet" variant="ghost">Your whole wallet</ButtonLink>}
          />
          {rows.length === 0 ? (
            <Empty
              title="Nothing earned yet"
              body={`Book a flight through ${BRAND.name} and the cashback it earns appears here, with the calculation behind it.`}
              action={<ButtonLink href="/travel/flights">Search flights</ButtonLink>}
            />
          ) : (
            <TableScroll>
              <table className="table">
                <caption className="sr-only">
                  Cashback earned on each booking, with its state and how it was calculated
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Booking</th>
                    <th scope="col" className="num">
                      Amount
                    </th>
                    <th scope="col">State</th>
                    <th scope="col">How it was worked out</th>
                    <th scope="col">When</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.ref}>
                      <th scope="row">
                        {row.bookingRef ? (
                          <Link href={`/travel/trips/${row.bookingRef}`}>{row.route || row.bookingRef}</Link>
                        ) : (
                          row.route
                        )}
                      </th>
                      <td className="num">{formatMoney(row.amountMinor)}</td>
                      <td>
                        {/* Text as well as tone — a state that is only a colour is
                            a state a third of readers cannot see. */}
                        <Badge tone={TONE[row.state] ?? 'neutral'}>{row.state.toLowerCase()}</Badge>
                      </td>
                      <td className="small">
                        {row.method}
                        <span className="tiny muted" style={{ display: 'block' }}>
                          on {formatMoney(row.basisMinor)}
                        </span>
                      </td>
                      <td className="small">
                        {row.state === 'CREDITED' && row.creditedAt
                          ? `Credited ${formatDate(row.creditedAt)}`
                          : row.state === 'REVERSED'
                            ? (row.reversedReason ?? 'Reversed')
                            : row.state === 'EXPIRED'
                              ? 'Expired before it was credited'
                              : `Credits after ${dayLabel(row.approveAfter)}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          )}
        </Stack>
      </Card>

      <Card>
        <Stack gap={3}>
          <CardHead title="How cashback works here" />
          <div className="stack stack-2">
            <p className="small">
              <strong>Recorded</strong> when the airline confirms the booking. Nothing is recorded for a
              booking that failed.
            </p>
            <p className="small">
              <strong>Credited</strong> as {BRAND.name} points once the airline’s cancellation window has
              passed — usually a week. That delay exists because a ticket cancelled after cashback was
              paid is money given away for a journey nobody took.
            </p>
            <p className="small">
              <strong>Reversed</strong> if the booking is cancelled or refunded. If it had already been
              credited, the reversal is a separate entry in your points ledger rather than an edit to
              the original — the ledger is append-only, and a history that can be rewritten is a history
              nobody can check.
            </p>
            <p className="small muted">
              Cashback is never taken off what you pay at checkout. A bank offer is; cashback is not,
              and the two are shown separately because they are paid by different people at different
              times.
            </p>
          </div>
        </Stack>
      </Card>
    </div>
  );
}
