/**
 * The public verification endpoint — the one call the whole product exists for.
 *
 * Deliberately open. An employer checking a degree has no ONEPASS account and
 * should not need one; requiring a login here would make the credential useless
 * to the only person who needs to trust it. What protects it instead:
 *  · a hard rate limit per IP, because enumeration is the real risk;
 *  · references that are random rather than sequential, so there is nothing to
 *    walk even at full rate;
 *  · a response that discloses only what the credential asserts.
 *
 * An API key is optional and only changes attribution — a verification made
 * with one is recorded against that organization, which is what powers the
 * issuer's "who is checking these?" view and later, usage billing.
 */
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { apiKeys } from '@/db/schema';
import { recordApiUsage } from '@/lib/api-usage';
import { route, json } from '@/lib/api';
import { digest } from '@/lib/crypto';
import { verifyCredential } from '@/lib/credentials/service';

const schema = z.object({
  reference: z.string().min(4).max(64),
});

/** Resolve an optional `Authorization: Bearer op_live_...` to an API key row. */
async function resolveApiKey(header: string | null) {
  if (!header?.startsWith('Bearer ')) return null;
  const presented = header.slice(7).trim();
  if (presented.length < 20 || presented.length > 200) return null;

  const row = await db.query.apiKeys.findFirst({ where: eq(apiKeys.keyHash, digest(presented)) });
  if (!row || row.revokedAt) return null;
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return null;

  await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.id));
  return row;
}

export const POST = route(
  { bodySchema: schema, csrf: false, rateLimit: { name: 'pass:verify' } },
  async (ctx) => {
    const startedAt = Date.now();
    const key = await resolveApiKey(ctx.req.headers.get('authorization'));

    const result = await verifyCredential({
      presentedRef: ctx.body.reference,
      channel: key ? 'api' : 'public',
      verifierOrganizationId: key?.organizationId ?? null,
      verifierUserId: ctx.actor?.userId ?? null,
      apiKeyId: key?.id ?? null,
      requestId: ctx.requestId,
      ip: ctx.ip,
    });

    // Metered only when a key authenticated the call — `api_usage.api_key_id`
    // is not nullable, and an anonymous public verification belongs to nobody's
    // quota. Awaited rather than left dangling: a floating promise may never run
    // once the request scope ends, and `recordApiUsage` swallows its own
    // failures, so awaiting it cannot fail this call.
    if (key) {
      await recordApiUsage({
        apiKeyId: key.id,
        organizationId: key.organizationId,
        // The route pattern, not the URL. Bucketing by URL would give every
        // credential ever checked a row of its own.
        endpoint: 'POST /api/v1/verify',
        // A resolved verdict is a successful call whatever it says — REVOKED is
        // an answer, not an error.
        failed: false,
        durationMs: Date.now() - startedAt,
      });
    }

    // 200 for every resolved verdict, including REVOKED and NOT_FOUND: the call
    // succeeded, and the answer is the point. Only a broken request is a 4xx.
    return json(result);
  },
);
