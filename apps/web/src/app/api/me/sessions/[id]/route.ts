/**
 * Signing one device out.
 *
 * The lookup is filtered by the owner *and* re-checked with `assertSameUser`, so a
 * session id belonging to somebody else is a 404 twice over. A 403 here would confirm
 * that the id exists, which is exactly what an attacker holding a stolen id wants to
 * learn.
 */
import { and, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { authEvents, sessions } from '@/db/schema';
import { json, route } from '@/lib/api';
import { emitEvent, recordAudit, userChannel } from '@/lib/audit';
import { assertSameUser, authorize } from '@/lib/authz/authorize';
import { revokeSession } from '@/lib/auth/session';
import { peppered } from '@/lib/crypto';
import { conflict, notFound } from '@/lib/errors';
import { isUlid, ulid } from '@/lib/ids';

export const DELETE = route({}, async (ctx) => {
  const { actor, actorRole } = await authorize({
    permission: 'self.session:revoke',
    actor: ctx.actor ?? undefined,
  });

  const id = ctx.params.id;
  if (!isUlid(id)) throw notFound('Not found.');

  const row = await db.query.sessions.findFirst({
    where: and(eq(sessions.id, id), eq(sessions.userId, actor.userId)),
  });
  if (!row) throw notFound('Not found.');
  assertSameUser(actor, row.userId);

  if (row.revokedAt) {
    await recordAudit({
      action: 'self.session.revoke',
      targetType: 'session',
      targetId: row.id,
      result: 'FAILED',
      actorUserId: actor.userId,
      actorRole,
      requestId: ctx.requestId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { reason: 'already_revoked' },
    });
    throw conflict('That device is already signed out.');
  }

  const isCurrent = row.id === actor.session.sessionId;
  await revokeSession(row.id, isCurrent ? 'signed out by holder' : 'revoked from device list');

  // The security timeline is assembled from auth_events, so a revocation that starts
  // here has to land there too or it silently vanishes from the page that exists to
  // show it.
  await db.insert(authEvents).values({
    id: ulid(),
    userId: actor.userId,
    kind: 'SESSION_REVOKED',
    ipHash: peppered(ctx.ip),
    userAgent: ctx.userAgent?.slice(0, 400) ?? null,
    requestId: ctx.requestId,
    detail: { sessionId: row.id, self: isCurrent },
  });

  await emitEvent({
    type: 'SESSION_REVOKED',
    aggregateType: 'session',
    aggregateId: row.id,
    channel: userChannel(actor.userId),
    payload: { sessionId: row.id, self: isCurrent },
  });

  await recordAudit({
    action: 'self.session.revoke',
    targetType: 'session',
    targetId: row.id,
    result: 'SUCCESS',
    actorUserId: actor.userId,
    actorRole,
    requestId: ctx.requestId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    metadata: { self: isCurrent },
  });

  return json({ id: row.id, revoked: true, wasCurrentSession: isCurrent });
});
