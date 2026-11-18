/** The products the caller owns now (D-007). Only theirs; there is no parameter naming whose. */
import { json, route } from '@/lib/api';
import { authorize } from '@/lib/authz/authorize';
import { listOwnedProducts } from '@/lib/products/ownership';

export const GET = route({ rateLimit: { name: 'api:general' } }, async (ctx) => {
  const { actor } = await authorize({ permission: 'self.product:read', actor: ctx.actor ?? undefined });
  return json({ products: await listOwnedProducts(actor.userId) });
});
