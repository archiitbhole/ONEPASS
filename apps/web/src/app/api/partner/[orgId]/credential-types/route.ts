/**
 * Credential types — the templates an organization issues against.
 *
 * Defining a type is an owner-level act because the claim schema is a promise to
 * every future verifier about what this kind of credential can assert.
 */
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { credentialTypes } from '@/db/schema';
import { authorize } from '@/lib/authz/authorize';
import { route, json } from '@/lib/api';
import { recordAudit } from '@/lib/audit';
import { conflict } from '@/lib/errors';
import { ulid } from '@/lib/ids';

const createSchema = z.object({
  key: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9._-]*$/, 'Use lowercase letters, digits, dots, dashes or underscores.'),
  name: z.string().min(2).max(120),
  category: z.enum(['IDENTITY', 'QUALIFICATION', 'MEMBERSHIP', 'AUTHORIZATION', 'EVENT', 'EXPERIENCE']),
  description: z.string().max(1000).optional(),
  claimSchema: z.array(z.string().min(1).max(64)).min(1).max(40),
  defaultValidityDays: z.number().int().min(1).max(36500).nullable().optional(),
  discloseHolderName: z.boolean().default(true),
});

export const GET = route({ rateLimit: { name: 'api:general' } }, async (ctx) => {
  const auth = await authorize({
    permission: 'partner.credential-type:read',
    organizationId: ctx.params.orgId,
    actor: ctx.actor ?? undefined,
  });

  const rows = await db
    .select()
    .from(credentialTypes)
    .where(eq(credentialTypes.organizationId, auth.organizationId!))
    .orderBy(desc(credentialTypes.createdAt))
    .limit(100);

  return json({
    items: rows.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      category: r.category,
      description: r.description,
      claimSchema: r.claimSchema,
      defaultValidityDays: r.defaultValidityDays,
      discloseHolderName: r.discloseHolderName,
      active: r.active,
      createdAt: r.createdAt.toISOString(),
    })),
  });
});

export const POST = route({ bodySchema: createSchema, rateLimit: { name: 'api:general' } }, async (ctx) => {
  const auth = await authorize({
    permission: 'partner.credential-type:write',
    organizationId: ctx.params.orgId,
    actor: ctx.actor ?? undefined,
  });
  const body = ctx.body;

  const existing = await db.query.credentialTypes.findFirst({
    where: and(
      eq(credentialTypes.organizationId, auth.organizationId!),
      eq(credentialTypes.key, body.key),
    ),
  });
  if (existing) throw conflict('A credential type with that key already exists.');

  const id = ulid();
  await db.insert(credentialTypes).values({
    id,
    organizationId: auth.organizationId!,
    key: body.key,
    name: body.name,
    category: body.category,
    description: body.description ?? null,
    claimSchema: body.claimSchema,
    defaultValidityDays: body.defaultValidityDays ?? null,
    discloseHolderName: body.discloseHolderName,
  });

  await recordAudit({
    action: 'credential_type.create',
    targetType: 'credential_type',
    targetId: id,
    result: 'SUCCESS',
    actorUserId: auth.actor.userId,
    actorRole: auth.actorRole,
    organizationId: auth.organizationId,
    requestId: ctx.requestId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    metadata: { key: body.key, category: body.category },
  });

  return json({ id, key: body.key }, { status: 201 });
});
