/**
 * Verify a pass presented at this organization's counter.
 *
 * The door already had a screen for admitting tickets; nothing had one for the
 * other half of a counter's job — establishing *who* is standing there so a sale
 * can be written against them. `verifyPresentation` has always been able to
 * answer that and has never been reachable over HTTP, which meant a till could
 * not ask.
 *
 * A rejection is a 200 with `ok: false`, not an error status. That is deliberate:
 * "this code expired" is a verdict the counter renders, not a fault the caller
 * made, and an HTTP error would push it into a catch block where a till would
 * render it as a network problem. The distinction matters at a queue.
 *
 * Every rejection reads the same from outside except for the reason the holder
 * needs — the wording comes from the service so that a counter cannot be used to
 * probe which passes exist. It returns a `presentationId`, never a user id: the
 * sale that follows cites the presentation, so the buyer's platform identity
 * never reaches a browser.
 */
import { z } from 'zod';
import { route, json } from '@/lib/api';
import { authorize } from '@/lib/authz/authorize';
import { recordAudit } from '@/lib/audit';
import { unprocessable } from '@/lib/errors';
import { verifyAtCounter, venueBelongsTo } from '@/lib/commerce/counter';

const bodySchema = z
  .object({
    /** `OP1|<passRef>|<code>|<counter>` — the whole envelope, as scanned. */
    token: z.string().min(8).max(200),
    /** The till's own venue, when the terminal knows which one it is. */
    venueId: z.string().length(26).nullable().optional(),
  })
  .strict();

export const POST = route(
  {
    bodySchema,
    rateLimit: {
      name: 'partner:counter-verify',
      subject: (ctx) => ctx.actor?.userId ?? ctx.ip ?? 'anonymous',
    },
  },
  async (ctx) => {
    const { actor, actorRole, organizationId } = await authorize({
      permission: 'partner.pass:verify',
      organizationId: ctx.params.orgId,
      actor: ctx.actor ?? undefined,
    });

    // A venue id arrives from outside, so it is checked against the tenant the
    // guard resolved rather than trusted. Recording a presentation at a shop the
    // organization does not own would corrupt every per-venue figure downstream.
    if (ctx.body.venueId && !(await venueBelongsTo(ctx.body.venueId, organizationId!))) {
      throw unprocessable('That venue does not belong to this organization.');
    }

    const outcome = await verifyAtCounter({
      token: ctx.body.token,
      organizationId: organizationId!,
      staffUserId: actor.userId,
      venueId: ctx.body.venueId ?? null,
      requestId: ctx.requestId,
      ip: ctx.ip,
    });

    await recordAudit({
      action: 'partner.counter.verify',
      targetType: 'pass_presentation',
      // A refused presentation may have no row at all — a malformed code never
      // reaches the database — so the target is the presentation when there is
      // one and nothing when there is not. It is never the token.
      targetId: outcome.ok ? outcome.presentationId : null,
      organizationId: organizationId!,
      result: outcome.ok ? 'SUCCESS' : 'FAILED',
      actorUserId: actor.userId,
      actorRole,
      requestId: ctx.requestId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: outcome.ok ? {} : { reason: outcome.result },
    });

    if (!outcome.ok) {
      return json({
        ok: false as const,
        result: outcome.result,
        message: outcome.message,
        checks: outcome.checks,
      });
    }

    return json({
      ok: true as const,
      presentationId: outcome.presentationId,
      buyer: outcome.buyer,
      checks: outcome.checks,
    });
  },
);
