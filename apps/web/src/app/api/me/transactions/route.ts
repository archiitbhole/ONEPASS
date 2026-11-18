/**
 * The holder's payment history.
 *
 * Amounts stay in minor units all the way to the client. Formatting is a presentation
 * decision that needs a locale and a currency, and a float would have lost the last
 * paisa long before it got there.
 */
import { and, desc, eq, lt } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { transactions } from '@/db/schema';
import { json, paginate, route } from '@/lib/api';
import { authorize } from '@/lib/authz/authorize';
import { ULID_PATTERN } from '@/lib/ids';

const DEFAULT_LIMIT = 25;

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().regex(ULID_PATTERN).optional(),
  status: z.enum(['INITIATED', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'REFUNDED', 'CANCELLED']).optional(),
});

export const GET = route({ querySchema }, async (ctx) => {
  const { actor } = await authorize({ permission: 'self.transaction:read', actor: ctx.actor ?? undefined });

  // Applied here rather than as a zod `.default()`: route() infers the schema's input
  // type, under which a defaulted field still reads as possibly undefined.
  const limit = ctx.query.limit ?? DEFAULT_LIMIT;

  const rows = await db.query.transactions.findMany({
    where: and(
      eq(transactions.userId, actor.userId),
      ctx.query.status ? eq(transactions.status, ctx.query.status) : undefined,
      ctx.query.cursor ? lt(transactions.id, ctx.query.cursor) : undefined,
    ),
    with: { organization: true, paymentMethod: true },
    orderBy: [desc(transactions.id)],
    limit: limit + 1,
  });

  const items = rows.map((t) => ({
    id: t.id,
    amountMinor: t.amountMinor,
    currency: t.currency,
    status: t.status,
    description: t.description,
    failureCode: t.failureCode,
    createdAt: t.createdAt,
    capturedAt: t.capturedAt,
    organization: t.organization
      ? { id: t.organization.id, name: t.organization.name, slug: t.organization.slug }
      : null,
    // Only the mask. The provider token is what actually charges the instrument, so it
    // stays on the server no matter who is asking.
    paymentMethod: t.paymentMethod
      ? {
          kind: t.paymentMethod.kind,
          maskedLabel: t.paymentMethod.maskedLabel,
          network: t.paymentMethod.network,
        }
      : null,
  }));

  return json(paginate(items, limit));
});
