/**
 * Buying, sending and claiming a gift.
 *
 * The same rule as splits governs the shape of these: `createGift` returns the
 * claim token in plaintext exactly once and stores only its SHA-256, so the
 * result comes back to the client component through `useActionState` rather than
 * through a redirect. A token in a query string is a token in browser history
 * and in every access log between here and the browser.
 *
 * Claiming goes the same way for the opposite reason: the token is *submitted*,
 * and a failed claim has to say why — expired, already claimed, your own gift —
 * next to the field rather than in a URL.
 *
 * What this file does not do is decide anything about capacity or price. The
 * slot and the organization are looked up from the live offer server-side rather
 * than taken from the form, so a posted slot id cannot buy against capacity the
 * screen never offered; everything after that is `createGift`'s own transaction,
 * which holds the booking, confirms it and writes the gift together.
 */
'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { claimGift, createGift, deliverGift } from '@/lib/commerce/gifts';
import { AppError } from '@/lib/errors';
import { getEnv } from '@/lib/env';
import { currentActor, giftableOffers, sentGiftId } from '../_queries';
import { BRAND } from '@/lib/brand';

export type CreateGiftState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | {
      status: 'created';
      publicRef: string;
      title: string;
      recipientLabel: string;
      amountMinor: number;
      currency: string;
      expiresAt: string;
      /** Plaintext, once. Only the digest of the token inside it is stored. */
      claimUrl: string;
      claimToken: string;
      /** Whether an address was supplied at all — not whether it matched an account. */
      contactGiven: boolean;
    };

export type ClaimGiftState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'claimed'; title: string; bookingRef: string | null; ticketsReassigned: number };

export async function createGiftAction(
  _previous: CreateGiftState,
  formData: FormData,
): Promise<CreateGiftState> {
  const actor = await currentActor();

  const offerId = String(formData.get('offerId') ?? '').trim();
  const recipientLabel = String(formData.get('recipientLabel') ?? '').trim();
  const recipient = String(formData.get('recipient') ?? '').trim();
  const message = String(formData.get('message') ?? '').trim();

  if (recipientLabel.length < 2) {
    return { status: 'error', message: 'Say who it is for — a name you will recognise in the list.' };
  }

  // The offer is re-read from the same query the form was drawn from, so the
  // slot, the partner and the price come from the row rather than the post.
  const offers = await giftableOffers();
  const offer = offers.find((o) => o.offerId === offerId);
  if (!offer) {
    return {
      status: 'error',
      message: 'That deal is no longer available to gift. Pick one from the list — it is rebuilt every time this page loads.',
    };
  }

  try {
    const created = await createGift({
      senderUserId: actor.userId,
      organizationId: offer.organizationId,
      slotId: offer.slotId,
      offerId: offer.offerId,
      title: offer.title,
      recipientLabel: recipientLabel.slice(0, 80),
      ...(recipient ? { recipient } : {}),
      ...(message ? { message: message.slice(0, 500) } : {}),
    });

    revalidatePath('/gifts');

    const base = getEnv().APP_URL.replace(/\/+$/, '');
    return {
      status: 'created',
      publicRef: created.gift.publicRef,
      title: created.gift.title,
      recipientLabel: created.gift.recipientLabel,
      amountMinor: created.gift.amountMinor,
      currency: created.gift.currency,
      expiresAt: created.gift.expiresAt.toISOString(),
      claimUrl: `${base}/gifts?claim=${encodeURIComponent(created.claimToken)}`,
      claimToken: created.claimToken,
      contactGiven: Boolean(recipient),
    };
  } catch (err) {
    if (err instanceof AppError) return { status: 'error', message: err.message };
    throw err;
  }
}

export async function claimGiftAction(
  _previous: ClaimGiftState,
  formData: FormData,
): Promise<ClaimGiftState> {
  const actor = await currentActor();
  const token = String(formData.get('claimToken') ?? '').trim();

  if (!token) return { status: 'error', message: 'Paste the claim link or the token from it.' };

  // A pasted link is as good as a pasted token — take the parameter out of it.
  let claimToken = token;
  const marker = claimToken.indexOf('claim=');
  if (marker >= 0) claimToken = decodeURIComponent(claimToken.slice(marker + 'claim='.length).split('&')[0] ?? '');

  try {
    const claimed = await claimGift({ claimToken, recipientUserId: actor.userId });

    revalidatePath('/gifts');
    revalidatePath('/tickets');
    revalidatePath('/bookings');

    return {
      status: 'claimed',
      title: claimed.gift.title,
      bookingRef: claimed.bookingPublicRef,
      ticketsReassigned: claimed.ticketsReassigned,
    };
  } catch (err) {
    // "That gift link is not valid" is deliberately the same answer for a token
    // that never existed and one that is wrong. This passes it on unchanged.
    if (err instanceof AppError) return { status: 'error', message: err.message };
    throw err;
  }
}

/**
 * Marking a gift as sent.
 *
 * PAID → DELIVERED. It notifies the recipient only when the address they were
 * bought for matched an existing account; for everyone else the claim link the
 * sender was handed is the delivery, and this module has no address to send it
 * to by design.
 */
export async function deliverGiftAction(formData: FormData): Promise<void> {
  const actor = await currentActor();
  const publicRef = String(formData.get('giftRef') ?? '').trim();
  if (!publicRef) redirect('/gifts');

  const giftId = await sentGiftId(publicRef, actor.userId);
  if (!giftId) {
    redirect(`/gifts?error=${encodeURIComponent('That gift is not one of yours to send.')}`);
  }

  try {
    await deliverGift(giftId);
  } catch (err) {
    if (err instanceof AppError) redirect(`/gifts?error=${encodeURIComponent(err.message)}`);
    throw err;
  }

  revalidatePath('/gifts');
  redirect(
    `/gifts?done=${encodeURIComponent(
      `Marked as sent. If they already have a ${BRAND.name} account they have been notified; otherwise the claim link you were given is the delivery.`,
    )}`,
  );
}
