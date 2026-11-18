/** Withdraw a transfer code that has not been claimed. */
import { z } from 'zod';
import { json, route } from '@/lib/api';
import { authorize } from '@/lib/authz/authorize';
import { cancelTransfer } from '@/lib/products/ownership';

const bodySchema = z.object({}).strict();

export const POST = route(
  { bodySchema, rateLimit: { name: 'me:product-transfer', subject: (ctx) => ctx.actor?.userId ?? ctx.ip ?? 'anonymous' } },
  async (ctx) => {
    // Cancelling only ever keeps property where it is, so it needs no elevation.
    const { actor } = await authorize({ permission: 'self.product:read', actor: ctx.actor ?? undefined });
    await cancelTransfer({ userId: actor.userId, transferRef: ctx.params.ref ?? '' });
    return json({ status: 'cancelled' });
  },
);
