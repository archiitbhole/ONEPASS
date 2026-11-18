/**
 * Cancel a booking you made.
 *
 * Only where no money and no points are at stake — `selfCancellable` in the
 * booking service is the single place that decides, and it decides again
 * inside the transaction, so a payment attached between the screen and the
 * press is refused rather than raced. Nothing here refunds anything, and the
 * response never says anything about money.
 *
 * A reference that is not this person's answers 404, not 403: the error must
 * not confirm that somebody else's booking exists.
 */
import { z } from 'zod';
import { json, route } from '@/lib/api';
import { authorize } from '@/lib/authz/authorize';
import { cancelBookingByHolder } from '@/lib/commerce/booking';

const bodySchema = z
  .object({
    /** Optional, and shown to the venue on their console. */
    reason: z.string().trim().max(160).optional(),
  })
  .strict();

export const POST = route(
  {
    bodySchema,
    rateLimit: { name: 'me:booking-cancel', subject: (ctx) => ctx.actor?.userId ?? ctx.ip ?? 'anonymous' },
  },
  async (ctx) => {
    const { actor } = await authorize({ permission: 'self.booking:cancel', actor: ctx.actor ?? undefined });

    const booking = await cancelBookingByHolder({
      publicRef: ctx.params.ref ?? '',
      userId: actor.userId,
      reason: ctx.body.reason,
    });

    return json({
      status: booking.status,
      reference: booking.publicRef,
      cancelledReason: booking.cancelledReason,
    });
  },
);
