/**
 * Issuing credentials, and listing what this organization has issued.
 *
 * The tenant id used for every query comes from `authorize()`, not from the path,
 * so a member of another organization cannot reach these rows even by guessing.
 */
import { z } from 'zod';
import { and, desc, eq, lt } from 'drizzle-orm';
import { db } from '@/db/client';
import { credentials, credentialTypes } from '@/db/schema';
import { authorize } from '@/lib/authz/authorize';
import { route, json, paginate } from '@/lib/api';
import { recordAudit } from '@/lib/audit';
import { issueCredential } from '@/lib/credentials/service';

const claimValue = z.union([z.string().max(500), z.number(), z.boolean(), z.null()]);

const issueSchema = z.object({
  credentialTypeId: z.string().length(26),
  holderUserId: z.string().length(26).nullable().optional(),
  holderExternalRef: z.string().max(120).nullable().optional(),
  holderName: z.string().min(1).max(160),
  claims: z.record(claimValue).default({}),
  validFrom: z.coerce.date().optional(),
  validUntil: z.coerce.date().nullable().optional(),
});

const listSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().length(26).optional(),
  typeId: z.string().length(26).optional(),
});

export const GET = route(
  { querySchema: listSchema, rateLimit: { name: 'api:general' } },
  async (ctx) => {
    const auth = await authorize({
      permission: 'partner.credential:read',
      organizationId: ctx.params.orgId,
      actor: ctx.actor ?? undefined,
    });
    const q = ctx.query;

    const where = [eq(credentials.organizationId, auth.organizationId!)];
    if (q.cursor) where.push(lt(credentials.id, q.cursor));
    if (q.typeId) where.push(eq(credentials.credentialTypeId, q.typeId));

    const rows = await db
      .select({
        id: credentials.id,
        publicRef: credentials.publicRef,
        status: credentials.status,
        holderName: credentials.holderNameSnapshot,
        holderExternalRef: credentials.holderExternalRef,
        typeName: credentialTypes.name,
        typeKey: credentialTypes.key,
        issuedAt: credentials.issuedAt,
        validUntil: credentials.validUntil,
        verificationCount: credentials.verificationCount,
      })
      .from(credentials)
      .innerJoin(credentialTypes, eq(credentialTypes.id, credentials.credentialTypeId))
      .where(and(...where))
      .orderBy(desc(credentials.id))
      .limit(q.limit + 1);

    const page = paginate(rows, q.limit);
    return json({
      items: page.items.map((r) => ({
        ...r,
        issuedAt: r.issuedAt.toISOString(),
        validUntil: r.validUntil?.toISOString() ?? null,
      })),
      nextCursor: page.nextCursor,
    });
  },
);

export const POST = route({ bodySchema: issueSchema, rateLimit: { name: 'api:general' } }, async (ctx) => {
  const auth = await authorize({
    permission: 'partner.credential:issue',
    organizationId: ctx.params.orgId,
    actor: ctx.actor ?? undefined,
  });
  const body = ctx.body;

  const issued = await issueCredential({
    organizationId: auth.organizationId!,
    credentialTypeId: body.credentialTypeId,
    holderUserId: body.holderUserId ?? null,
    holderExternalRef: body.holderExternalRef ?? null,
    holderName: body.holderName,
    claims: body.claims,
    validFrom: body.validFrom,
    validUntil: body.validUntil,
    issuedByUserId: auth.actor.userId,
  });

  await recordAudit({
    action: 'credential.issue',
    targetType: 'credential',
    targetId: issued.id,
    result: 'SUCCESS',
    actorUserId: auth.actor.userId,
    actorRole: auth.actorRole,
    organizationId: auth.organizationId,
    requestId: ctx.requestId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    // The claims themselves are not audited: they are the credential's content,
    // already stored and signed, and duplicating them here doubles the exposure.
    metadata: { publicRef: issued.publicRef, typeId: body.credentialTypeId },
  });

  return json(issued, { status: 201 });
});
