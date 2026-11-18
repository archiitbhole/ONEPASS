/**
 * The in-app inbox, and marking parts of it read.
 *
 * Marking read is a POST rather than a PATCH per id because a client that has just
 * scrolled a screen has a handful of ids and one intention; a request per notification
 * would be a burst of writes describing a single human action.
 */
import { and, count, desc, eq, inArray, isNull, lt } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { notifications } from '@/db/schema';
import { json, paginate, route } from '@/lib/api';
import { recordAudit } from '@/lib/audit';
import { authorize } from '@/lib/authz/authorize';
import { ULID_PATTERN } from '@/lib/ids';

const DEFAULT_LIMIT = 25;

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().regex(ULID_PATTERN).optional(),
  unread: z.enum(['true', 'false']).optional(),
});

export const GET = route({ querySchema }, async (ctx) => {
  const { actor } = await authorize({ permission: 'self.notification:read', actor: ctx.actor ?? undefined });

  // Applied here rather than as a zod `.default()`: route() infers the schema's input
  // type, under which a defaulted field still reads as possibly undefined.
  const limit = ctx.query.limit ?? DEFAULT_LIMIT;

  const rows = await db.query.notifications.findMany({
    where: and(
      eq(notifications.userId, actor.userId),
      ctx.query.unread === 'true' ? isNull(notifications.readAt) : undefined,
      ctx.query.cursor ? lt(notifications.id, ctx.query.cursor) : undefined,
    ),
    orderBy: [desc(notifications.id)],
    limit: limit + 1,
  });

  // A separate count, because the badge has to be right even when the caller is deep
  // in the pagination and the current page holds nothing unread.
  const [unread] = await db
    .select({ n: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, actor.userId), isNull(notifications.readAt)));

  const items = rows.map((n) => ({
    id: n.id,
    category: n.category,
    title: n.title,
    body: n.body,
    linkPath: n.linkPath,
    data: n.data,
    readAt: n.readAt,
    createdAt: n.createdAt,
  }));

  return json({ ...paginate(items, limit), unreadCount: unread?.n ?? 0 });
});

const bodySchema = z
  .object({
    ids: z.array(z.string().regex(ULID_PATTERN)).min(1).max(100),
  })
  .strict();

export const POST = route({ bodySchema }, async (ctx) => {
  const { actor, actorRole } = await authorize({
    permission: 'self.notification:write',
    actor: ctx.actor ?? undefined,
  });

  // The owner filter is what makes the id list safe to accept: an id belonging to
  // somebody else matches nothing and is reported as simply not updated.
  const updated = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.userId, actor.userId),
        inArray(notifications.id, ctx.body.ids),
        isNull(notifications.readAt),
      ),
    )
    .returning({ id: notifications.id });

  await recordAudit({
    action: 'self.notification.read',
    targetType: 'notification',
    targetId: updated.length === 1 ? (updated[0]?.id ?? null) : null,
    result: 'SUCCESS',
    actorUserId: actor.userId,
    actorRole,
    requestId: ctx.requestId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    metadata: { requested: ctx.body.ids.length, updated: updated.length },
  });

  return json({ updated: updated.length, ids: updated.map((n) => n.id) });
});
