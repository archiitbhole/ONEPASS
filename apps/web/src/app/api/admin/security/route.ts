/**
 * Security events: the queue, and acknowledging what has been looked at.
 *
 * An event here is a statement that something worth a human's attention happened —
 * a lockout, a burst of failed logins, a pass rejected for replay. Acknowledging
 * one does not delete or edit it; it stamps who looked and when, so the queue
 * shrinks without the history doing the same.
 *
 * `ipHash` is never projected. It is a peppered one-way hash that exists so events
 * can be correlated *inside* the database; handed to a client it becomes a
 * tracking identifier with a longer life than the investigation that produced it.
 * As everywhere in the admin surface, each field is named on the way out.
 */
import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { securityEvents } from '@/db/schema';
import { json, paginate, route } from '@/lib/api';
import { recordAudit } from '@/lib/audit';
import { authorize } from '@/lib/authz/authorize';
import { isUlid } from '@/lib/ids';

const ulidParam = z.string().refine(isUlid, 'must be an id');

const querySchema = z.object({
  severity: z.enum(['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  kind: z.string().trim().min(1).max(64).optional(),
  userId: ulidParam.optional(),
  organizationId: ulidParam.optional(),
  /** Query strings carry text, so the flag stays text and is compared, not coerced. */
  acknowledged: z.enum(['true', 'false']).optional(),
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
    await authorize({ permission: 'platform.security:read', actor: actor ?? undefined });

    const limit = query.limit ?? 25;
    const where: (SQL | undefined)[] = [];
    if (query.severity) where.push(eq(securityEvents.severity, query.severity));
    if (query.kind) where.push(eq(securityEvents.kind, query.kind));
    if (query.userId) where.push(eq(securityEvents.userId, query.userId));
    if (query.organizationId) where.push(eq(securityEvents.organizationId, query.organizationId));
    if (query.acknowledged === 'true') where.push(isNotNull(securityEvents.acknowledgedAt));
    if (query.acknowledged === 'false') where.push(isNull(securityEvents.acknowledgedAt));
    if (query.from) where.push(gte(securityEvents.createdAt, query.from));
    if (query.to) where.push(lte(securityEvents.createdAt, query.to));
    // Ids are ULIDs, so newest-first is `id desc` and the cursor is `id <`.
    if (query.cursor) where.push(lt(securityEvents.id, query.cursor));

    const rows = await db
      .select({
        id: securityEvents.id,
        kind: securityEvents.kind,
        severity: securityEvents.severity,
        summary: securityEvents.summary,
        metadata: securityEvents.metadata,
        requestId: securityEvents.requestId,
        userId: securityEvents.userId,
        organizationId: securityEvents.organizationId,
        acknowledgedAt: securityEvents.acknowledgedAt,
        acknowledgedByUserId: securityEvents.acknowledgedByUserId,
        createdAt: securityEvents.createdAt,
      })
      .from(securityEvents)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(securityEvents.id))
      .limit(limit + 1);

    const page = paginate(rows, limit);

    return json({
      items: page.items.map((row) => ({
        id: row.id,
        kind: row.kind,
        severity: row.severity,
        summary: row.summary,
        // Already stripped of anything credential-shaped by sanitise() on write.
        metadata: row.metadata ?? {},
        requestId: row.requestId,
        userId: row.userId,
        organizationId: row.organizationId,
        acknowledgedAt: row.acknowledgedAt,
        acknowledgedByUserId: row.acknowledgedByUserId,
        createdAt: row.createdAt,
      })),
      nextCursor: page.nextCursor,
    });
  },
);

const acknowledgeSchema = z.object({
  /** Bounded: triage clears a screenful at a time, not the whole table. */
  eventIds: z.array(ulidParam).min(1).max(50),
  note: z.string().trim().max(500).optional(),
});


export const POST = route(
  {
    bodySchema: acknowledgeSchema,
    rateLimit: { name: 'admin:sensitive', subject: (ctx) => ctx.actor?.userId ?? ctx.ip ?? 'anonymous' },
  },
  async ({ body, actor, requestId, ip, userAgent }) => {
    const auth = await authorize({ permission: 'platform.security:acknowledge', actor: actor ?? undefined });

    const requested = [...new Set(body.eventIds)];
    const acknowledgedAt = new Date();

    const updated = await db.transaction(async (tx) => {
      // `is null` in the predicate makes this idempotent and race-safe: two people
      // clearing the same queue cannot overwrite each other's acknowledgement, and
      // the second one simply updates nothing.
      const rows = await tx
        .update(securityEvents)
        .set({ acknowledgedAt, acknowledgedByUserId: auth.actor.userId })
        .where(and(inArray(securityEvents.id, requested), isNull(securityEvents.acknowledgedAt)))
        .returning({ id: securityEvents.id, kind: securityEvents.kind, severity: securityEvents.severity });

      // One audit entry per event, not per request: the trail is queried by target,
      // and an entry that named a batch would be invisible when looking up an event.
      for (const row of rows) {
        await recordAudit(
          {
            action: 'platform.security.acknowledge',
            targetType: 'security_event',
            targetId: row.id,
            result: 'SUCCESS',
            actorUserId: auth.actor.userId,
            actorRole: auth.actorRole,
            requestId,
            ip,
            userAgent,
            metadata: { kind: row.kind, severity: row.severity, note: body.note ?? null },
          },
          tx,
        );
      }

      return rows;
    });

    const acknowledged = updated.map((row) => row.id);
    return json({
      acknowledged,
      // Anything not in the list was already acknowledged or does not exist. Both
      // are the same non-event, and neither is worth a separate error.
      unchanged: requested.filter((id) => !acknowledged.includes(id)),
      acknowledgedAt,
    });
  },
);
