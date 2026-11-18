/**
 * Requesting a copy of your data.
 *
 * `self.export:request` is in REQUIRES_ELEVATION, so `authorize()` refuses a session
 * that has not re-authenticated recently. That matters more here than almost anywhere
 * else: an export is the one call that turns a borrowed laptop into a complete copy of
 * somebody's account.
 *
 * Honest about what this does: **there is no generator worker yet.** Nothing writes an
 * archive and nothing will email a link. What this endpoint does is record the request
 * — durably, in the audit trail and the security timeline — and announce it, so the
 * worker that eventually drains the outbox has something to pick up. It returns
 * `queued`, and queued is exactly what it means.
 *
 * EVENT_TYPES has no export member and this file may not add one, so the announcement
 * rides on `notify()`, whose NOTIFICATION_CREATED event the publisher already fans out
 * on the user's channel.
 */
import { z } from 'zod';
import { db } from '@/db/client';
import { json, route } from '@/lib/api';
import { notify, recordAudit, recordSecurityEvent } from '@/lib/audit';
import { authorize } from '@/lib/authz/authorize';
import { BRAND } from '@/lib/brand';

/** Nothing to send. Strict, so a stray field is a 422 rather than a silent no-op. */
const bodySchema = z.object({}).strict();

export const POST = route({ bodySchema }, async (ctx) => {
  const { actor, actorRole } = await authorize({
    permission: 'self.export:request',
    actor: ctx.actor ?? undefined,
  });

  const requestedAt = new Date();

  await db.transaction(async (tx) => {
    // An export request is a plausible first move of an account takeover, so it lands
    // on the security timeline whether or not the person reads their notifications.
    await recordSecurityEvent(
      {
        kind: 'DATA_EXPORT_REQUESTED',
        severity: 'MEDIUM',
        summary: 'A copy of the account data was requested.',
        userId: actor.userId,
        requestId: ctx.requestId,
        ip: ctx.ip,
      },
      tx,
    );

    await notify(
      {
        userId: actor.userId,
        category: 'ACCOUNT',
        title: 'Your export request is recorded',
        body: `Your request for a copy of your ${BRAND.name} data is on the record and on your security activity. No archive has been built — nothing on this deployment generates one yet — so ask support if you need the copy itself.`,
        linkPath: '/settings',
      },
      tx,
    );

    await recordAudit(
      {
        action: 'self.export.request',
        targetType: 'user',
        targetId: actor.userId,
        result: 'SUCCESS',
        actorUserId: actor.userId,
        actorRole,
        requestId: ctx.requestId,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        metadata: { requestedAt: requestedAt.toISOString() },
      },
      tx,
    );
  });

  return json({ status: 'queued', requestedAt }, { status: 202 });
});
