/**
 * Revocation. Permanent, and gated behind a fresh re-authentication — a stolen
 * session should not be able to invalidate a graduating class's degrees.
 */
import { z } from 'zod';
import { route, json } from '@/lib/api';
import { authorize } from '@/lib/authz/authorize';
import { recordAudit, recordSecurityEvent } from '@/lib/audit';
import { revokeCredential } from '@/lib/credentials/service';

const schema = z.object({
  reason: z.enum(['ISSUER_ERROR', 'HOLDER_REQUEST', 'RELATIONSHIP_ENDED', 'SUPERSEDED', 'FRAUD', 'EXPIRED_EARLY']),
  note: z.string().max(240).optional(),
});

export const POST = route({ bodySchema: schema, rateLimit: { name: 'api:general' } }, async (ctx) => {
  const auth = await authorize({
    permission: 'partner.credential:revoke',
    organizationId: ctx.params.orgId,
    actor: ctx.actor ?? undefined,
  });

  const { revokedAt } = await revokeCredential({
    credentialId: ctx.params.credentialId!,
    organizationId: auth.organizationId!,
    reason: ctx.body.reason,
    note: ctx.body.note ?? null,
    revokedByUserId: auth.actor.userId,
  });

  await recordAudit({
    action: 'credential.revoke',
    targetType: 'credential',
    targetId: ctx.params.credentialId!,
    result: 'SUCCESS',
    actorUserId: auth.actor.userId,
    actorRole: auth.actorRole,
    organizationId: auth.organizationId,
    requestId: ctx.requestId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    metadata: { reason: ctx.body.reason },
  });

  // Revocation for fraud is worth a security officer's attention, not just an
  // audit line nobody reads.
  if (ctx.body.reason === 'FRAUD') {
    await recordSecurityEvent({
      kind: 'CREDENTIAL_REVOKED_FRAUD',
      severity: 'MEDIUM',
      summary: 'A credential was revoked for suspected fraud',
      organizationId: auth.organizationId,
      userId: auth.actor.userId,
      requestId: ctx.requestId,
      ip: ctx.ip,
      metadata: { credentialId: ctx.params.credentialId },
    });
  }

  return json({ status: 'REVOKED', revokedAt: revokedAt.toISOString() });
});
