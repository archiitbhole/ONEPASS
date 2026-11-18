/**
 * Send a given-up webhook delivery again.
 *
 * A partner whose endpoint was down for an afternoon has events the platform
 * stopped trying to deliver and no way to ask for them: the outbox is the
 * platform's record, not a queue they can drain. This is that ask.
 *
 * It queues; it does not send. The delivery is marked due and the existing
 * drain picks it up with everything else, which keeps one code path responsible
 * for signing, timeouts, backoff and the claim that stops two instances sending
 * the same row twice. A route that sent inline would be a second delivery path
 * with its own version of all four.
 *
 * The rule itself is `requeueDelivery` in `lib/webhooks/dispatch.ts`, so it can
 * be tested without a request and cannot drift from the drain it feeds.
 */
import { z } from 'zod';
import { route, json } from '@/lib/api';
import { authorize } from '@/lib/authz/authorize';
import { recordAudit } from '@/lib/audit';
import { conflict, notFound } from '@/lib/errors';
import { requeueDelivery, type RequeueRefusal } from '@/lib/webhooks/dispatch';

/** Nothing to send. Strict, so a stray field is a 422 rather than a silent no-op. */
const bodySchema = z.object({}).strict();

/** What each refusal means to the person who pressed the button. */
const REFUSAL: Record<Exclude<RequeueRefusal, 'NOT_FOUND'>, string> = {
  ALREADY_DELIVERED:
    'This one reached your endpoint. Sending it again would be a duplicate the platform chose to make, which is a different thing from one your handler has to survive.',
  STILL_TRYING:
    'This delivery has attempts left and is already scheduled. It will be sent on its own backoff, which exists to give your endpoint room to recover.',
  SUBSCRIPTION_INACTIVE:
    'This subscription is inactive, so nothing is being sent to it. Reactivate it first.',
};

export const POST = route(
  {
    bodySchema,
    rateLimit: {
      name: 'partner:webhook-redeliver',
      subject: (ctx) => ctx.actor?.userId ?? ctx.ip ?? 'anonymous',
    },
  },
  async (ctx) => {
    const { actor, actorRole } = await authorize({
      // `write`, not `read`: this makes the platform send a request to somebody
      // else's server, which is not something a reader should be able to cause.
      permission: 'partner.webhook:write',
      organizationId: ctx.params.orgId,
      actor: ctx.actor ?? undefined,
    });

    // `!` on the dynamic segments: Next guarantees them for a matched route,
    // and `noUncheckedIndexedAccess` does not know that.
    const deliveryId = ctx.params.deliveryId!;
    const result = await requeueDelivery({ deliveryId, organizationId: ctx.params.orgId! });

    if (!result.requeued) {
      await recordAudit({
        action: 'partner.webhook.redeliver',
        targetType: 'webhook_delivery',
        targetId: deliveryId,
        organizationId: ctx.params.orgId!,
        result: 'FAILED',
        actorUserId: actor.userId,
        actorRole,
        requestId: ctx.requestId,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        metadata: { reason: result.reason },
      });

      // A delivery belonging to another organization is not found, not refused —
      // a refusal would confirm the id exists.
      if (result.reason === 'NOT_FOUND') throw notFound('That delivery does not exist.');
      throw conflict(REFUSAL[result.reason!]);
    }

    await recordAudit({
      action: 'partner.webhook.redeliver',
      targetType: 'webhook_delivery',
      targetId: deliveryId,
      organizationId: ctx.params.orgId!,
      result: 'SUCCESS',
      actorUserId: actor.userId,
      actorRole,
      requestId: ctx.requestId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      // The attempt counter resets so the drain will pick the row up; the count
      // it had is kept here, because that history is worth more than the column.
      metadata: { previousAttempts: result.previousAttempts, webhookId: ctx.params.webhookId },
    });

    return json({ status: 'queued', previousAttempts: result.previousAttempts }, { status: 202 });
  },
);
