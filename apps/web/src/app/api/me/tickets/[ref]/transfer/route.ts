/**
 * Offer a ticket to somebody else: returns a transfer code, once.
 *
 * `self.ticket:transfer` needs a recent password (REQUIRES_ELEVATION), for the
 * same reason giving away a product does — this is irreversible from the
 * sender's side the moment it is claimed, and a session left open on a café
 * table should not be able to cause it.
 *
 * The code is in this response and nowhere else; only its hash is stored, so a
 * lost code is cancelled and replaced, never recovered.
 */
import { z } from 'zod';
import { json, route } from '@/lib/api';
import { authorize } from '@/lib/authz/authorize';
import { offerTicketTransfer } from '@/lib/commerce/ticket-transfer';

const bodySchema = z.object({}).strict();

export const POST = route(
  {
    bodySchema,
    rateLimit: { name: 'me:ticket-transfer', subject: (ctx) => ctx.actor?.userId ?? ctx.ip ?? 'anonymous' },
  },
  async (ctx) => {
    const { actor } = await authorize({ permission: 'self.ticket:transfer', actor: ctx.actor ?? undefined });
    const offer = await offerTicketTransfer({
      userId: actor.userId,
      ticketRef: ctx.params.ref ?? '',
      requestId: ctx.requestId,
    });
    return json(
      {
        status: 'offered',
        reference: offer.reference,
        code: offer.code,
        expiresAt: offer.expiresAt.toISOString(),
        ticketRef: offer.ticketRef,
        title: offer.title,
      },
      { status: 201 },
    );
  },
);
