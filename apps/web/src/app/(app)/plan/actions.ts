/**
 * Turning one line of a plan into a held booking.
 *
 * The planner deliberately stops short of this. `acceptPlanItem` resolves a plan
 * item into the ids a booking would need and returns them — it does not take a
 * lock, does not move capacity and does not start a hold, because none of those
 * should happen because somebody opened a page. This action is the other half:
 * it runs on a POST, after a person pressed a button, and only then does it call
 * `holdBooking`.
 *
 * Nothing here decides a price or a quantity. The slot, the offer and the number
 * of units all come back from `acceptPlanItem`, which reads them from the
 * itinerary row and the offer; `holdBooking` prices the hold from the slot and
 * the offer itself. A form that could name its own slot could name its own
 * price, so the form names neither — it carries an itinerary id and an item id,
 * and `acceptPlanItem` refuses both unless the itinerary belongs to the person
 * who submitted them.
 *
 * A hold is not a purchase. It expires, and this says so in the sentence it
 * redirects with, because "added to my day" would otherwise read as "paid for".
 */
'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { acceptPlanItem } from '@/lib/assistant/planner';
import { holdBooking } from '@/lib/commerce/booking';
import { AppError } from '@/lib/errors';
import { formatDateTime, formatMoney } from '@/components/ui';
import { currentActor } from '../_queries';

/**
 * Back to the screen the button was on, with the same query still in the URL.
 *
 * The path is chosen from a fixed pair rather than taken from the form: a
 * `returnTo` a client can set is an open redirect, and there is no version of
 * this feature that needs one.
 */
function backTo(surface: string, prompt: string, date: string, message: { done?: string; error?: string }): string {
  const path = surface === 'travel' ? '/travel/stay' : '/plan';
  const params = new URLSearchParams();
  if (prompt) params.set('q', prompt);
  if (date) params.set('date', date);
  if (message.done) params.set('done', message.done);
  if (message.error) params.set('error', message.error);
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

export async function addToMyDayAction(formData: FormData): Promise<void> {
  const actor = await currentActor();

  const itineraryId = String(formData.get('itineraryId') ?? '').trim();
  const itemId = String(formData.get('itemId') ?? '').trim();
  const surface = String(formData.get('surface') ?? 'plan').trim();
  const prompt = String(formData.get('q') ?? '').trim();
  const date = String(formData.get('date') ?? '').trim();

  if (!itineraryId || !itemId) {
    redirect(backTo(surface, prompt, date, { error: 'That plan item was not identified, so nothing was reserved.' }));
  }

  let outcome: string;

  try {
    // Ownership is checked inside `acceptPlanItem` against the itinerary's own
    // user id. The page never filters this — a plan item id from somebody else's
    // itinerary comes back as "no longer exists" whatever the screen showed.
    const accepted = await acceptPlanItem({ itineraryId, itemId, userId: actor.userId });

    if (!accepted.bookable || !accepted.slotId) {
      // A real answer, not a failure: some venues publish no capacity at all.
      redirect(backTo(surface, prompt, date, { error: accepted.note }));
    }

    const booking = await holdBooking({
      userId: actor.userId,
      slotId: accepted.slotId,
      offerId: accepted.offerId,
      quantity: accepted.quantity,
    });

    outcome =
      `Held ${booking.publicRef} — ${booking.quantity} ${booking.quantity === 1 ? 'unit' : 'units'} at ` +
      `${formatMoney(booking.amountMinor, booking.currency)}` +
      `${booking.startsAt ? `, ${formatDateTime(booking.startsAt)}` : ''}. ` +
      `The hold expires${booking.holdExpiresAt ? ` ${formatDateTime(booking.holdExpiresAt)}` : ' shortly'} and no money has moved — confirm it under Bookings.`;
  } catch (err) {
    // The service's own words: "that slot is full", "that offer has ended". A
    // rewritten message here would be a second opinion about what happened.
    if (err instanceof AppError) {
      redirect(backTo(surface, prompt, date, { error: err.message }));
    }
    throw err;
  }

  revalidatePath('/bookings');
  revalidatePath('/plan');
  redirect(backTo(surface, prompt, date, { done: outcome }));
}
