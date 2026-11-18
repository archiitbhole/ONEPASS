/**
 * Claim a transfer code: the item becomes yours.
 *
 * Every refusal that could tell a guesser something ("no such code", "already
 * claimed", "cancelled") is the same 404. Expiry is said plainly because only
 * somebody holding a real code can reach it.
 */
import { z } from 'zod';
import { json, route } from '@/lib/api';
import { authorize } from '@/lib/authz/authorize';
import { claimTransfer } from '@/lib/products/ownership';

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
  { bodySchema, rateLimit: { name: 'me:product-claim', subject: (ctx) => ctx.actor?.userId ?? ctx.ip ?? 'anonymous' } },
  async (ctx) => {
    const { actor } = await authorize({ permission: 'self.product:read', actor: ctx.actor ?? undefined });
    const claimed = await claimTransfer({ userId: actor.userId, code: ctx.body.code, requestId: ctx.requestId });
    return json({ status: 'claimed', ...claimed });
  },
);
