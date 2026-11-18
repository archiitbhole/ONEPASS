/**
 * The platform audit trail.
 *
 * Read-only, and that is structural rather than polite: audit.ts offers no update
 * or delete, and permissions.ts holds no permission that would allow one, so this
 * route is the whole of the platform's access to the table.
 *
 * Two columns are never projected. `ipHash` is a peppered one-way hash whose only
 * purpose is correlation inside the database — handing it to a client turns it
 * into a tracking identifier that outlives the investigation it was collected for.
 * Nothing here spreads a row either: every field is named, so a column added to
 * audit_logs tomorrow cannot silently start appearing in an API response.
 */
import { and, desc, eq, gte, lt, lte, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { auditLogs } from '@/db/schema';
import { json, paginate, route } from '@/lib/api';
import { authorize } from '@/lib/authz/authorize';
import { isUlid } from '@/lib/ids';

const ulidParam = z.string().refine(isUlid, 'must be an id');

const querySchema = z.object({
  actorUserId: ulidParam.optional(),
  organizationId: ulidParam.optional(),
  action: z.string().trim().min(1).max(80).optional(),
  targetType: z.string().trim().min(1).max(60).optional(),
  targetId: z.string().trim().min(1).max(64).optional(),
  result: z.enum(['SUCCESS', 'DENIED', 'FAILED']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  cursor: ulidParam.optional(),
  /** Hard ceiling: a page is a page, whatever the caller asks for. */
  limit: z.coerce.number().int().min(1).max(100).optional(),
});


export const GET = route(
  {
    querySchema,
    rateLimit: { name: 'api:general', subject: (ctx) => ctx.actor?.userId ?? ctx.ip ?? 'anonymous' },
  },
  async ({ query, actor }) => {
    await authorize({ permission: 'platform.audit:read', actor: actor ?? undefined });

    const limit = query.limit ?? 25;
    const where: (SQL | undefined)[] = [];
    if (query.actorUserId) where.push(eq(auditLogs.actorUserId, query.actorUserId));
    if (query.organizationId) where.push(eq(auditLogs.organizationId, query.organizationId));
    if (query.action) where.push(eq(auditLogs.action, query.action));
    if (query.targetType) where.push(eq(auditLogs.targetType, query.targetType));
    if (query.targetId) where.push(eq(auditLogs.targetId, query.targetId));
    if (query.result) where.push(eq(auditLogs.result, query.result));
    if (query.from) where.push(gte(auditLogs.createdAt, query.from));
    if (query.to) where.push(lte(auditLogs.createdAt, query.to));
    // Ids are ULIDs, so newest-first is `id desc` and the cursor is `id <`. No
    // offset, so a page cannot shift under a reader while an entry is written.
    if (query.cursor) where.push(lt(auditLogs.id, query.cursor));

    const rows = await db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        targetType: auditLogs.targetType,
        targetId: auditLogs.targetId,
        result: auditLogs.result,
        actorUserId: auditLogs.actorUserId,
        actorRole: auditLogs.actorRole,
        organizationId: auditLogs.organizationId,
        requestId: auditLogs.requestId,
        userAgent: auditLogs.userAgent,
        metadata: auditLogs.metadata,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(auditLogs.id))
      .limit(limit + 1);

    const page = paginate(rows, limit);

    return json({
      items: page.items.map((row) => ({
        id: row.id,
        action: row.action,
        targetType: row.targetType,
        targetId: row.targetId,
        result: row.result,
        actorUserId: row.actorUserId,
        actorRole: row.actorRole,
        organizationId: row.organizationId,
        requestId: row.requestId,
        userAgent: row.userAgent,
        // Already stripped of anything credential-shaped by sanitise() on write.
        metadata: row.metadata ?? {},
        createdAt: row.createdAt,
      })),
      nextCursor: page.nextCursor,
    });
  },
);
