/**
 * The payment screen.
 *
 * This is the boundary. Above it, ONEPASS knows what is owed and who is
 * travelling; below it, the payment provider collects the card, the UPI handle
 * or the netbanking credential, on their own surface, and ONEPASS never sees any
 * of it. There is no field on this page that takes a card number, and there is
 * no code path anywhere in the repository that would accept one.
 *
 * **Nothing on this page can confirm a booking.** The provider's checkout will
 * redirect back here when it is done, and that redirect is worth nothing as
 * evidence — a browser can be told anything. The booking becomes paid when the
 * provider's own signed webhook reaches `/api/webhooks/payments`, and the trip
 * page is where the customer sees that it has. So "I have paid" here does not
 * mark anything paid; it takes them to the trip, which shows the real state.
 *
 * The amount shown is read from the transaction row, not from a query
 * parameter — the figure a customer sees and the figure the provider was asked
 * for are the same row, or they are not the same number.
 *
 * On a deployment running the sandbox provider — which is every deployment
 * without a merchant account, and is refused in production — this page says so
 * before it says anything else. A sandbox checkout that looked like a real one
 * would be the single most misleading screen in the product.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { flightBookings, transactions } from '@/db/schema';
import { Badge, ButtonLink, Card, CardHead, Notice, Stack, Steps, formatMoney } from '@/components/ui';
import { FeatureNote } from '@/components/system';
import { bookingSteps } from '@/components/travel/booking-progress';
import { dayLabel } from '@/components/travel/format';
import { paymentProvider } from '@/lib/payments/provider';
import type { BookingState } from '@/lib/travel/booking-state';
import { currentActor } from '../../../../_queries';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = {
  title: 'Payment',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function PayPage({
  params,
  searchParams,
}: {
  params: Promise<{ ref: string }>;
  searchParams: Promise<{ txn?: string }>;
}) {
  const { ref } = await params;
  const { txn } = await searchParams;
  const actor = await currentActor();

  const booking = await db.query.flightBookings.findFirst({
    where: and(eq(flightBookings.publicRef, ref), eq(flightBookings.userId, actor.userId)),
  });
  if (!booking || !booking.transactionId) notFound();

  // The transaction is found through the booking, not through the query
  // parameter. `txn` is only checked for agreement — a mismatch means a stale
  // tab, not something to act on.
  const transaction = await db.query.transactions.findFirst({
    where: and(eq(transactions.id, booking.transactionId), eq(transactions.userId, actor.userId)),
  });
  if (!transaction) notFound();

  const stale = txn !== undefined && txn !== transaction.id;
  const provider = paymentProvider();
  const sandbox = provider.name === 'SANDBOX';
  const alreadyPaid = booking.state !== 'PAYMENT_PENDING';
  const steps = bookingSteps(booking.state as BookingState);

  return (
    <div className="wrap-narrow stack stack-5">
      <header className="page-head">
        <div className="page-head-text">
          <p className="eyebrow">
            <Link href="/travel">Travel</Link> ·{' '}
            <Link href={`/travel/book/${booking.publicRef}`}>Booking</Link> · Payment
          </p>
          <h1>Pay {formatMoney(transaction.amountMinor)}</h1>
          <p>
            {booking.originCode} to {booking.destinationCode} · {dayLabel(booking.departAt)} ·{' '}
            {booking.passengerCount} passenger{booking.passengerCount === 1 ? '' : 's'}
          </p>
        </div>
      </header>

      {steps ? (
        <Card>
          <Steps label="Where this booking has got to" steps={steps} />
        </Card>
      ) : null}

      {stale ? (
        <Notice tone="warn">
          This page was opened for an earlier attempt. The amount above is the current one, read from the
          transaction the provider was actually asked for.
        </Notice>
      ) : null}

      {alreadyPaid ? (
        <Card>
          <Stack gap={3}>
            <CardHead title="This payment has already been made" />
            <p className="small">
              Nothing further is needed here. The trip page shows where the booking has got to with the
              airline.
            </p>
            <ButtonLink href={`/travel/trips/${booking.publicRef}`} variant="primary">
              Open the trip
            </ButtonLink>
          </Stack>
        </Card>
      ) : (
        <>
          {sandbox ? (
            <Notice tone="warn">
              <strong>This deployment runs the sandbox payment provider.</strong> It takes no money and it
              cannot confirm anything with an airline. A booking here becomes paid only when a correctly
              signed webhook reaches the server — there is no button on this page, or anywhere else, that
              marks it paid. Configure a merchant account to take a real payment; see{' '}
              <code>PAYMENT_PROVIDER</code> in <code>.env.example</code>.
            </Notice>
          ) : null}

          <Card>
            <Stack gap={4}>
              <CardHead
                title={sandbox ? 'What would happen here' : 'Complete the payment'}
                action={<Badge tone={sandbox ? 'warn' : 'neutral'}>{sandbox ? 'Sandbox' : provider.name}</Badge>}
              />

              {sandbox ? (
                <p className="small">
                  With a merchant account configured, this is where you would be handed to the provider’s
                  own collection surface. {BRAND.name} would receive a provider order id and a masked
                  label, and nothing that could authorise a payment.
                </p>
              ) : (
                <p className="small">
                  You will be handed to {provider.name === 'RAZORPAY' ? 'Razorpay' : provider.name} to pay.{' '}
                  {BRAND.name} never receives your card number, CVV or UPI PIN — they are collected on
                  their surface and never reach this system.
                </p>
              )}

              <dl className="dl">
                <div>
                  <dt>Amount</dt>
                  <dd className="num">{formatMoney(transaction.amountMinor)}</dd>
                </div>
                <div>
                  <dt>Provider reference</dt>
                  <dd className="mono break-all">{transaction.providerOrderId ?? transaction.id}</dd>
                </div>
                <div>
                  <dt>Booking</dt>
                  <dd className="mono">{booking.publicRef}</dd>
                </div>
              </dl>

              <Notice tone="info">
                Once a payment is made, this booking is confirmed with the airline automatically — when
                the payment provider tells our server directly, over a signed webhook. That takes a few
                seconds and happens whether or not this page is still open.
              </Notice>

              <ButtonLink href={`/travel/trips/${booking.publicRef}`} variant="primary" size="lg" block>
                Show me the trip
              </ButtonLink>

              <p className="tiny muted">
                That button confirms nothing. It opens the trip, which shows the booking’s real state as
                the payment provider and the airline report it — never as this browser reports it.
              </p>

              <FeatureNote featureKey="checkout" />
            </Stack>
          </Card>
        </>
      )}
    </div>
  );
}
