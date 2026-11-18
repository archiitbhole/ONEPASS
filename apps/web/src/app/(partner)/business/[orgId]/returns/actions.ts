/**
 * Deciding and moving a return.
 *
 * Both actions hand the guard's organization id to the service, which re-checks
 * it against the case's own `organizationId` and answers "not found" for anyone
 * else's — so a posted return id from another tenant is a 404 inside the
 * transaction, not merely absent from this page.
 *
 * PERMISSION: deciding a return is gated on `partner.transaction:refund` rather
 * than on `transaction:read`. Reading the queue is a counter's job; agreeing to
 * give money or goods back is not. No money moves from here either way — the
 * service records the decision and the amount agreed, and the payments module
 * settles it.
 *
 * A refusal from the service (a state that no longer allows the move, a refund
 * larger than the units coming back) is shown to the merchant as a sentence.
 * They are all situations, not faults.
 */
'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  RETURN_TRANSITIONS,
  advanceReturn,
  reviewReturn,
  type ReturnState,
} from '@/lib/commerce/returns';
import { requirePartner } from '@/components/partner/guard';
import { AppError } from '@/lib/errors';

const STATES = Object.keys(RETURN_TRANSITIONS) as ReturnState[];
const RESOLUTIONS = ['REFUND', 'REPLACEMENT', 'STORE_CREDIT', 'REPAIR'] as const;

type Resolution = (typeof RESOLUTIONS)[number];

/** Rupees from a form field → whole paise, or null when the field was blank. */
function paiseFrom(value: FormDataEntryValue | null): number | null {
  const raw = String(value ?? '').trim();
  if (raw === '') return null;
  const rupees = Number(raw);
  if (!Number.isFinite(rupees) || rupees < 0) return null;
  return Math.round(rupees * 100);
}

export async function decideReturn(orgId: string, formData: FormData): Promise<void> {
  const ctx = await requirePartner('partner.transaction:refund', orgId, `/business/${orgId}/returns`);
  const base = `/business/${ctx.organizationId}/returns`;

  const returnId = String(formData.get('returnId') ?? '');
  const decision = String(formData.get('decision') ?? '');
  const merchantNote = String(formData.get('merchantNote') ?? '').trim();
  const resolutionRaw = String(formData.get('grantedResolution') ?? '');
  const refundMinor = paiseFrom(formData.get('refundRupees'));

  if (!returnId || (decision !== 'APPROVED' && decision !== 'REJECTED')) {
    redirect(`${base}?error=${encodeURIComponent('That is not a decision a return can take.')}`);
  }
  if (merchantNote.length === 0) {
    redirect(
      `${base}?error=${encodeURIComponent(
        'A decision needs a note. The customer is shown it, and "declined" with no reason is how a return becomes a complaint.',
      )}`,
    );
  }

  const grantedResolution = RESOLUTIONS.includes(resolutionRaw as Resolution)
    ? (resolutionRaw as Resolution)
    : null;

  try {
    await reviewReturn({
      returnId,
      // The guard's tenant, never the posted one.
      organizationId: ctx.organizationId,
      staffUserId: ctx.actor.userId,
      decision: decision as 'APPROVED' | 'REJECTED',
      grantedResolution,
      refundMinor,
      merchantNote,
    });
  } catch (err) {
    if (err instanceof AppError) redirect(`${base}?error=${encodeURIComponent(err.message)}`);
    throw err;
  }

  revalidatePath(base);
  redirect(`${base}?decided=${encodeURIComponent(decision)}`);
}

/** Collected, refunded, replaced, closed — the moves after a decision. */
export async function moveReturn(orgId: string, formData: FormData): Promise<void> {
  const ctx = await requirePartner('partner.transaction:refund', orgId, `/business/${orgId}/returns`);
  const base = `/business/${ctx.organizationId}/returns`;

  const returnId = String(formData.get('returnId') ?? '');
  const to = String(formData.get('to') ?? '');

  if (!returnId || !STATES.includes(to as ReturnState)) {
    redirect(`${base}?error=${encodeURIComponent('That is not a state a return can be in.')}`);
  }

  try {
    await advanceReturn({
      returnId,
      organizationId: ctx.organizationId,
      to: to as ReturnState,
      staffUserId: ctx.actor.userId,
    });
  } catch (err) {
    if (err instanceof AppError) redirect(`${base}?error=${encodeURIComponent(err.message)}`);
    throw err;
  }

  revalidatePath(base);
  redirect(`${base}?moved=${encodeURIComponent(to)}`);
}
