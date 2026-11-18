/**
 * Declare a signing key compromised.
 *
 * Every credential that key signed stops verifying, immediately and for good.
 * That is the correct response to a leaked key — an attacker holding it can
 * produce credentials indistinguishable from real ones — and it is also the
 * most consequential single action a partner can take, which is why it is
 * owner-only, elevated, rate-limited, audited, and raised on the platform's
 * security queue.
 *
 * If the revoked key was the active one, a replacement is created in the same
 * transaction; the organization is never left unable to issue.
 */
import { z } from 'zod';
import { json, route } from '@/lib/api';
import { authorize } from '@/lib/authz/authorize';
import { revokeIssuerKey } from '@/lib/credentials/keys';
import { notFound } from '@/lib/errors';

const bodySchema = z
  .object({
    reason: z.string().trim().min(3, 'Say why this key is being revoked.').max(240),
  })
  .strict();

export const POST = route({ bodySchema, rateLimit: { name: 'partner:signing-key', subject: (ctx) => `org:${ctx.params.orgId}` } }, async (ctx) => {
  const auth = await authorize({
    permission: 'partner.signing-key:manage',
    organizationId: ctx.params.orgId,
    actor: ctx.actor ?? undefined,
  });

  const keyId = ctx.params.keyId ?? '';
  if (!/^v\d{1,6}$/.test(keyId)) throw notFound('Not found.');

  const result = await revokeIssuerKey({
    organizationId: ctx.params.orgId!,
    keyId,
    reason: ctx.body.reason,
    byUserId: auth.actor.userId,
    requestId: ctx.requestId,
    ip: ctx.ip,
  });
  return json({ status: 'revoked', ...result });
});
