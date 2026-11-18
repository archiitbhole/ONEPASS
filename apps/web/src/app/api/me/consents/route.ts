/**
 * What this person has agreed to share, and the act of agreeing to share something
 * new.
 *
 * A grant points at a consent *version*, not a definition, so re-wording a scope
 * never rewrites what somebody actually agreed to. The list therefore reports the
 * version that was in force at the moment of the grant, even after a newer one
 * exists.
 */
import { and, desc, eq, isNull, lt } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { consentDefinitions, consentGrants, consentVersions, partnerConnections } from '@/db/schema';
import { json, paginate, route } from '@/lib/api';
import { emitEvent, notify, orgChannel, recordAudit, userChannel } from '@/lib/audit';
import { authorize } from '@/lib/authz/authorize';
import { conflict, notFound, unprocessable } from '@/lib/errors';
import { ULID_PATTERN, ulid } from '@/lib/ids';
import { recordConsentReceipt } from '@/lib/privacy/consent-receipts';

const DEFAULT_LIMIT = 25;

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().regex(ULID_PATTERN).optional(),
  state: z.enum(['GRANTED', 'REVOKED', 'EXPIRED']).optional(),
});

export const GET = route({ querySchema }, async (ctx) => {
  const { actor } = await authorize({ permission: 'self.consent:read', actor: ctx.actor ?? undefined });

  // Applied here rather than as a zod `.default()`: route() infers the schema's input
  // type, under which a defaulted field still reads as possibly undefined.
  const limit = ctx.query.limit ?? DEFAULT_LIMIT;

  const rows = await db.query.consentGrants.findMany({
    where: and(
      eq(consentGrants.userId, actor.userId),
      ctx.query.state ? eq(consentGrants.state, ctx.query.state) : undefined,
      ctx.query.cursor ? lt(consentGrants.id, ctx.query.cursor) : undefined,
    ),
    with: { organization: true, version: { with: { definition: true } } },
    orderBy: [desc(consentGrants.id)],
    limit: limit + 1,
  });

  const items = rows.map((g) => ({
    id: g.id,
    state: g.state,
    purpose: g.purpose,
    grantedAt: g.grantedAt,
    expiresAt: g.expiresAt,
    revokedAt: g.revokedAt,
    connectionId: g.connectionId,
    scope: g.version?.definition
      ? {
          key: g.version.definition.key,
          label: g.version.definition.label,
          description: g.version.definition.description,
          sensitive: g.version.definition.sensitive,
          fields: g.version.definition.fields,
          version: g.version.version,
        }
      : null,
    organization: g.organization
      ? { id: g.organization.id, name: g.organization.name, slug: g.organization.slug }
      : null,
  }));

  return json(paginate(items, limit));
});

const bodySchema = z
  .object({
    organizationId: z.string().regex(ULID_PATTERN, 'Not a valid business id.'),
    /** A consent definition key, e.g. `contact.basic`. */
    scope: z.string().trim().min(1).max(64),
    purpose: z.string().trim().min(1).max(200).optional(),
    expiresAt: z.string().datetime().optional(),
  })
  .strict();

export const POST = route({ bodySchema }, async (ctx) => {
  const { actor, actorRole } = await authorize({
    permission: 'self.consent:write',
    actor: ctx.actor ?? undefined,
  });

  const audit = (result: 'SUCCESS' | 'FAILED', targetId: string | null, metadata: Record<string, unknown>) =>
    recordAudit({
      action: 'self.consent.grant',
      targetType: 'consent_grant',
      targetId,
      result,
      actorUserId: actor.userId,
      actorRole,
      organizationId: ctx.body.organizationId,
      requestId: ctx.requestId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata,
    });

  // Sharing only ever happens through a live connection. The organization id arrives
  // from the client, so it is used as a filter beside the actor's own id and never as
  // an identity — and "not connected" answers exactly like "no such business", so this
  // endpoint cannot be walked to discover which organization ids exist.
  const connection = await db.query.partnerConnections.findFirst({
    where: and(
      eq(partnerConnections.userId, actor.userId),
      eq(partnerConnections.organizationId, ctx.body.organizationId),
    ),
    with: { organization: true },
  });
  if (!connection || connection.state !== 'ACTIVE') {
    await audit('FAILED', null, { reason: 'no_active_connection', scope: ctx.body.scope });
    throw notFound('Not found.');
  }

  const definition = await db.query.consentDefinitions.findFirst({
    where: eq(consentDefinitions.key, ctx.body.scope),
  });
  if (!definition) {
    await audit('FAILED', null, { reason: 'unknown_scope', scope: ctx.body.scope });
    throw unprocessable('That is not something you can share.');
  }

  const version = await db.query.consentVersions.findFirst({
    where: and(eq(consentVersions.definitionId, definition.id), isNull(consentVersions.retiredAt)),
    orderBy: [desc(consentVersions.version)],
  });
  if (!version) {
    await audit('FAILED', null, { reason: 'no_live_version', scope: ctx.body.scope });
    throw unprocessable('That permission is not available at the moment.');
  }

  // Duplicate detection is per definition, not per version: a newer wording of the
  // same scope must not quietly become a second live grant for the same data.
  const liveGrants = await db.query.consentGrants.findMany({
    where: and(
      eq(consentGrants.userId, actor.userId),
      eq(consentGrants.organizationId, ctx.body.organizationId),
      eq(consentGrants.state, 'GRANTED'),
    ),
    with: { version: true },
  });
  if (liveGrants.some((g) => g.version?.definitionId === definition.id)) {
    await audit('FAILED', null, { reason: 'already_granted', scope: definition.key });
    throw conflict('You are already sharing this with this business.');
  }

  let expiresAt: Date | null = null;
  if (ctx.body.expiresAt) {
    expiresAt = new Date(ctx.body.expiresAt);
    if (expiresAt.getTime() <= Date.now()) {
      await audit('FAILED', null, { reason: 'expiry_in_past', scope: definition.key });
      throw unprocessable('An expiry date has to be in the future.');
    }
  }

  const id = ulid();
  const grantedAt = new Date();
  const purpose = ctx.body.purpose ?? `Shared with ${connection.organization?.name ?? 'this business'}`;

  let receiptRef = '';
  await db.transaction(async (tx) => {
    await tx.insert(consentGrants).values({
      id,
      userId: actor.userId,
      organizationId: ctx.body.organizationId,
      consentVersionId: version.id,
      connectionId: connection.id,
      state: 'GRANTED',
      purpose,
      grantedAt,
      expiresAt,
    });

    /*
      The receipt, inside the same transaction.

      A grant row points at a frozen `consent_version` for its body text, but the
      label, description, field list and sensitivity it is shown with all come
      from `consent_definitions`, which is mutable — so an edit there rewrites
      what this person is told they agreed to. The receipt snapshots the wording
      now, which is the only moment it is certainly the wording they saw.
    */
    receiptRef = await recordConsentReceipt(
      {
        userId: actor.userId,
        organizationId: ctx.body.organizationId,
        organizationName: connection.organization?.name ?? null,
        consentGrantId: id,
        consentVersionId: version.id,
        action: 'GRANTED',
        scope: {
          key: definition.key,
          label: definition.label,
          description: definition.description,
          fields: definition.fields,
          sensitive: definition.sensitive,
        },
        versionNumber: version.version,
        bodyText: version.bodyText,
        purpose,
        requestId: ctx.requestId,
      },
      tx,
    );

    await emitEvent(
      {
        type: 'CONSENT_GRANTED',
        aggregateType: 'consent_grant',
        aggregateId: id,
        channel: userChannel(actor.userId),
        payload: {
          organizationId: ctx.body.organizationId,
          scope: definition.key,
          version: version.version,
          expiresAt: expiresAt?.toISOString() ?? null,
        },
      },
      tx,
    );

    // The partner's console needs to unlock the field set now, not at its next poll.
    await emitEvent(
      {
        type: 'CONSENT_GRANTED',
        aggregateType: 'consent_grant',
        aggregateId: id,
        channel: orgChannel(ctx.body.organizationId),
        payload: { connectionId: connection.id, partnerRef: connection.partnerRef, scope: definition.key },
      },
      tx,
    );

    await notify(
      {
        userId: actor.userId,
        category: 'CONSENT',
        title: `You shared “${definition.label}”`,
        body: `${connection.organization?.name ?? 'A business'} can now see this. You can withdraw it at any time.`,
        linkPath: '/profile',
      },
      tx,
    );

    await recordAudit(
      {
        action: 'self.consent.grant',
        targetType: 'consent_grant',
        targetId: id,
        result: 'SUCCESS',
        actorUserId: actor.userId,
        actorRole,
        organizationId: ctx.body.organizationId,
        requestId: ctx.requestId,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        metadata: { scope: definition.key, version: version.version, connectionId: connection.id },
      },
      tx,
    );
  });

  return json(
    {
      id,
      state: 'GRANTED',
      // The reference the person can quote. The grant's own id is internal and
      // is not something to put in an email to a shop or a regulator.
      receipt: receiptRef,
      purpose,
      grantedAt,
      expiresAt,
      connectionId: connection.id,
      scope: {
        key: definition.key,
        label: definition.label,
        description: definition.description,
        sensitive: definition.sensitive,
        fields: definition.fields,
        version: version.version,
      },
      organization: connection.organization
        ? {
            id: connection.organization.id,
            name: connection.organization.name,
            slug: connection.organization.slug,
          }
        : null,
    },
    { status: 201 },
  );
});
