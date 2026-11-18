/**
 * The travel server actions.
 *
 * Four things a person can do that change something: pick a fare, re-check its
 * price, accept a price that moved, and pay. Each one is a form submission
 * rather than a fetch, which means the flow works without JavaScript and the
 * browser's own double-submit protection applies.
 *
 * **What these never take from the form.** An amount, a discount, a points
 * value, a user id, or a destination to redirect to. The amount is computed in
 * `lib/travel/pricing.ts` from the booking row; the user comes from the session;
 * the redirect is built from a fixed path and a reference the server just
 * produced. A form field that could set any of those is a form field an attacker
 * can set.
 *
 * **Why the redirects carry a message rather than throwing.** A server action
 * that throws renders an error boundary, which loses the page the person was on
 * and everything they typed into it. These come back to the same screen with the
 * problem stated where they can act on it.
 */
'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { AppError } from '@/lib/errors';
import { consume } from '@/lib/ratelimit';
import {
  acceptNewPrice,
  beginPayment,
  cancelBooking,
  revalidateBooking,
  selectOffer,
  type PassengerInput,
} from '@/lib/travel/booking';
import { platformOrganizationId } from '@/lib/travel/platform-org';
import { currentActor } from '../_queries';

/** A redirect back to a travel screen, with a message. Paths are fixed, never taken from input. */
function backTo(path: string, message: { done?: string; error?: string }): string {
  const params = new URLSearchParams();
  if (message.done) params.set('done', message.done);
  if (message.error) params.set('error', message.error);
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

function messageFor(err: unknown): string {
  if (err instanceof AppError) return err.message;
  // Anything else is ours, and the customer is told something true and useless
  // rather than something revealing.
  return 'Something went wrong on our side. Nothing was charged.';
}

/**
 * Take a fare off the results page.
 *
 * The idempotency key is derived from the user and the offer, not supplied by
 * the form: a double-clicked "Select" must land on one booking, and a key the
 * browser chooses is a key a browser can vary.
 */
export async function selectOfferAction(formData: FormData): Promise<void> {
  const actor = await currentActor();
  const offerRef = String(formData.get('offerRef') ?? '').trim();
  if (!offerRef) redirect(backTo('/travel/flights', { error: 'That fare was not identified.' }));

  const allowance = await consume('travel:book', actor.userId);
  if (!allowance.ok) {
    redirect(backTo('/travel/flights', { error: 'Too many attempts. Try again in a minute.' }));
  }

  let ref: string;
  try {
    const result = await selectOffer({
      userId: actor.userId,
      offerRef,
      idempotencyKey: `select:${offerRef}`,
    });
    ref = result.ref;
  } catch (err) {
    redirect(backTo('/travel/flights', { error: messageFor(err) }));
  }

  redirect(`/travel/book/${ref}`);
}

/** Ask the airline what this fare costs now. */
export async function revalidateAction(formData: FormData): Promise<void> {
  const actor = await currentActor();
  const ref = String(formData.get('ref') ?? '').trim();
  if (!ref) redirect(backTo('/travel/trips', { error: 'That booking was not identified.' }));

  const allowance = await consume('travel:book', actor.userId);
  if (!allowance.ok) {
    redirect(backTo(`/travel/book/${ref}`, { error: 'Too many attempts. Try again in a minute.' }));
  }

  let message: string | null = null;
  try {
    const outcome = await revalidateBooking({ userId: actor.userId, ref });
    message = outcome.message;
  } catch (err) {
    redirect(backTo(`/travel/book/${ref}`, { error: messageFor(err) }));
  }

  revalidatePath(`/travel/book/${ref}`);
  redirect(message ? backTo(`/travel/book/${ref}`, { done: message }) : `/travel/book/${ref}`);
}

/** Say yes to a price that moved. The new figure comes from the row, not the form. */
export async function acceptPriceAction(formData: FormData): Promise<void> {
  const actor = await currentActor();
  const ref = String(formData.get('ref') ?? '').trim();
  if (!ref) redirect(backTo('/travel/trips', { error: 'That booking was not identified.' }));

  try {
    await acceptNewPrice({ userId: actor.userId, ref });
  } catch (err) {
    redirect(backTo(`/travel/book/${ref}`, { error: messageFor(err) }));
  }

  revalidatePath(`/travel/book/${ref}`);
  redirect(backTo(`/travel/book/${ref}`, { done: 'The new price is confirmed. You can pay when you are ready.' }));
}

/**
 * Add the passengers and create the payment.
 *
 * The form supplies who is travelling, which bank offer, and how many points.
 * It does not supply what any of those are worth — the server re-derives every
 * figure and creates the payment for the amount it computed.
 */
export async function payAction(formData: FormData): Promise<void> {
  const actor = await currentActor();
  const ref = String(formData.get('ref') ?? '').trim();
  if (!ref) redirect(backTo('/travel/trips', { error: 'That booking was not identified.' }));

  const allowance = await consume('travel:book', actor.userId);
  if (!allowance.ok) {
    redirect(backTo(`/travel/book/${ref}`, { error: 'Too many attempts. Try again in a minute.' }));
  }

  const count = Number(formData.get('passengerCount') ?? '0');
  if (!Number.isInteger(count) || count < 1 || count > 9) {
    redirect(backTo(`/travel/book/${ref}`, { error: 'That is not a number of passengers.' }));
  }

  const passengers: PassengerInput[] = [];
  for (let index = 0; index < count; index += 1) {
    const kind = String(formData.get(`kind-${index}`) ?? 'ADULT');
    passengers.push({
      kind: kind === 'CHILD' ? 'CHILD' : kind === 'INFANT' ? 'INFANT' : 'ADULT',
      title: emptyToNull(formData.get(`title-${index}`)),
      givenName: String(formData.get(`given-${index}`) ?? '').trim(),
      familyName: String(formData.get(`family-${index}`) ?? '').trim(),
      dateOfBirth: emptyToNull(formData.get(`dob-${index}`)),
      documentNumber: emptyToNull(formData.get(`doc-${index}`)),
      documentType: emptyToNull(formData.get(`docType-${index}`)),
      documentCountry: emptyToNull(formData.get(`docCountry-${index}`)),
      documentExpiresOn: emptyToNull(formData.get(`docExpiry-${index}`)),
    });
  }

  const contactEmail = String(formData.get('contactEmail') ?? '').trim();
  const contactPhone = String(formData.get('contactPhone') ?? '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contactEmail)) {
    redirect(backTo(`/travel/book/${ref}`, { error: 'The airline needs a working email address for the booking.' }));
  }
  if (!/^\+?\d{10,15}$/.test(contactPhone.replace(/[\s-]/g, ''))) {
    redirect(backTo(`/travel/book/${ref}`, { error: 'The airline needs a phone number it can reach you on.' }));
  }

  const bankOfferRef = emptyToNull(formData.get('bankOffer'));
  const pointsRaw = String(formData.get('points') ?? '0').trim();
  const pointsToSpend = /^\d{1,9}$/.test(pointsRaw) ? Number(pointsRaw) : 0;

  let transactionId: string;
  try {
    const result = await beginPayment({
      userId: actor.userId,
      ref,
      passengers,
      contactEmail,
      contactPhone,
      bankOfferRef,
      pointsToSpend,
      platformOrganizationId: await platformOrganizationId(),
    });
    transactionId = result.transactionId;
  } catch (err) {
    redirect(backTo(`/travel/book/${ref}`, { error: messageFor(err) }));
  }

  revalidatePath(`/travel/book/${ref}`);
  // To the payment screen, which opens the provider's own collection surface.
  // ONEPASS never sees a card number, and this redirect is where that boundary is.
  redirect(`/travel/book/${ref}/pay?txn=${encodeURIComponent(transactionId)}`);
}

export async function cancelBookingAction(formData: FormData): Promise<void> {
  const actor = await currentActor();
  const ref = String(formData.get('ref') ?? '').trim();
  if (!ref) redirect(backTo('/travel/trips', { error: 'That booking was not identified.' }));

  let message = 'Cancelled.';
  try {
    const result = await cancelBooking({ userId: actor.userId, ref, reason: 'Cancelled by the traveller' });
    message = result.message;
  } catch (err) {
    redirect(backTo(`/travel/trips/${ref}`, { error: messageFor(err) }));
  }

  revalidatePath(`/travel/trips/${ref}`);
  revalidatePath('/travel/trips');
  redirect(backTo(`/travel/trips/${ref}`, { done: message }));
}

function emptyToNull(value: FormDataEntryValue | null): string | null {
  const text = String(value ?? '').trim();
  return text === '' ? null : text;
}
