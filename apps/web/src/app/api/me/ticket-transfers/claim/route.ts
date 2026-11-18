/**
 * Claim a ticket transfer code: the seat becomes yours, with a new reference.
 *
 * Every refusal that could tell a guesser something — "no such code", "already
 * claimed", "cancelled", "the sender used it themselves" — is the same 404.
 * Expiry is said plainly, because only somebody holding a real code can reach
 * that branch at all.
 *
 * `self.product:read` is not the permission here and `self.ticket:transfer` is
 * not either: claiming is receiving, and requiring a recent password to *accept*
 * a gift would be friction with nothing behind it. The code is the credential.
 */
import { z } from 'zod';
import { json, route } from '@/lib/api';
import { authorize } from '@/lib/authz/authorize';
import { claimTicketTransfer } from '@/lib/commerce/ticket-transfer';

const bodySchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(16)
      .max(40)
      .regex(/^[0-9A-Za-z -]+$/, 'A transfer code is letters, digits and dashes.'),
  })
  .strict();

export const POST = route(
  {
    bodySchema,
    rateLimit: { name: 'me:ticket-claim', subject: (ctx) => ctx.actor?.userId ?? ctx.ip ?? 'anonymous' },
  },
  async (ctx) => {
    const { actor } = await authorize({ permission: 'self.transaction:read', actor: ctx.actor ?? undefined });
    const claimed = await claimTicketTransfer({
      userId: actor.userId,
      code: ctx.body.code,
      requestId: ctx.requestId,
    });
    return json({
      status: 'claimed',
      ticketRef: claimed.ticketRef,
      title: claimed.title,
      subtitle: claimed.subtitle,
      seatLabel: claimed.seatLabel,
      admitCount: claimed.admitCount,
      validFrom: claimed.validFrom.toISOString(),
      validUntil: claimed.validUntil?.toISOString() ?? null,
    });
  },
);
