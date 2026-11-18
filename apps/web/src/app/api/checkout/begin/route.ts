/**
 * Open a checkout.
 *
 * `beginCheckout` has existed since the commerce layer was written and had no
 * HTTP entry point, so the Book button on a deal posted here and got a 404. The
 * service is unchanged; this is the door.
 *
 * **Public references in, internal ids never.** `beginCheckout` speaks in slot
 * and offer ULIDs, and those are row identifiers — sequential-ish, enumerable,
 * and meaningful to anyone who collects a few. A consumer names an offer by the
 * same `publicRef` the deal page shows them, and this route resolves it. That
 * is not decoration: accepting a `slotId` from the browser would let a caller
 * book capacity that no live offer entitles them to, at whatever price the slot
 * happens to carry.
 *
 * **The price is never in the request.** What a line costs is computed from the
 * offer and the slot, server-side, inside the same transaction that takes the
 * hold. There is no field here a caller could use to pay less.
 *
 * **Nothing here captures money.** This opens a provider order and returns the
 * publishable parameters the provider's own checkout needs. Whether the payment
 * happened is decided in `/api/webhooks/payments`, from a signed callback — never
 * from anything the browser reports afterwards.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db/client';
import { offers } from '@/db/schema';
import { route } from '@/lib/api';
import { unauthenticated, unprocessable } from '@/lib/errors';
import { beginCheckout, type CartItem } from '@/lib/commerce/checkout';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** One cart line, named the way a consumer sees it. */
const lineSchema = z.object({
  offerRef: z.string().min(4).max(32),
  quantity: z.coerce.number().int().min(1).max(10).default(1),
});

const bodySchema = z.object({
  /**
   * Accepts a single line or several. The deal page sends one; a planned trip
   * sends the whole day. One payment either way — that is the reason checkout is
   * a composition layer rather than a per-booking call.
   */
  items: z.array(lineSchema).min(1).max(12).optional(),
  offerRef: z.string().min(4).max(32).optional(),
  quantity: z.coerce.number().int().min(1).max(10).optional(),

  /** Points are capped by the balance and by the cart, server-side. */
  pointsToSpend: z.coerce.number().int().min(0).max(1_000_000).optional(),

  idempotencyKey: z.string().min(8).max(120),
});

export const POST = route(
  {
    bodySchema,
    rateLimit: { name: 'payment:create', subject: (ctx) => ctx.actor?.userId ?? ctx.ip ?? 'anonymous' },
  },
  async ({ body, actor, log }) => {
    if (!actor) throw unauthenticated();

    const lines =
      body.items ??
      (body.offerRef ? [{ offerRef: body.offerRef, quantity: body.quantity ?? 1 }] : []);
    if (lines.length === 0) throw unprocessable('Name at least one offer to book.');

    const refs = [...new Set(lines.map((line) => line.offerRef))];

    // LIVE only, and read here rather than trusted from the request. An offer
    // that is DRAFT, SCHEDULED, PAUSED or ENDED is not purchasable, and the
    // window is checked again inside `holdBooking` against the same clock that
    // takes the hold.
    const found = await db
      .select({ id: offers.id, publicRef: offers.publicRef, slotId: offers.slotId })
      .from(offers)
      .where(and(inArray(offers.publicRef, refs), eq(offers.status, 'LIVE')));

    const byRef = new Map(found.map((offer) => [offer.publicRef, offer]));

    const items: CartItem[] = [];
    for (const line of lines) {
      const offer = byRef.get(line.offerRef);
      // Deliberately the same message whether the reference is unknown, not live
      // or belongs to a deal that has ended. A distinct "no such offer" would let
      // anyone enumerate which references exist.
      if (!offer?.slotId) throw unprocessable('That deal is no longer available.');
      items.push({ slotId: offer.slotId, offerId: offer.id, quantity: line.quantity });
    }

    const result = await beginCheckout({
      userId: actor.userId,
      items,
      pointsToSpend: body.pointsToSpend,
      idempotencyKey: body.idempotencyKey,
    });

    log.info(
      {
        transactionId: result.transactionId,
        lines: items.length,
        replayed: result.replayed,
        payableMinor: result.payableMinor,
      },
      'checkout opened',
    );

    return NextResponse.json({
      transactionId: result.transactionId,
      // `clientParams` is the provider's publishable set — a key id, an order id,
      // an amount. The provider secret and the webhook secret are never in it.
      provider: result.providerOrder
        ? { orderId: result.providerOrder.providerOrderId, params: result.providerOrder.clientParams }
        : null,
      payableMinor: result.payableMinor,
      currency: result.currency,
      pointsValueMinor: result.pointsValueMinor,
      bookings: result.bookings.map((booking) => ({
        ref: booking.publicRef,
        quantity: booking.quantity,
        status: booking.status,
      })),
      replayed: result.replayed,
    });
  },
);
