/**
 * Your consent history: what you agreed to, in the words you agreed to.
 *
 * Separate from `/api/me/consents`, which reports the *current* state of each
 * grant. This reports the acts — every agreement and every withdrawal, each with
 * the scope's wording snapshotted at that moment, because the definition those
 * words live on is editable and a record the other party can revise is not
 * evidence of anything.
 *
 * `self.consent:read`, and the read is filtered by the caller's own id inside
 * the service, so there is no shape of this request that returns anybody else's.
 */
import { z } from 'zod';
import { json, route } from '@/lib/api';
import { authorize } from '@/lib/authz/authorize';
import { listConsentReceipts } from '@/lib/privacy/consent-receipts';
import { ULID_PATTERN } from '@/lib/ids';

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().regex(ULID_PATTERN).optional(),
});

export const GET = route({ querySchema, rateLimit: { name: 'api:general' } }, async (ctx) => {
  const { actor } = await authorize({ permission: 'self.consent:read', actor: ctx.actor ?? undefined });

  const items = await listConsentReceipts({
    userId: actor.userId,
    ...(ctx.query.limit === undefined ? {} : { limit: ctx.query.limit }),
    ...(ctx.query.cursor === undefined ? {} : { cursor: ctx.query.cursor }),
  });

  return json({
    items: items.map((item) => ({
      reference: item.reference,
      action: item.action,
      at: item.at.toISOString(),
      organizationName: item.organizationName,
      scope: item.scope,
      versionNumber: item.versionNumber,
      purpose: item.purpose,
    })),
  });
});
