/**
 * The payment provider's callback. This is where money becomes real.
 *
 * Everything else in the checkout path is a request the consumer's browser made,
 * and a browser is not a witness to a payment: it can be replayed, edited or
 * simply lied to. `payment_success=true` on a redirect is worth nothing. The only
 * statement ONEPASS believes is this one — a POST from the provider, signed with
 * a shared secret that the browser never sees.
 *
 * Order of operations matters and is not negotiable:
 *
 *  1. Read the body as raw bytes. The signature covers the exact bytes sent, so
 *     anything that re-serialises them — `req.json()`, a schema parse, a proxy
 *     that reformats — invalidates a valid signature and, worse, makes an
 *     invalid one verifiable against whatever we reconstructed.
 *  2. Verify the HMAC in constant time, before the body is parsed at all. An
 *     unverified body is attacker input, and parsing it first means acting on
 *     attacker input.
 *  3. Only then look anything up.
 *
 * Two deliberate departures from the rest of the API:
 *
 *  · No CSRF origin check. The caller is Razorpay's infrastructure, not the app;
 *    an origin check would reject every real webhook. The signature is what
 *    authenticates this route, and it is stronger than an origin header.
 *  · No session. `loadActor: false` — there is no user on this request, and the
 *    transaction the webhook names is what identifies whose money this is.
 *
 * Failure semantics are chosen for the provider's retry behaviour. A bad
 * signature is 400 and is never retried into a success. Anything that verified
 * but could not be applied — a transaction we cannot find yet, a database blip —
 * is a 5xx so the provider retries; a webhook that arrives before the
 * transaction it refers to has committed is a real race, and dropping it would
 * lose a payment.
 */
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { flightBookings, transactions } from '@/db/schema';
import { route } from '@/lib/api';
import { recordAudit, recordSecurityEvent } from '@/lib/audit';
import { completeCheckout, failCheckout } from '@/lib/commerce/checkout';
import { badRequest, internal } from '@/lib/errors';
import { paymentProvider } from '@/lib/payments/provider';
import { confirmWithProvider, onPaymentAuthorized, onPaymentFailed } from '@/lib/travel/booking';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Razorpay sends `x-razorpay-signature`. The header name is provider-specific
 * while everything below it is not, so it is resolved here rather than inside
 * the adapter, which is only ever handed the value.
 */
const SIGNATURE_HEADERS = ['x-razorpay-signature', 'x-onepass-signature'] as const;

export const POST = route(
  {
    // See the header comment: the signature authenticates this route.
    csrf: false,
    loadActor: false,
    rateLimit: { name: 'payment:webhook', subject: (ctx) => ctx.ip ?? 'unknown' },
  },
  async ({ req, ip, log }) => {
    const provider = paymentProvider();

    const rawBody = await req.text();
    const signature =
      SIGNATURE_HEADERS.map((name) => req.headers.get(name)).find((value) => value) ?? null;

    const verdict = provider.verifyWebhook(rawBody, signature);

    if (!verdict.ok) {
      // Worth recording as a security event rather than only logging: a stream of
      // these is somebody probing the endpoint, and that is exactly the kind of
      // thing the security console exists to surface. The body and the signature
      // are deliberately not stored — one is unverified attacker input and the
      // other is a credential attempt.
      await recordSecurityEvent({
        kind: 'payment.webhook.rejected',
        severity: 'MEDIUM',
        summary: `A payment webhook was rejected: ${verdict.reason}.`,
        metadata: { provider: provider.name, reason: verdict.reason },
      }).catch(() => {
        /* the rejection is the response; failing to file it must not turn it into a 500 */
      });

      log.warn({ reason: verdict.reason, provider: provider.name }, 'payment webhook rejected');
      throw badRequest('That webhook could not be verified.');
    }

    if (!verdict.providerOrderId) {
      // Verified, but about nothing we can act on — a subscription or settlement
      // event, say. Acknowledged so the provider stops retrying it.
      log.info({ event: verdict.event, provider: provider.name }, 'payment webhook ignored — no order id');
      return NextResponse.json({ received: true, applied: false, reason: 'no order reference' });
    }

    const [txn] = await db
      .select({
        id: transactions.id,
        status: transactions.status,
        userId: transactions.userId,
        amountMinor: transactions.amountMinor,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.provider, provider.name),
          eq(transactions.providerOrderId, verdict.providerOrderId),
        ),
      )
      .limit(1);

    if (!txn) {
      // A 5xx on purpose. The alternative reading — "we do not know this order,
      // so it is junk" — loses a real payment whenever the webhook beats the
      // commit that created the transaction, which happens. The provider retries
      // with backoff, and by the second attempt the row is there.
      log.warn(
        { event: verdict.event, providerOrderId: verdict.providerOrderId },
        'payment webhook names an unknown order — asking the provider to retry',
      );
      throw internal('That payment is not known here yet.');
    }

    /**
     * A flight is paid for through the same transactions table as everything
     * else, and arrives on this same webhook — but what happens next is entirely
     * different. A venue booking is already held and capture confirms it; a
     * flight has not been booked at all yet, and capture is what authorises the
     * one irreversible call to the airline.
     *
     * So the two paths fork here, on the presence of a flight booking row rather
     * than on anything in the provider's payload. The provider has no idea what
     * it is taking money for and should not be asked.
     */
    const [flight] = await db
      .select({ id: flightBookings.id, ref: flightBookings.publicRef })
      .from(flightBookings)
      .where(eq(flightBookings.transactionId, txn.id))
      .limit(1);

    if (flight) {
      if (verdict.status === 'FAILED') {
        await onPaymentFailed({ transactionId: txn.id, failureCode: verdict.event });
        await recordAudit({
          actorUserId: null,
          action: 'flight.payment-failed',
          targetType: 'flight_booking',
          targetId: flight.id,
          result: 'SUCCESS',
          metadata: { provider: provider.name, event: verdict.event },
        });
        return NextResponse.json({ received: true, applied: true, status: 'PAYMENT_FAILED' });
      }

      if (verdict.status === 'AUTHORIZED') {
        log.info({ event: verdict.event, transactionId: txn.id }, 'flight payment authorised, waiting for capture');
        return NextResponse.json({ received: true, applied: false, status: 'AUTHORIZED' });
      }

      const moved = await onPaymentAuthorized({
        transactionId: txn.id,
        providerPaymentId: verdict.providerPaymentId,
        amountMinor: txn.amountMinor,
      });

      if (!moved) {
        return NextResponse.json({ received: true, applied: false, reason: 'booking not found' });
      }

      /**
       * The call to the airline, made from the webhook rather than the browser.
       *
       * It is the only place it can honestly be made: the browser's claim that a
       * payment succeeded is worth nothing, and this handler is the first moment
       * anybody can know the money moved. Awaited rather than queued, because the
       * customer is watching a screen that says "confirming with the airline" and
       * a background job would mean telling them to come back later for a seat
       * that either exists or does not.
       *
       * Its failure is not this response's failure. A 5xx here would make the
       * provider redeliver a webhook whose payment half already succeeded; the
       * booking is already recorded as BOOKING_FAILED with a refund owed, which
       * is the durable record that matters.
       */
      const outcome = await confirmWithProvider({ bookingId: moved.bookingId }).catch((err) => {
        log.error(
          { booking: moved.ref, err: err instanceof Error ? err.message : err },
          'confirming a flight with the airline failed after payment',
        );
        return { state: 'BOOKING_FAILED' as const };
      });

      await recordAudit({
        actorUserId: null,
        action: 'flight.payment-captured',
        targetType: 'flight_booking',
        targetId: moved.bookingId,
        result: outcome.state === 'BOOKING_FAILED' ? 'FAILED' : 'SUCCESS',
        metadata: { provider: provider.name, event: verdict.event, state: outcome.state, sourceIp: ip ?? null },
      });

      return NextResponse.json({ received: true, applied: true, status: outcome.state });
    }

    if (verdict.status === 'FAILED') {
      const result = await failCheckout({
        transactionId: txn.id,
        providerPaymentId: verdict.providerPaymentId,
        reason: `Provider reported ${verdict.event}`,
      });
      await recordAudit({
        actorUserId: null,
        action: 'checkout.payment-failed',
        targetType: 'transaction',
        targetId: txn.id,
        result: 'SUCCESS',
        metadata: { provider: provider.name, event: verdict.event, replayed: result.replayed },
      });
      return NextResponse.json({ received: true, applied: !result.replayed, status: result.status });
    }

    if (verdict.status === 'AUTHORIZED') {
      // Authorised is not captured, and only captured is money. Nothing is
      // confirmed here; the capture event that follows is what turns holds into
      // sales. Acknowledged so it is not retried.
      log.info({ event: verdict.event, transactionId: txn.id }, 'payment authorised, waiting for capture');
      return NextResponse.json({ received: true, applied: false, status: 'AUTHORIZED' });
    }

    // Captured. `completeCheckout` is idempotent by conditional UPDATE, so a
    // redelivery — which providers do routinely — confirms nothing twice and
    // issues no second ticket.
    const result = await completeCheckout({
      transactionId: txn.id,
      providerPaymentId: verdict.providerPaymentId,
    });

    await recordAudit({
      actorUserId: null,
      action: 'checkout.payment-captured',
      targetType: 'transaction',
      targetId: txn.id,
      result: 'SUCCESS',
      metadata: {
        provider: provider.name,
        event: verdict.event,
        bookings: result.bookings.length,
        replayed: result.replayed,
        sourceIp: ip ?? null,
      },
    });

    log.info(
      { transactionId: txn.id, bookings: result.bookings.length, replayed: result.replayed },
      'payment captured from webhook',
    );

    return NextResponse.json({
      received: true,
      applied: !result.replayed,
      status: result.status,
      bookings: result.bookings.length,
    });
  },
);
