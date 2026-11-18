/**
 * Issue a receipt for a sale made across a counter.
 *
 * Before this existed, a purchase made inside the app produced a receipt, a
 * warranty and an owned product, and the identical purchase made two metres away
 * at the till produced a paper slip the platform never heard about. The buyer of
 * the paper slip had no warranty to claim against and no product to transfer.
 *
 * The money does not move here. It moved at the till, through whatever the shop
 * uses — card machine, UPI, cash — and this records what was sold and to whom.
 * `paymentLabel` is therefore a label and nothing more: the platform did not
 * observe the payment and does not claim to have. Saying otherwise would be a
 * payment the product asserts and cannot evidence.
 *
 * Who the sale belongs to comes from a pass presentation, never from the body.
 * A caller cannot name a user id; it cites the presentation that proved the
 * holder was at the counter, and the person is resolved from that inside
 * `lib/commerce/counter.ts`. So a receipt cannot be written onto an account that
 * did not stand there.
 *
 * The totals are not the caller's either. `issueReceipt` computes subtotal,
 * discount apportionment, tax and total from the lines, and refuses the whole
 * receipt if a supplied `totalMinor` disagrees — which is how a POS bridge finds
 * out its arithmetic drifted rather than quietly writing a wrong figure.
 */
import { z } from 'zod';
import { route, json } from '@/lib/api';
import { authorize } from '@/lib/authz/authorize';
import { recordAudit } from '@/lib/audit';
import { conflict, unprocessable } from '@/lib/errors';
import { issueReceipt } from '@/lib/commerce/receipts';
import {
  COUNTER_WINDOW_MINUTES,
  resolveCounterBuyer,
  venueBelongsTo,
  type CounterRefusal,
} from '@/lib/commerce/counter';

const lineSchema = z.object({
  description: z.string().min(1).max(200),
  sku: z.string().max(80).nullable().optional(),
  quantity: z.number().int().min(1).max(10_000),
  /** Whole paise. A rupee figure with a decimal point is the classic rounding bug. */
  unitPriceMinor: z.number().int().min(0).max(100_000_000),
  /** Basis points: 1800 is 18% GST. */
  taxRateBp: z.number().int().min(0).max(10_000),
  warrantyMonths: z.number().int().min(0).max(240).nullable().optional(),
  serialNumber: z.string().max(120).nullable().optional(),
  isReturnable: z.boolean().optional(),
  warrantyTransferable: z.boolean().optional(),
});

const bodySchema = z
  .object({
    /** From `POST /api/partner/{orgId}/pass/verify`. The buyer is resolved from it. */
    presentationId: z.string().length(26),
    venueId: z.string().length(26).nullable().optional(),
    merchantReceiptNo: z.string().max(80).nullable().optional(),
    /** What the customer paid with, as the till describes it. Not a payment record. */
    paymentLabel: z.string().max(80).nullable().optional(),
    gstin: z.string().max(20).nullable().optional(),
    discountMinor: z.number().int().min(0).max(100_000_000).optional(),
    returnWindowDays: z.number().int().min(0).max(3650),
    returnPolicyNote: z.string().max(500).nullable().optional(),
    /** Optional cross-check. Refused on mismatch; never stored. */
    totalMinor: z.number().int().min(0).optional(),
    lines: z.array(lineSchema).min(1).max(100),
  })
  .strict();

/** What each refusal means to the person at the till. */
const REFUSAL: Record<CounterRefusal, string> = {
  PRESENTATION_NOT_FOUND:
    'That scan is not one of this organization’s. Ask the customer to show their pass again.',
  PRESENTATION_EXPIRED: `That scan is more than ${COUNTER_WINDOW_MINUTES} minutes old. Ask the customer to show their pass again — a receipt is written against someone who is standing there.`,
};

export const POST = route(
  {
    bodySchema,
    rateLimit: {
      name: 'partner:receipt-issue',
      subject: (ctx) => ctx.actor?.userId ?? ctx.ip ?? 'anonymous',
    },
  },
  async (ctx) => {
    const { actor, actorRole, organizationId } = await authorize({
      // The same permission the counter already needs to take money. Issuing the
      // record of a sale is the counter's job, not an administrator's.
      permission: 'partner.transaction:create',
      organizationId: ctx.params.orgId,
      actor: ctx.actor ?? undefined,
    });
    const orgId = organizationId!;

    if (ctx.body.venueId && !(await venueBelongsTo(ctx.body.venueId, orgId))) {
      throw unprocessable('That venue does not belong to this organization.');
    }

    const buyer = await resolveCounterBuyer({ presentationId: ctx.body.presentationId, organizationId: orgId });
    if (!buyer.ok) {
      await recordAudit({
        action: 'partner.receipt.issue',
        targetType: 'receipt',
        organizationId: orgId,
        result: 'FAILED',
        actorUserId: actor.userId,
        actorRole,
        requestId: ctx.requestId,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        metadata: { reason: buyer.reason, presentationId: ctx.body.presentationId },
      });
      throw conflict(REFUSAL[buyer.reason]);
    }

    const issued = await issueReceipt({
      userId: buyer.userId,
      organizationId: orgId,
      venueId: ctx.body.venueId ?? null,
      merchantReceiptNo: ctx.body.merchantReceiptNo ?? null,
      // The shop, in person. Not ONLINE, which would misdescribe where this
      // happened, and not IMPORTED, which is for a back-fill of sales the
      // platform was not present for.
      channel: 'IN_STORE',
      lines: ctx.body.lines.map((line) => ({
        description: line.description,
        sku: line.sku ?? null,
        quantity: line.quantity,
        unitPriceMinor: line.unitPriceMinor,
        taxRateBp: line.taxRateBp,
        warrantyMonths: line.warrantyMonths ?? null,
        serialNumber: line.serialNumber ?? null,
        ...(line.isReturnable === undefined ? {} : { isReturnable: line.isReturnable }),
        ...(line.warrantyTransferable === undefined
          ? {}
          : { warrantyTransferable: line.warrantyTransferable }),
      })),
      discountMinor: ctx.body.discountMinor ?? 0,
      paymentLabel: ctx.body.paymentLabel ?? null,
      gstin: ctx.body.gstin ?? null,
      returnWindowDays: ctx.body.returnWindowDays,
      returnPolicyNote: ctx.body.returnPolicyNote ?? null,
      ...(ctx.body.totalMinor === undefined ? {} : { totalMinor: ctx.body.totalMinor }),
    });

    await recordAudit({
      action: 'partner.receipt.issue',
      targetType: 'receipt',
      targetId: issued.receipt.id,
      organizationId: orgId,
      result: 'SUCCESS',
      actorUserId: actor.userId,
      actorRole,
      requestId: ctx.requestId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      // The customer reference, not the user id: an audit row a partner may read
      // should describe the person the way the partner already knows them.
      metadata: {
        presentationId: ctx.body.presentationId,
        customerRef: buyer.customerRef,
        lineCount: issued.lines.length,
        warrantyCount: issued.warranties.length,
        totalMinor: issued.receipt.totalMinor,
      },
    });

    return json(
      {
        receipt: {
          publicRef: issued.receipt.publicRef,
          issuedAt: issued.receipt.issuedAt,
          subtotalMinor: issued.receipt.subtotalMinor,
          discountMinor: issued.receipt.discountMinor,
          taxMinor: issued.receipt.taxMinor,
          totalMinor: issued.receipt.totalMinor,
          currency: issued.receipt.currency,
          returnWindowDays: issued.receipt.returnWindowDays,
        },
        customerRef: buyer.customerRef,
        warrantiesIssued: issued.warranties.length,
      },
      { status: 201 },
    );
  },
);
