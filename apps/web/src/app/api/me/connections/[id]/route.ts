/**
 * Disconnecting a business.
 *
 * Disconnecting withdraws the sharing that the connection carried. Leaving the grants
 * standing would be a lie told by the consent screen: the partner would still hold
 * live permission to read, and the person would have been shown that they had ended
 * it. So both moves happen in one transaction, together with the events that announce
 * them — an event that outlives a rolled-back write is worse than no event at all.
 *
 * Nothing is deleted. The connection keeps its history and the grants keep theirs;
 * only the state changes.
 */
import { and, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { consentGrants, partnerConnections } from '@/db/schema';
import { json, route } from '@/lib/api';
import { emitEvent, notify, orgChannel, recordAudit, userChannel } from '@/lib/audit';
import { assertSameUser, authorize } from '@/lib/authz/authorize';
import { conflict, notFound } from '@/lib/errors';
import { isUlid } from '@/lib/ids';

export const DELETE = route({}, async (ctx) => {
  const { actor, actorRole } = await authorize({
    permission: 'self.connection:write',
    actor: ctx.actor ?? undefined,
  });

  const id = ctx.params.id;
  if (!isUlid(id)) throw notFound('Not found.');

  const row = await db.query.partnerConnections.findFirst({
    where: and(eq(partnerConnections.id, id), eq(partnerConnections.userId, actor.userId)),
    with: { organization: true },
  });
  if (!row) throw notFound('Not found.');
  assertSameUser(actor, row.userId);

  if (row.state === 'DISCONNECTED') {
    await recordAudit({
      action: 'self.connection.disconnect',
      targetType: 'partner_connection',
      targetId: row.id,
      result: 'FAILED',
      actorUserId: actor.userId,
      actorRole,
      organizationId: row.organizationId,
      requestId: ctx.requestId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { reason: 'already_disconnected' },
    });
    throw conflict('You are already disconnected from this business.');
  }

  const at = new Date();
  const revoked = await db.transaction(async (tx) => {
    await tx
      .update(partnerConnections)
      .set({ state: 'DISCONNECTED', disconnectedAt: at })
      .where(eq(partnerConnections.id, row.id));

    const grants = await tx
      .update(consentGrants)
      .set({ state: 'REVOKED', revokedAt: at, revokedByUserId: actor.userId })
      .where(
        and(
          eq(consentGrants.userId, actor.userId),
          eq(consentGrants.connectionId, row.id),
          eq(consentGrants.state, 'GRANTED'),
        ),
      )
      .returning({ id: consentGrants.id });

    await emitEvent(
      {
        type: 'PARTNER_DISCONNECTED',
        aggregateType: 'connection',
        aggregateId: row.id,
        channel: userChannel(actor.userId),
        payload: { organizationId: row.organizationId, revokedGrants: grants.length, at: at.toISOString() },
      },
      tx,
    );

    // The partner is told too, by their own handle for this customer — their console
    // has to stop showing a live connection that no longer exists. The payload carries
    // nothing that would let them re-identify the person.
    await emitEvent(
      {
        type: 'PARTNER_DISCONNECTED',
        aggregateType: 'connection',
        aggregateId: row.id,
        channel: orgChannel(row.organizationId),
        payload: { connectionId: row.id, partnerRef: row.partnerRef, at: at.toISOString() },
      },
      tx,
    );

    // One per grant rather than a single summary: anything tracking consent state from
    // the event stream would otherwise never learn that these particular grants ended.
    for (const grant of grants) {
      await emitEvent(
        {
          type: 'CONSENT_REVOKED',
          aggregateType: 'consent_grant',
          aggregateId: grant.id,
          channel: userChannel(actor.userId),
          payload: { connectionId: row.id, organizationId: row.organizationId, cause: 'disconnected' },
        },
        tx,
      );
      // And the merchant's copy. Withdrawing one consent through
      // /api/me/consents/[id] already told the organization; disconnecting
      // entirely — which withdraws all of them at once — told only the customer.
      // A partner caching what it is allowed to read would have kept reading on
      // the strength of a grant that no longer exists. The API would refuse it,
      // so this is not a disclosure bug, but their cache stays wrong until
      // something else invalidates it, and this is the event that should.
      await emitEvent(
        {
          type: 'CONSENT_REVOKED',
          aggregateType: 'consent_grant',
          aggregateId: grant.id,
          channel: orgChannel(row.organizationId),
          payload: { connectionId: row.id, partnerRef: row.partnerRef, cause: 'disconnected' },
        },
        tx,
      );
    }

    await notify(
      {
        userId: actor.userId,
        category: 'PARTNER',
        title: `Disconnected from ${row.organization?.name ?? 'a business'}`,
        body:
          grants.length > 0
            ? `They can no longer see what you had shared. ${grants.length} ${grants.length === 1 ? 'permission was' : 'permissions were'} withdrawn.`
            : 'They can no longer verify your pass or see your details.',
        linkPath: '/profile',
      },
      tx,
    );

    await recordAudit(
      {
        action: 'self.connection.disconnect',
        targetType: 'partner_connection',
        targetId: row.id,
        result: 'SUCCESS',
        actorUserId: actor.userId,
        actorRole,
        organizationId: row.organizationId,
        requestId: ctx.requestId,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        metadata: { revokedGrants: grants.length },
      },
      tx,
    );

    return grants.length;
  });

  return json({ id: row.id, state: 'DISCONNECTED', disconnectedAt: at, revokedGrants: revoked });
});
