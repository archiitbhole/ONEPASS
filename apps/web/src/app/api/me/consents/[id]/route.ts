/**
 * Withdrawing one grant.
 *
 * Revocation is a state change, never a delete: the record that this person once
 * agreed, and when they stopped, is the only evidence either side has if the sharing
 * is ever disputed.
 */
import { and, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { consentGrants } from '@/db/schema';
import { json, route } from '@/lib/api';
import { emitEvent, notify, orgChannel, recordAudit, userChannel } from '@/lib/audit';
import { assertSameUser, authorize } from '@/lib/authz/authorize';
import { conflict, notFound } from '@/lib/errors';
import { isUlid } from '@/lib/ids';
import { recordConsentReceipt } from '@/lib/privacy/consent-receipts';

export const DELETE = route({}, async (ctx) => {
  const { actor, actorRole } = await authorize({
    permission: 'self.consent:write',
    actor: ctx.actor ?? undefined,
  });

  const id = ctx.params.id;
  if (!isUlid(id)) throw notFound('Not found.');

  // Filtered by owner and asserted again below: somebody else's grant id is a 404,
  // which is the same answer as an id that never existed.
  const row = await db.query.consentGrants.findFirst({
    where: and(eq(consentGrants.id, id), eq(consentGrants.userId, actor.userId)),
    with: { organization: true, version: { with: { definition: true } } },
  });
  if (!row) throw notFound('Not found.');
  assertSameUser(actor, row.userId);

  const definition = row.version?.definition ?? null;
  const scopeKey = definition?.key ?? null;
  const scopeLabel = definition?.label ?? 'this permission';

  if (row.state !== 'GRANTED') {
    await recordAudit({
      action: 'self.consent.revoke',
      targetType: 'consent_grant',
      targetId: row.id,
      result: 'FAILED',
      actorUserId: actor.userId,
      actorRole,
      organizationId: row.organizationId,
      requestId: ctx.requestId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { reason: 'not_granted', state: row.state, scope: scopeKey },
    });
    throw conflict('That sharing has already ended.');
  }

  const revokedAt = new Date();
  let receiptRef = '';
  await db.transaction(async (tx) => {
    await tx
      .update(consentGrants)
      .set({ state: 'REVOKED', revokedAt, revokedByUserId: actor.userId })
      .where(eq(consentGrants.id, row.id));

    /*
      The receipt for withdrawing, snapshotted the same way as the one for
      agreeing — and for the same reason. "You stopped sharing X on the 3rd" is
      only evidence if X still means, a year later, what it meant on the 3rd.
    */
    receiptRef = await recordConsentReceipt(
      {
        userId: actor.userId,
        organizationId: row.organizationId,
        organizationName: row.organization?.name ?? null,
        consentGrantId: row.id,
        consentVersionId: row.consentVersionId,
        action: 'REVOKED',
        scope: {
          key: scopeKey ?? 'unknown',
          label: scopeLabel,
          description: definition?.description ?? '',
          fields: definition?.fields ?? [],
          sensitive: definition?.sensitive ?? false,
        },
        versionNumber: row.version?.version ?? null,
        bodyText: row.version?.bodyText ?? null,
        purpose: row.purpose,
        requestId: ctx.requestId,
      },
      tx,
    );

    await emitEvent(
      {
        type: 'CONSENT_REVOKED',
        aggregateType: 'consent_grant',
        aggregateId: row.id,
        channel: userChannel(actor.userId),
        payload: { organizationId: row.organizationId, scope: scopeKey, at: revokedAt.toISOString() },
      },
      tx,
    );

    // The partner has to lose the field set immediately; a cache that keeps serving it
    // until the next poll is a read without consent.
    await emitEvent(
      {
        type: 'CONSENT_REVOKED',
        aggregateType: 'consent_grant',
        aggregateId: row.id,
        channel: orgChannel(row.organizationId),
        payload: { connectionId: row.connectionId, scope: scopeKey, at: revokedAt.toISOString() },
      },
      tx,
    );

    await notify(
      {
        userId: actor.userId,
        category: 'CONSENT',
        title: `You stopped sharing “${scopeLabel}”`,
        body: `${row.organization?.name ?? 'That business'} can no longer see it.`,
        linkPath: '/profile',
      },
      tx,
    );

    await recordAudit(
      {
        action: 'self.consent.revoke',
        targetType: 'consent_grant',
        targetId: row.id,
        result: 'SUCCESS',
        actorUserId: actor.userId,
        actorRole,
        organizationId: row.organizationId,
        requestId: ctx.requestId,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        metadata: { scope: scopeKey },
      },
      tx,
    );
  });

  return json({ id: row.id, state: 'REVOKED', revokedAt, receipt: receiptRef });
});
