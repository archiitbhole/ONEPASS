/**
 * Offer a product to someone else: returns a transfer code, once.
 *
 * `self.product:transfer` needs a recent password (REQUIRES_ELEVATION) — giving
 * away property is not something a session left open on a café table should be
 * able to do. The code is in this response and nowhere else; only its hash is
 * stored, so a lost code is cancelled and replaced, never recovered.
 */
import { z } from 'zod';
import { json, route } from '@/lib/api';
import { authorize } from '@/lib/authz/authorize';
import { offerTransfer } from '@/lib/products/ownership';

const bodySchema = z.object({}).strict();

export const POST = route(
  { bodySchema, rateLimit: { name: 'me:product-transfer', subject: (ctx) => ctx.actor?.userId ?? ctx.ip ?? 'anonymous' } },
  async (ctx) => {
    const { actor } = await authorize({ permission: 'self.product:transfer', actor: ctx.actor ?? undefined });
    const offer = await offerTransfer({
      userId: actor.userId,
      productRef: ctx.params.ref ?? '',
      requestId: ctx.requestId,
    });
    return json({ status: 'offered', reference: offer.reference, code: offer.code, expiresAt: offer.expiresAt.toISOString() }, { status: 201 });
  },
);
