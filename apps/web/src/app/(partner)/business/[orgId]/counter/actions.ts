/**
 * The counter's three actions: identify, price, issue.
 *
 * They are server actions rather than fetches to the API routes because the
 * console is server-rendered and a form post is the shorter, more robust path —
 * it works before hydration and with JavaScript off. Both surfaces call the same
 * rules in `lib/commerce/counter.ts` and `lib/commerce/receipts.ts`, so the till
 * integration and the console cannot disagree about what a sale is.
 *
 * Authorization happens in every action, on every submission, against the
 * caller's own membership. The `orgId` bound into each action is a routing hint
 * and never a grant.
 *
 * **Pricing is a separate step on purpose.** A shopkeeper should see the number
 * the customer is about to be charged, computed by the thing that will write it,
 * before anything is written — not a browser's guess at it, and never a figure
 * that grows between the screen and the receipt. `reviewAction` runs the receipt
 * service's own `computeReceiptTotals`; `issueAction` runs the same function
 * again inside the transaction. They cannot drift because they are one function.
 */
'use server';

import { revalidatePath } from 'next/cache';
import { requirePartner } from '@/components/partner/guard';
import { AppError } from '@/lib/errors';
import { computeReceiptTotals, issueReceipt, type ReceiptLineInput } from '@/lib/commerce/receipts';
import { resolveCounterBuyer, venueBelongsTo, verifyAtCounter } from '@/lib/commerce/counter';
import {
  IDLE_COUNTER_STATE as IDLE,
  type CounterState,
  type DraftLine,
  type SaleDraft,
} from '@/components/partner/counter-state';

/* ──────────────────────────  form → draft  ────────────────────────── */

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? '').trim();
}

/**
 * Rupees as typed → whole paise.
 *
 * Money is integer paise everywhere past this line. `Math.round` on the product
 * rather than parsing the decimal part separately, because 19.99 is not
 * representable and `19.99 * 100` is 1998.9999999999998 — the rounding is the
 * point, and doing it once, here, is what keeps it out of the arithmetic.
 */
function toMinor(rupees: string): number | null {
  if (rupees === '') return null;
  const n = Number(rupees);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/** Percent as typed → basis points. 18 → 1800, 2.5 → 250. */
function toBasisPoints(percent: string): number | null {
  if (percent === '') return 0;
  const n = Number(percent);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n * 100);
}

function readDraft(formData: FormData): SaleDraft {
  const count = Math.max(1, Math.min(60, Number(formData.get('lineCount') ?? 1) || 1));
  const lines: DraftLine[] = [];
  for (let i = 0; i < count; i++) {
    const description = str(formData, `line.${i}.description`);
    const unitPrice = str(formData, `line.${i}.unitPrice`);
    // A row the shopkeeper added and left empty is not an error; it is a row
    // they did not use. Dropping it here keeps "add three, fill two" working.
    if (description === '' && unitPrice === '') continue;
    lines.push({
      description,
      sku: str(formData, `line.${i}.sku`),
      quantity: str(formData, `line.${i}.quantity`) || '1',
      unitPrice,
      taxPercent: str(formData, `line.${i}.taxPercent`),
      warrantyMonths: str(formData, `line.${i}.warrantyMonths`),
      serialNumber: str(formData, `line.${i}.serialNumber`),
      returnable: formData.get(`line.${i}.returnable`) !== null,
    });
  }

  return {
    lines,
    discount: str(formData, 'discount'),
    paymentLabel: str(formData, 'paymentLabel'),
    merchantReceiptNo: str(formData, 'merchantReceiptNo'),
    gstin: str(formData, 'gstin'),
    venueId: str(formData, 'venueId'),
    returnWindowDays: str(formData, 'returnWindowDays') || '0',
    returnPolicyNote: str(formData, 'returnPolicyNote'),
  };
}

/**
 * Draft → the receipt service's input, or the first thing wrong with it.
 *
 * Field-level validation lives here rather than in the service because the
 * service speaks in paise and basis points and this is where rupees and percent
 * still exist — "line 2 needs a price" is only sayable while the typed text is
 * still in view.
 */
function toLines(draft: SaleDraft): { lines: ReceiptLineInput[] } | { error: string } {
  if (draft.lines.length === 0) return { error: 'Add at least one line before pricing the sale.' };

  const lines: ReceiptLineInput[] = [];
  for (let i = 0; i < draft.lines.length; i++) {
    const line = draft.lines[i]!;
    const at = `Line ${i + 1}`;
    if (line.description === '') return { error: `${at} needs a description.` };

    const quantity = Number(line.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) return { error: `${at} needs a whole quantity of at least 1.` };

    const unitPriceMinor = toMinor(line.unitPrice);
    if (unitPriceMinor === null) return { error: `${at} needs a price in rupees, not below zero.` };

    const taxRateBp = toBasisPoints(line.taxPercent);
    if (taxRateBp === null) return { error: `${at} needs a tax rate between 0 and 100 percent.` };

    const warrantyMonths = line.warrantyMonths === '' ? null : Number(line.warrantyMonths);
    if (warrantyMonths !== null && (!Number.isInteger(warrantyMonths) || warrantyMonths < 0 || warrantyMonths > 240)) {
      return { error: `${at} has a warranty that is not a whole number of months up to 240.` };
    }

    lines.push({
      description: line.description,
      sku: line.sku === '' ? null : line.sku,
      quantity,
      unitPriceMinor,
      taxRateBp,
      warrantyMonths,
      serialNumber: line.serialNumber === '' ? null : line.serialNumber,
      isReturnable: line.returnable,
    });
  }

  return { lines };
}

function discountOf(draft: SaleDraft): number | null {
  return draft.discount === '' ? 0 : toMinor(draft.discount);
}

function returnWindowOf(draft: SaleDraft): number | null {
  const days = Number(draft.returnWindowDays || '0');
  return Number.isInteger(days) && days >= 0 && days <= 3650 ? days : null;
}

/* ─────────────────────────────  actions  ───────────────────────────── */

/** Everything the console needs to stay where it is while showing a refusal. */
function fail(prev: CounterState, error: string, draft?: SaleDraft | null): CounterState {
  return {
    ...prev,
    // A refusal never advances the console, and never drops back to `identify`
    // either: the pass was accepted and making staff re-scan for a typo would be
    // a queue forming behind a mistake.
    phase: prev.phase === 'review' ? 'compose' : prev.phase,
    draft: draft ?? prev.draft,
    totals: null,
    error,
    at: new Date().toISOString(),
  };
}

/** Step one: the customer presents their pass. */
export async function identifyAction(
  orgId: string,
  _prev: CounterState,
  formData: FormData,
): Promise<CounterState> {
  const token = str(formData, 'token');
  const at = new Date().toISOString();
  const ctx = await requirePartner('partner.pass:verify', orgId, `/business/${orgId}/counter`);

  if (token.length < 8) {
    return {
      ...IDLE,
      error: 'Scan the customer’s pass, or type the code shown under it.',
      at,
    };
  }

  try {
    const outcome = await verifyAtCounter({
      token,
      organizationId: ctx.organizationId,
      staffUserId: ctx.actor.userId,
    });

    if (!outcome.ok) {
      // The service's wording, verbatim. A friendlier console here would turn
      // the till into an oracle for which passes exist.
      return { ...IDLE, checks: outcome.checks, error: outcome.message, at };
    }

    return {
      phase: 'compose',
      presentationId: outcome.presentationId,
      buyer: {
        customerRef: outcome.buyer.customerRef,
        displayName: outcome.buyer.displayName,
        presentedAt: at,
      },
      checks: outcome.checks,
      draft: null,
      totals: null,
      issued: null,
      error: null,
      at,
    };
  } catch (err) {
    return {
      ...IDLE,
      error: err instanceof AppError ? err.message : 'The counter could not reach the pass service. Try again.',
      at,
    };
  }
}

/** Step two: price the basket with the function that will write it. */
export async function reviewAction(
  orgId: string,
  prev: CounterState,
  formData: FormData,
): Promise<CounterState> {
  await requirePartner('partner.transaction:create', orgId, `/business/${orgId}/counter`);
  const draft = readDraft(formData);

  if (!prev.presentationId) return fail(prev, 'Scan the customer’s pass before pricing a sale.', draft);

  const parsed = toLines(draft);
  if ('error' in parsed) return fail(prev, parsed.error, draft);

  const discountMinor = discountOf(draft);
  if (discountMinor === null) return fail(prev, 'The discount must be an amount in rupees, not below zero.', draft);

  if (returnWindowOf(draft) === null) {
    return fail(prev, 'The return window must be a whole number of days, up to 3650.', draft);
  }

  try {
    const totals = computeReceiptTotals(parsed.lines, discountMinor);
    return { ...prev, phase: 'review', draft, totals, error: null, at: new Date().toISOString() };
  } catch (err) {
    // `computeReceiptTotals` refuses a discount larger than the subtotal and a
    // rate outside 0–100%. Its wording is precise about which line; keep it.
    return fail(prev, err instanceof AppError ? err.message : 'The sale could not be priced.', draft);
  }
}

/** Back to the basket from the review, with everything still typed in. */
export async function amendAction(
  orgId: string,
  prev: CounterState,
  formData: FormData,
): Promise<CounterState> {
  await requirePartner('partner.transaction:create', orgId, `/business/${orgId}/counter`);
  return {
    ...prev,
    phase: 'compose',
    draft: readDraft(formData),
    totals: null,
    error: null,
    at: new Date().toISOString(),
  };
}

/** Step three: write it. */
export async function issueAction(
  orgId: string,
  prev: CounterState,
  formData: FormData,
): Promise<CounterState> {
  const ctx = await requirePartner('partner.transaction:create', orgId, `/business/${orgId}/counter`);
  const draft = readDraft(formData);

  if (!prev.presentationId) return fail(prev, 'Scan the customer’s pass before issuing a receipt.', draft);

  const parsed = toLines(draft);
  if ('error' in parsed) return fail(prev, parsed.error, draft);

  const discountMinor = discountOf(draft);
  if (discountMinor === null) return fail(prev, 'The discount must be an amount in rupees, not below zero.', draft);

  const returnWindowDays = returnWindowOf(draft);
  if (returnWindowDays === null) {
    return fail(prev, 'The return window must be a whole number of days, up to 3650.', draft);
  }

  try {
    if (draft.venueId !== '' && !(await venueBelongsTo(draft.venueId, ctx.organizationId))) {
      return fail(prev, 'That venue does not belong to this organization.', draft);
    }

    // Re-resolved rather than taken from `prev`: the console's state is the
    // browser's, and the browser does not decide whose account a receipt lands
    // on. The window and the tenant filter are re-applied here, at the write.
    const buyer = await resolveCounterBuyer({
      presentationId: prev.presentationId,
      organizationId: ctx.organizationId,
    });
    if (!buyer.ok) {
      return {
        ...IDLE,
        error:
          buyer.reason === 'PRESENTATION_EXPIRED'
            ? 'That scan has expired. Ask the customer to show their pass again — a receipt is written against someone who is standing there.'
            : 'That scan is no longer valid. Ask the customer to show their pass again.',
        at: new Date().toISOString(),
      };
    }

    /**
     * The figure the operator read to the customer, as the receipt service's
     * own cross-check. It refuses the whole receipt on a mismatch, which turns
     * "the price moved between the review and the write" from a thing a
     * customer discovers into a thing that cannot happen.
     */
    const reviewed = Number(str(formData, 'reviewedTotalMinor'));

    const issued = await issueReceipt({
      userId: buyer.userId,
      ...(Number.isSafeInteger(reviewed) && reviewed >= 0 ? { totalMinor: reviewed } : {}),
      organizationId: ctx.organizationId,
      venueId: draft.venueId === '' ? null : draft.venueId,
      merchantReceiptNo: draft.merchantReceiptNo === '' ? null : draft.merchantReceiptNo,
      channel: 'IN_STORE',
      lines: parsed.lines,
      discountMinor,
      paymentLabel: draft.paymentLabel === '' ? null : draft.paymentLabel,
      gstin: draft.gstin === '' ? null : draft.gstin,
      returnWindowDays,
      returnPolicyNote: draft.returnPolicyNote === '' ? null : draft.returnPolicyNote,
    });

    revalidatePath(`/business/${ctx.organizationId}/counter`);
    revalidatePath(`/business/${ctx.organizationId}/receipts`);

    return {
      phase: 'issued',
      presentationId: null,
      buyer: prev.buyer,
      checks: [],
      draft: null,
      totals: null,
      issued: {
        publicRef: issued.receipt.publicRef,
        totalMinor: issued.receipt.totalMinor,
        taxMinor: issued.receipt.taxMinor,
        currency: issued.receipt.currency,
        warrantiesIssued: issued.warranties.length,
        returnWindowDays: issued.receipt.returnWindowDays,
        customerRef: buyer.customerRef,
      },
      error: null,
      at: new Date().toISOString(),
    };
  } catch (err) {
    return fail(prev, err instanceof AppError ? err.message : 'The receipt was not issued. Nothing was written.', draft);
  }
}

/** Clear down for the next customer. */
export async function nextCustomerAction(orgId: string): Promise<CounterState> {
  await requirePartner('partner.pass:verify', orgId, `/business/${orgId}/counter`);
  return { ...IDLE, at: new Date().toISOString() };
}

