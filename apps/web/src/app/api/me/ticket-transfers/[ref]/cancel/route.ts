/**
 * Cancel an offer you made. The code stops working immediately.
 *
 * Not elevated: cancelling is the safe direction. Making somebody re-enter a
 * password to *undo* a transfer they now regret would be friction pointed
 * exactly the wrong way.
 */
import { z } from 'zod';
import { json, route } from '@/lib/api';
import { authorize } from '@/lib/authz/authorize';
import { cancelTicketTransfer } from '@/lib/commerce/ticket-transfer';

const bodySchema = z.object({}).strict();

export const POST = route(
  {
    bodySchema,
    rateLimit: { name: 'me:ticket-transfer', subject: (ctx) => ctx.actor?.userId ?? ctx.ip ?? 'anonymous' },
  },
  async (ctx) => {
    const { actor } = await authorize({ permission: 'self.transaction:read', actor: ctx.actor ?? undefined });
    await cancelTicketTransfer({ userId: actor.userId, transferRef: ctx.params.ref ?? '' });
    return json({ status: 'cancelled' });
  },
);
