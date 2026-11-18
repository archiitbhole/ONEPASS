/**
 * Revoking a key.
 *
 * Revoked, not deleted. A key that was used to issue credentials is part of the
 * explanation for how those credentials came to exist, and deleting the row
 * would remove the only thing that connects them to a caller. `revoked_at` stops
 * it working immediately and keeps the history.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/db/client';
import { apiKeys } from '@/db/schema';
import { authorize } from '@/lib/authz/authorize';
import { route, json } from '@/lib/api';
import { recordAudit } from '@/lib/audit';
import { notFound } from '@/lib/errors';

export const DELETE = route({ rateLimit: { name: 'api:general' } }, async (ctx) => {
  const auth = await authorize({
    permission: 'partner.apikey:write',
    organizationId: ctx.params.orgId,
    actor: ctx.actor ?? undefined,
  });

  // The organization is in the WHERE clause, not checked afterwards, so a key id
  // belonging to another tenant is a 404 rather than a successful revocation.
  const [revoked] = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(apiKeys.id, ctx.params.keyId!),
        eq(apiKeys.organizationId, auth.organizationId!),
        isNull(apiKeys.revokedAt),
      ),
    )
    .returning({ id: apiKeys.id, prefix: apiKeys.prefix, label: apiKeys.label });

  // Already revoked reads the same as never existed, deliberately: neither
  // answer should tell a caller anything about another organization's keys.
  if (!revoked) throw notFound('That key could not be found.');

  await recordAudit({
    actorUserId: auth.actor.userId,
    organizationId: auth.organizationId!,
    action: 'apikey.revoked',
    targetType: 'api_key',
    targetId: revoked.id,
    result: 'SUCCESS',
    metadata: { label: revoked.label, prefix: revoked.prefix },
  });

  return json({ id: revoked.id, prefix: revoked.prefix, revoked: true });
});
