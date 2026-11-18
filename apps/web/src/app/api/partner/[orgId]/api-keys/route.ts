/**
 * API keys, for a partner's own server calling ONEPASS.
 *
 * The developer console has told partners a key "is created through the partner
 * API" since it was written, and nothing anywhere inserted one — `insert(apiKeys)`
 * had no call sites, so the only keys that could exist came from a seed.
 *
 * Shape follows the same rules as every other credential here:
 *
 * · **Shown once.** The response to the create call is the only time the full key
 *   exists outside the caller's hands. What is stored is a SHA-256 of it, so the
 *   database cannot hand anyone a working key, and neither can a backup.
 * · **A greppable prefix.** `op_live_<8>` is stored in the clear and is what
 *   appears in the console and in logs, so a key can be identified and revoked
 *   without ever needing the secret half.
 * · **Scopes are checked against the caller's own.** A member cannot mint a key
 *   more capable than they are; that is privilege escalation with an audit trail
 *   that looks legitimate.
 */
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { apiKeys } from '@/db/schema';
import { authorize } from '@/lib/authz/authorize';
import { route, json } from '@/lib/api';
import { recordAudit } from '@/lib/audit';
import { ulid } from '@/lib/ids';
import { forbidden, unprocessable } from '@/lib/errors';
import { permissionsForRoles } from '@/lib/authz/permissions';

/**
 * What a machine caller may be granted.
 *
 * A deliberate subset of the partner permission set, not all of it. Managing
 * teammates, changing roles, refunding a payment and retiring a credential type
 * are all absent: they are decisions a person takes with a session behind them,
 * and a long-lived key sitting in someone's CI configuration is the wrong thing
 * to be able to take them with. Issuing and verifying — what an integration
 * actually needs to do all day — are here.
 */
const GRANTABLE_SCOPES = [
  'partner.credential:read',
  'partner.credential:issue',
  'partner.credential:revoke',
  'partner.credential-type:read',
  'partner.pass:verify',
  'partner.analytics:read',
  'partner.transaction:read',
  'partner.verification:read',
] as const;

const createSchema = z.object({
  label: z.string().min(1).max(80),
  scopes: z.array(z.enum(GRANTABLE_SCOPES)).min(1).max(GRANTABLE_SCOPES.length),
  /** Optional expiry. A key with an end date is a key somebody has thought about. */
  expiresAt: z.coerce.date().optional(),
});

const KEY_PREFIX = 'op_live_';

export const GET = route({ rateLimit: { name: 'api:general' } }, async (ctx) => {
  const auth = await authorize({
    permission: 'partner.apikey:read',
    organizationId: ctx.params.orgId,
    actor: ctx.actor ?? undefined,
  });

  const rows = await db
    .select({
      id: apiKeys.id,
      label: apiKeys.label,
      prefix: apiKeys.prefix,
      scopes: apiKeys.scopes,
      createdAt: apiKeys.createdAt,
      lastUsedAt: apiKeys.lastUsedAt,
      expiresAt: apiKeys.expiresAt,
      revokedAt: apiKeys.revokedAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.organizationId, auth.organizationId!))
    .orderBy(desc(apiKeys.createdAt));

  // `keyHash` is not selected. There is no operation on this platform that needs
  // to return it, and a hash that never leaves the database cannot be attacked
  // offline.
  return json({ keys: rows, grantableScopes: GRANTABLE_SCOPES });
});

export const POST = route(
  { bodySchema: createSchema, rateLimit: { name: 'api:general' } },
  async (ctx) => {
    const auth = await authorize({
      permission: 'partner.apikey:write',
      organizationId: ctx.params.orgId,
      actor: ctx.actor ?? undefined,
    });

    // No minting yourself something you cannot do. The caller's own permissions
    // are recomputed from their roles on this membership rather than read from
    // anything the request carried — the same function every other authorisation
    // decision uses, so a key can never out-rank the person who created it.
    const mine = permissionsForRoles(auth.membership?.roles ?? []);
    const beyond = ctx.body.scopes.filter((scope) => !mine.has(scope));
    if (beyond.length > 0) {
      throw forbidden(`You cannot grant a key permissions you do not have: ${beyond.join(', ')}.`);
    }

    if (ctx.body.expiresAt && ctx.body.expiresAt.getTime() <= Date.now()) {
      throw unprocessable('An expiry has to be in the future.');
    }

    const live = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(apiKeys)
      .where(and(eq(apiKeys.organizationId, auth.organizationId!), isNull(apiKeys.revokedAt)));

    if (Number(live[0]?.n ?? 0) >= 20) {
      throw unprocessable('That organization already has twenty live keys. Revoke one first.');
    }

    // 32 bytes of entropy after the prefix.
    const secret = randomBytes(32).toString('base64url');
    const key = `${KEY_PREFIX}${secret}`;
    const prefix = `${KEY_PREFIX}${secret.slice(0, 8)}`;
    const keyHash = createHash('sha256').update(key).digest();

    const id = ulid();
    await db.insert(apiKeys).values({
      id,
      organizationId: auth.organizationId!,
      label: ctx.body.label,
      prefix,
      keyHash,
      scopes: ctx.body.scopes,
      createdByUserId: auth.actor.userId,
      expiresAt: ctx.body.expiresAt ?? null,
    });

    await recordAudit({
      actorUserId: auth.actor.userId,
      organizationId: auth.organizationId!,
      action: 'apikey.created',
      targetType: 'api_key',
      targetId: id,
      result: 'SUCCESS',
      // The prefix, never the key. This is exactly what the prefix is for.
      metadata: { label: ctx.body.label, prefix, scopes: ctx.body.scopes },
    });

    return json(
      {
        id,
        label: ctx.body.label,
        prefix,
        scopes: ctx.body.scopes,
        expiresAt: ctx.body.expiresAt ?? null,
        key,
        keyNotice: 'Store this now — only a hash is kept, so it cannot be shown or recovered again.',
      },
      { status: 201 },
    );
  },
);
