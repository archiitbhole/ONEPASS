/**
 * The organization's signing keys, and rotating them.
 *
 * Listing is open to anyone who can see the credentials the organization issues.
 * Rotating is owner-only and needs a recent re-authentication
 * (`partner.signing-key:manage` is in REQUIRES_ELEVATION): it is harmless to the
 * credentials already issued — a retired key still verifies what it signed —
 * but it changes what every new credential is signed with, which is not a thing
 * an unattended session should be able to do.
 */
import { z } from 'zod';
import { json, route } from '@/lib/api';
import { authorize } from '@/lib/authz/authorize';
import { publishedKeys, rotateIssuerKey } from '@/lib/credentials/keys';

export const GET = route({ rateLimit: { name: 'api:general' } }, async (ctx) => {
  await authorize({
    permission: 'partner.credential:read',
    organizationId: ctx.params.orgId,
    actor: ctx.actor ?? undefined,
  });
  return json({ keys: await publishedKeys(ctx.params.orgId!) });
});

/** Strict and empty: the only thing a rotation needs is the decision to do it. */
const bodySchema = z.object({}).strict();

export const POST = route({ bodySchema, rateLimit: { name: 'partner:signing-key', subject: (ctx) => `org:${ctx.params.orgId}` } }, async (ctx) => {
  const auth = await authorize({
    permission: 'partner.signing-key:manage',
    organizationId: ctx.params.orgId,
    actor: ctx.actor ?? undefined,
  });

  const result = await rotateIssuerKey({
    organizationId: ctx.params.orgId!,
    byUserId: auth.actor.userId,
    requestId: ctx.requestId,
    ip: ctx.ip,
  });
  return json({ status: 'rotated', ...result });
});
