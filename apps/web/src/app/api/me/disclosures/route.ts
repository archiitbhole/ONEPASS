/**
 * Who has seen what about me.
 *
 * The holder's own disclosure receipts (D-006), newest first. Scoped to the
 * session's user and nothing else — there is no parameter naming whose history
 * to read, so there is nothing to tamper with.
 */
import { z } from 'zod';
import { json, route } from '@/lib/api';
import { authorize } from '@/lib/authz/authorize';
import { ULID_PATTERN } from '@/lib/ids';
import { listDisclosures } from '@/lib/privacy/disclosures';

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().regex(ULID_PATTERN).optional(),
});

export const GET = route({ querySchema, rateLimit: { name: 'api:general' } }, async (ctx) => {
  const { actor } = await authorize({ permission: 'self.consent:read', actor: ctx.actor ?? undefined });
  return json(await listDisclosures({ userId: actor.userId, cursor: ctx.query.cursor, limit: ctx.query.limit }));
});
