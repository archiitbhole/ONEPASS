/**
 * Moving an offer between states.
 *
 * The legal moves are `OFFER_TRANSITIONS` in the offers service — the same map the
 * buttons are rendered from — and `transitionOffer` re-checks them along with the
 * tenant. So a hand-crafted post that asks for ENDED → LIVE is refused by the
 * service, not merely absent from the page.
 *
 * A refusal is shown to the merchant rather than raised as a 500: "that offer has
 * already ended, change the window before publishing it" is information, and the
 * service already phrases it well.
 */
'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { OFFER_TRANSITIONS, transitionOffer, type OfferStatus } from '@/lib/commerce/offers';
import { requirePartner } from '@/components/partner/guard';
import { AppError } from '@/lib/errors';

const STATUSES = Object.keys(OFFER_TRANSITIONS) as OfferStatus[];

export async function moveOffer(orgId: string, formData: FormData): Promise<void> {
  const ctx = await requirePartner('partner.org:write', orgId, `/business/${orgId}/offers`);
  const base = `/business/${ctx.organizationId}/offers`;

  const offerId = String(formData.get('offerId') ?? '');
  const to = String(formData.get('to') ?? '');

  if (!offerId || !STATUSES.includes(to as OfferStatus)) {
    redirect(`${base}?error=${encodeURIComponent('That is not a state an offer can be in.')}`);
  }

  try {
    await transitionOffer({
      offerId,
      // The guard's tenant. An offer belonging to another organization is "not
      // found" inside the service, whatever id was posted.
      organizationId: ctx.organizationId,
      to: to as OfferStatus,
    });
  } catch (err) {
    if (err instanceof AppError) redirect(`${base}?error=${encodeURIComponent(err.message)}`);
    throw err;
  }

  revalidatePath(base);
  redirect(`${base}?moved=${encodeURIComponent(to)}`);
}
