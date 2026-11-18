/**
 * A partner registering an endpoint of their own.
 *
 * This is the write path the developer console has always described and never
 * had: `partner.webhook:write` existed as a permission with nothing consuming
 * it, and the deliveries table was read by a page that nothing ever wrote to.
 *
 * Two things are decided here rather than by the caller:
 *
 * **The signing secret is generated, shown once, and sealed.** A caller-supplied
 * secret would be a caller-chosen one — reused from somewhere else, or weak — and
 * it would arrive in a request body and a log. It is returned in the creation
 * response and never again; the stored copy goes through the same AES-256-GCM
 * key ring as a pass secret, so a database dump does not yield forgeable
 * signatures.
 *
 * **The URL must be public HTTPS.** A webhook target is a URL this server will
 * POST to, repeatedly, with a signature attached — which makes an unchecked one
 * a server-side request forgery primitive pointed at whatever the caller names.
 * `localhost`, private ranges and link-local addresses are refused, and so is
 * plain HTTP, because the payload describes a customer's booking.
 */
import { z } from 'zod';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { webhookDeliveries, webhooks } from '@/db/schema';
import { authorize } from '@/lib/authz/authorize';
import { route, json } from '@/lib/api';
import { recordAudit } from '@/lib/audit';
import { seal } from '@/lib/crypto';
import { ulid } from '@/lib/ids';
import { unprocessable } from '@/lib/errors';
import { EVENT_TYPES, generateWebhookSecret, assertDeliverableUrl } from '@/lib/webhooks/subscriptions';

const createSchema = z.object({
  url: z.string().url().max(2000),
  /** `*` subscribes to everything, including event types added later. */
  events: z.array(z.string().min(3).max(64)).min(1).max(40),
});

export const GET = route({ rateLimit: { name: 'api:general' } }, async (ctx) => {
  const auth = await authorize({
    permission: 'partner.webhook:read',
    organizationId: ctx.params.orgId,
    actor: ctx.actor ?? undefined,
  });

  const rows = await db
    .select({
      id: webhooks.id,
      url: webhooks.url,
      events: webhooks.events,
      active: webhooks.active,
      createdAt: webhooks.createdAt,
      // A count of what is still trying, so the console can say "3 retrying"
      // without a second round trip.
      pending: sql<number>`(
        select count(*)::int from ${webhookDeliveries}
         where ${webhookDeliveries.webhookId} = ${webhooks.id}
           and ${webhookDeliveries.deliveredAt} is null
      )`,
    })
    .from(webhooks)
    .where(eq(webhooks.organizationId, auth.organizationId!))
    .orderBy(desc(webhooks.createdAt));

  // The secret is deliberately absent from every response but the one that
  // created it.
  return json({ webhooks: rows, eventTypes: EVENT_TYPES });
});

export const POST = route(
  { bodySchema: createSchema, rateLimit: { name: 'api:general' } },
  async (ctx) => {
    const auth = await authorize({
      permission: 'partner.webhook:write',
      organizationId: ctx.params.orgId,
      actor: ctx.actor ?? undefined,
    });

    assertDeliverableUrl(ctx.body.url);

    const unknown = ctx.body.events.filter(
      (event) => event !== '*' && !EVENT_TYPES.includes(event as (typeof EVENT_TYPES)[number]),
    );
    if (unknown.length > 0) {
      // Named rather than silently dropped: a subscription to an event that will
      // never fire looks identical to one that works until the day it matters.
      throw unprocessable(`Unknown event type: ${unknown.join(', ')}.`, { unknown });
    }

    const existing = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(webhooks)
      .where(and(eq(webhooks.organizationId, auth.organizationId!), eq(webhooks.active, true)));

    if (Number(existing[0]?.n ?? 0) >= 10) {
      throw unprocessable('That organization already has ten active endpoints.');
    }

    const secret = generateWebhookSecret();
    const id = ulid();

    await db.insert(webhooks).values({
      id,
      organizationId: auth.organizationId!,
      url: ctx.body.url,
      events: ctx.body.events,
      secretCipher: seal(secret),
      active: true,
    });

    await recordAudit({
      actorUserId: auth.actor.userId,
      organizationId: auth.organizationId!,
      action: 'webhook.created',
      targetType: 'webhook',
      targetId: id,
      result: 'SUCCESS',
      // The URL is the merchant's own and belongs in their audit trail. The
      // secret does not go anywhere near it.
      metadata: { url: ctx.body.url, events: ctx.body.events },
    });

    return json(
      {
        id,
        url: ctx.body.url,
        events: ctx.body.events,
        active: true,
        /**
         * The only time this is ever returned. Verify with HMAC-SHA256 over
         * `${x-onepass-timestamp}.${rawBody}` and compare against
         * `x-onepass-signature` in constant time.
         */
        secret,
        secretNotice: 'Store this now — it is not shown again and cannot be recovered.',
      },
      { status: 201 },
    );
  },
);
