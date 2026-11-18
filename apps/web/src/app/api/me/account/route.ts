/**
 * Closing the account.
 *
 * Deletion is a workflow, not a DELETE. Nothing here removes a row: a request is
 * filed, the user's status becomes DELETION_PENDING, and a worker acts on it after the
 * grace window. Transactions and audit records carry their own retention obligations,
 * so what actually happens at the end is anonymisation, documented in docs/privacy.md.
 *
 * `self.account:delete` is in REQUIRES_ELEVATION, so `authorize()` demands a recent
 * re-authentication — an unattended session must not be able to close an account.
 *
 * One consequence worth knowing: once the status is DELETION_PENDING the user is no
 * longer ACTIVE, so `resolveSession` stops resolving their sessions and the caller is
 * signed out on their next request. That is why the response says so instead of
 * pretending the app can carry on.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { accountDeletionRequests, users } from '@/db/schema';
import { json, route } from '@/lib/api';
import { notify, recordAudit, recordSecurityEvent } from '@/lib/audit';
import { authorize } from '@/lib/authz/authorize';
import { conflict } from '@/lib/errors';
import { ulid } from '@/lib/ids';
import { BRAND } from '@/lib/brand';

/** The window in which a person can change their mind, and support can undo a mistake. */
const GRACE_DAYS = 30;

const bodySchema = z
  .object({ reason: z.string().trim().max(240).optional() })
  .strict();

export const DELETE = route({ bodySchema }, async (ctx) => {
  const { actor, actorRole } = await authorize({
    permission: 'self.account:delete',
    actor: ctx.actor ?? undefined,
  });

  const open = await db.query.accountDeletionRequests.findFirst({
    where: and(
      eq(accountDeletionRequests.userId, actor.userId),
      inArray(accountDeletionRequests.stage, ['REQUESTED', 'GRACE_PERIOD', 'ANONYMISING']),
    ),
  });
  if (open) {
    await recordAudit({
      action: 'self.account.delete-request',
      targetType: 'user',
      targetId: actor.userId,
      result: 'FAILED',
      actorUserId: actor.userId,
      actorRole,
      requestId: ctx.requestId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { reason: 'already_pending', stage: open.stage },
    });
    throw conflict('Your account is already scheduled for closure.');
  }

  const id = ulid();
  const requestedAt = new Date();
  const executeAfter = new Date(requestedAt.getTime() + GRACE_DAYS * 24 * 60 * 60 * 1000);

  await db.transaction(async (tx) => {
    await tx.insert(accountDeletionRequests).values({
      id,
      userId: actor.userId,
      stage: 'REQUESTED',
      reason: ctx.body.reason ?? null,
      requestedAt,
      executeAfter,
    });

    await tx
      .update(users)
      .set({ status: 'DELETION_PENDING', updatedAt: requestedAt })
      .where(eq(users.id, actor.userId));

    await recordSecurityEvent(
      {
        kind: 'ACCOUNT_DELETION_REQUESTED',
        severity: 'HIGH',
        summary: 'Account closure was requested.',
        userId: actor.userId,
        requestId: ctx.requestId,
        ip: ctx.ip,
        metadata: { executeAfter: executeAfter.toISOString() },
      },
      tx,
    );

    // Delivered by email as well as in-app: if this was not the account holder, that
    // mail is the only warning they will get inside the window in which it is
    // still reversible.
    await notify(
      {
        userId: actor.userId,
        category: 'ACCOUNT',
        title: 'Your account is scheduled for closure',
        body: `${BRAND.name} will close your account after ${executeAfter.toDateString()}. Contact support before then if this was not you.`,
        linkPath: '/settings',
      },
      tx,
    );

    await recordAudit(
      {
        action: 'self.account.delete-request',
        targetType: 'user',
        targetId: actor.userId,
        result: 'SUCCESS',
        actorUserId: actor.userId,
        actorRole,
        requestId: ctx.requestId,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        metadata: { deletionRequestId: id, executeAfter: executeAfter.toISOString(), graceDays: GRACE_DAYS },
      },
      tx,
    );
  });

  return json({
    id,
    stage: 'REQUESTED',
    requestedAt,
    executeAfter,
    graceDays: GRACE_DAYS,
    // The session stops resolving from here, so the client should drop to signed-out
    // rather than firing another authenticated request and getting a 401 it cannot explain.
    signedOut: true,
  });
});
