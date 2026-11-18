/**
 * Creating a deal.
 *
 * Two actions, and the split matters. `previewPrice` exists so the form can show
 * the resulting price as it is typed *without* the browser learning how ONEPASS
 * prices a discount: the rule runs through the same `computePrice` the service
 * uses, against the slot's real list price, on the server. Re-implementing that
 * arithmetic in the client would mean two pricing engines that must agree, and
 * they would stop agreeing the first time either changed.
 *
 * `createDeal` does not trust the preview either. `createOffer` recomputes the
 * price from the slot it loads and refuses a rule that does not reduce it, so a
 * hand-crafted POST buys nothing: the price stored is the one the server derived.
 */
'use server';

import { redirect } from 'next/navigation';
import { eq, and } from 'drizzle-orm';
import { db } from '@/db/client';
import { inventorySlots } from '@/db/schema';
import { computePrice, createOffer, type DiscountKind, type OfferKind } from '@/lib/commerce/offers';
import { availabilityOf } from '@/lib/commerce/inventory';
import { requirePartner } from '@/components/partner/guard';
import type { DealFormState, PricePreview } from '@/components/partner/deal-state';
import { AppError } from '@/lib/errors';

const DISCOUNT_KINDS: DiscountKind[] = ['PERCENT', 'FLAT', 'FIXED_PRICE'];
const OFFER_KINDS: OfferKind[] = ['LIVE_DEAL', 'STANDING', 'CAMPAIGN'];

/**
 * A `datetime-local` value carries no zone. The merchant typed a time in the
 * timezone they trade in, so that is what it means here — reading it as the
 * server's local time would publish a deal five and a half hours out.
 */
function parseIstLocal(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}:00+05:30`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** The slot, but only if it belongs to the tenant the guard resolved. */
async function loadOwnSlot(organizationId: string, slotId: string) {
  const [slot] = await db
    .select()
    .from(inventorySlots)
    .where(and(eq(inventorySlots.id, slotId), eq(inventorySlots.organizationId, organizationId)))
    .limit(1);
  return slot ?? null;
}

export async function previewPrice(
  orgId: string,
  slotId: string,
  discountKind: string,
  discountValue: number,
): Promise<PricePreview> {
  const ctx = await requirePartner('partner.org:write', orgId, `/business/${orgId}/deals/new`);

  const empty: PricePreview = {
    ok: false,
    listPriceMinor: null,
    priceMinor: null,
    savedMinor: 0,
    currency: 'INR',
    message: null,
  };

  if (!DISCOUNT_KINDS.includes(discountKind as DiscountKind)) {
    return { ...empty, message: 'Choose a discount kind.' };
  }
  const kind = discountKind as DiscountKind;

  const slot = await loadOwnSlot(ctx.organizationId, slotId);
  if (!slot) return { ...empty, message: 'Pick a capacity slot to price against.' };

  const list = slot.listPriceMinor;
  const base: PricePreview = { ...empty, listPriceMinor: list, currency: slot.currency };

  if (!Number.isInteger(discountValue) || discountValue < 0) {
    return { ...base, message: 'The value must be a whole number.' };
  }
  // The same bounds createOffer enforces, so the preview never promises something
  // the save will refuse.
  if (kind === 'PERCENT' && (discountValue < 1 || discountValue > 90)) {
    return { ...base, message: 'A percentage discount must be between 1 and 90.' };
  }

  const priceMinor = computePrice(list, kind, discountValue);
  if (priceMinor >= list) {
    return { ...base, priceMinor, message: 'That rule does not reduce the price.' };
  }

  return {
    ok: true,
    listPriceMinor: list,
    priceMinor,
    savedMinor: Math.max(0, list - priceMinor),
    currency: slot.currency,
    message: null,
  };
}

export async function createDeal(
  orgId: string,
  _prev: DealFormState,
  formData: FormData,
): Promise<DealFormState> {
  const ctx = await requirePartner('partner.org:write', orgId, `/business/${orgId}/deals/new`);

  const fail = (message: string, field: string | null = null): DealFormState => ({
    phase: 'error',
    message,
    field,
  });

  const title = String(formData.get('title') ?? '').trim();
  if (title.length < 3 || title.length > 160) {
    return fail('Give the deal a title between 3 and 160 characters.', 'title');
  }

  const slotId = String(formData.get('slotId') ?? '');
  const slot = await loadOwnSlot(ctx.organizationId, slotId);
  if (!slot) return fail('Pick a capacity slot that belongs to this organization.', 'slotId');

  const discountKind = String(formData.get('discountKind') ?? '');
  if (!DISCOUNT_KINDS.includes(discountKind as DiscountKind)) {
    return fail('Choose a discount kind.', 'discountKind');
  }

  const rawValue = Number(formData.get('discountValue'));
  if (!Number.isFinite(rawValue)) return fail('The discount value must be a number.', 'discountValue');
  // Rupees in the form, paise in the database — money never crosses this boundary
  // as a float.
  const discountValue =
    discountKind === 'PERCENT' ? Math.round(rawValue) : Math.round(rawValue * 100);

  const offerKind = String(formData.get('kind') ?? 'LIVE_DEAL');
  if (!OFFER_KINDS.includes(offerKind as OfferKind)) return fail('Choose an offer kind.', 'kind');

  const startsAt = parseIstLocal(String(formData.get('startsAt') ?? ''));
  const endsAt = parseIstLocal(String(formData.get('endsAt') ?? ''));
  if (!startsAt) return fail('Set when the deal starts.', 'startsAt');
  if (!endsAt) return fail('Set when the deal ends.', 'endsAt');
  if (endsAt.getTime() <= startsAt.getTime()) {
    return fail('The deal must end after it starts.', 'endsAt');
  }
  if (endsAt.getTime() > slot.endsAt.getTime()) {
    return fail(
      `This slot finishes at ${slot.endsAt.toISOString()}; a deal on it cannot run past that.`,
      'endsAt',
    );
  }

  const maxRaw = String(formData.get('maxRedemptions') ?? '').trim();
  const available = availabilityOf(slot).available;
  let maxRedemptions: number | null = null;
  if (maxRaw.length > 0) {
    const parsed = Number(maxRaw);
    if (!Number.isInteger(parsed) || parsed < 1) return fail('The cap must be a whole number of 1 or more.', 'maxRedemptions');
    if (parsed > available) {
      return fail(`Only ${available} of this slot is unsold; a deal cannot promise ${parsed}.`, 'maxRedemptions');
    }
    maxRedemptions = parsed;
  }

  const publish = formData.get('publish') === 'on';

  let createdRef: string;

  try {
    const offer = await createOffer({
      // The guard's tenant, not the form's.
      organizationId: ctx.organizationId,
      createdBy: ctx.actor.userId,
      venueId: slot.venueId,
      slotId: slot.id,
      kind: offerKind as OfferKind,
      title,
      description: String(formData.get('description') ?? '').trim() || null,
      terms: String(formData.get('terms') ?? '').trim() || null,
      discountKind: discountKind as DiscountKind,
      discountValue,
      startsAt,
      endsAt,
      maxRedemptions,
      maxPerUser: 1,
      // SCHEDULED rather than LIVE when the window has not opened: publishing a
      // deal is a decision about a window, not about right now.
      status: publish ? (startsAt.getTime() <= Date.now() ? 'LIVE' : 'SCHEDULED') : 'DRAFT',
    });

    createdRef = offer.publicRef;
  } catch (err) {
    // A rejected rule ("that rule does not reduce the price") is the service
    // telling the merchant something true; it belongs in the form, not in a 500.
    if (err instanceof AppError) return fail(err.message);
    throw err;
  }

  // Outside the try: `redirect` signals by throwing, and catching it here would
  // swallow the navigation.
  redirect(`/business/${ctx.organizationId}/deals?created=${createdRef}`);
}
