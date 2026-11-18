/**
 * The businesses this person is connected to.
 *
 * Cursor pagination on the ULID primary key: ids sort by creation time, so newest
 * first is `order by id desc` and the next page is `id < cursor`. No offset, so a
 * connection made between two page loads cannot shift a row across the boundary and
 * make it disappear.
 */
import { and, desc, eq, lt } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { partnerConnections } from '@/db/schema';
import { json, paginate, route } from '@/lib/api';
import { authorize } from '@/lib/authz/authorize';
import { ULID_PATTERN } from '@/lib/ids';

const DEFAULT_LIMIT = 25;

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().regex(ULID_PATTERN).optional(),
  state: z.enum(['ACTIVE', 'SUSPENDED', 'DISCONNECTED']).optional(),
});

export const GET = route({ querySchema }, async (ctx) => {
  const { actor } = await authorize({ permission: 'self.connection:read', actor: ctx.actor ?? undefined });

  // Applied here rather than as a zod `.default()`: route() infers the schema's input
  // type, under which a defaulted field still reads as possibly undefined.
  const limit = ctx.query.limit ?? DEFAULT_LIMIT;

  const rows = await db.query.partnerConnections.findMany({
    where: and(
      eq(partnerConnections.userId, actor.userId),
      ctx.query.state ? eq(partnerConnections.state, ctx.query.state) : undefined,
      ctx.query.cursor ? lt(partnerConnections.id, ctx.query.cursor) : undefined,
    ),
    with: { organization: true },
    orderBy: [desc(partnerConnections.id)],
    // One extra row is how `paginate` knows whether a next page exists.
    limit: limit + 1,
  });

  const items = rows.map((c) => ({
    id: c.id,
    state: c.state,
    // The holder's own handle at this business. Opaque to everyone else, and the only
    // identifier the partner ever sees.
    partnerRef: c.partnerRef,
    connectedAt: c.connectedAt,
    lastUsedAt: c.lastUsedAt,
    disconnectedAt: c.disconnectedAt,
    organization: c.organization
      ? {
          id: c.organization.id,
          name: c.organization.name,
          slug: c.organization.slug,
          kind: c.organization.kind,
          city: c.organization.city,
        }
      : null,
  }));

  return json(paginate(items, limit));
});
