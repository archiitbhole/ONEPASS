/**
 * Sign out everywhere else.
 *
 * The count is taken before the revocation, because afterwards there is nothing left
 * to count — `revokeAllSessions` raises the user's session generation, so every other
 * session stops resolving in one write rather than a fan-out delete.
 */
import { z } from 'zod';
import { db } from '@/db/client';
import { authEvents } from '@/db/schema';
import { json, route } from '@/lib/api';
import { emitEvent, notify, recordAudit, userChannel } from '@/lib/audit';
import { authorize } from '@/lib/authz/authorize';
import { listSessions, revokeAllSessions } from '@/lib/auth/session';
import { peppered } from '@/lib/crypto';
import { ulid } from '@/lib/ids';
import { BRAND } from '@/lib/brand';

const bodySchema = z
  .object({ reason: z.string().trim().max(120).optional() })
  .strict();

export const POST = route({ bodySchema }, async (ctx) => {
  const { actor, actorRole } = await authorize({
    permission: 'self.session:revoke',
    actor: ctx.actor ?? undefined,
  });

  const live = await listSessions(actor.userId);
  const others = live.filter((s) => s.id !== actor.session.sessionId);

  // The caller's own session is kept: "sign out my other devices" that also signs you
  // out of the device you asked from is a bug, not a security feature.
  await revokeAllSessions(actor.userId, ctx.body.reason ?? 'holder signed out other devices', actor.session.sessionId);

  await db.insert(authEvents).values({
    id: ulid(),
    userId: actor.userId,
    kind: 'SESSION_REVOKED',
    ipHash: peppered(ctx.ip),
    userAgent: ctx.userAgent?.slice(0, 400) ?? null,
    requestId: ctx.requestId,
    detail: { scope: 'all-others', count: others.length },
  });

  await emitEvent({
    type: 'SESSION_REVOKED',
    aggregateType: 'user',
    aggregateId: actor.userId,
    channel: userChannel(actor.userId),
    payload: { scope: 'all-others', count: others.length, keptSessionId: actor.session.sessionId },
  });

  // Worth a notification: if this was not the account holder, the mail that follows
  // is the first thing that tells them.
  await notify({
    userId: actor.userId,
    category: 'SECURITY',
    title: 'Signed out everywhere else',
    body: `${others.length} other ${others.length === 1 ? 'device was' : 'devices were'} signed out of ${BRAND.name}.`,
    linkPath: '/profile',
  });

  await recordAudit({
    action: 'self.session.revoke-all',
    targetType: 'user',
    targetId: actor.userId,
    result: 'SUCCESS',
    actorUserId: actor.userId,
    actorRole,
    requestId: ctx.requestId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    metadata: { revoked: others.length },
  });

  return json({ revoked: others.length, keptSessionId: actor.session.sessionId });
});
