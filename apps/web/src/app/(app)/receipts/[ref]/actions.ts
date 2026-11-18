/**
 * Opening a return from the receipt it belongs to.
 *
 * Everything that decides whether the return is allowed — the window, the
 * returnable flag, how much of the line is already claimed, and whether the
 * receipt is even yours — is checked by `requestReturn` inside the transaction
 * that writes the row, with the line locked. This action does not re-check any of
 * it, because a second opinion here would be a second opinion that can be wrong:
 * two tabs racing for the last of two items are separated by the lock, not by a
 * read taken a moment earlier.
 *
 * What this action does own is the shape of the form: a quantity that is a whole
 * number, a reason from the app's own vocabulary, and a resolution from the schema
 * enum. Those are rejected here rather than sent on as a 500.
 *
 * A refusal is shown to the person as the service's own sentence — "the return
 * window for this purchase closed on 20 August" is information, and the service
 * already phrases it better than a generic error would.
 */
'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requestReturn, type ReturnResolution } from '@/lib/commerce/returns';
import { isReturnReason } from '@/components/consumer/return-vocab';
import { AppError } from '@/lib/errors';
import { currentActor } from '../../_queries';

const RESOLUTIONS: readonly ReturnResolution[] = ['REFUND', 'REPLACEMENT', 'STORE_CREDIT', 'REPAIR'];

export async function requestReturnAction(receiptRef: string, formData: FormData): Promise<void> {
  const actor = await currentActor();
  const base = `/receipts/${encodeURIComponent(receiptRef)}`;
  const fail = (message: string): never => redirect(`${base}?error=${encodeURIComponent(message)}`);

  const receiptLineId = String(formData.get('receiptLineId') ?? '').trim();
  const quantityRaw = String(formData.get('quantity') ?? '').trim();
  const reasonCode = String(formData.get('reasonCode') ?? '').trim();
  const resolution = String(formData.get('requestedResolution') ?? '').trim();
  const note = String(formData.get('reasonNote') ?? '').trim();

  if (!receiptLineId) fail('That form did not say which item it was for.');

  const quantity = Number(quantityRaw);
  if (!Number.isInteger(quantity) || quantity < 1) {
    fail('Choose a whole quantity of at least 1 to return.');
  }

  if (!isReturnReason(reasonCode)) fail('Pick a reason for the return.');
  if (!RESOLUTIONS.includes(resolution as ReturnResolution)) {
    fail('Pick what you would like to happen — a refund, a replacement, store credit or a repair.');
  }

  let publicRef: string;
  try {
    const created = await requestReturn({
      userId: actor.userId,
      receiptLineId,
      quantity,
      reasonCode,
      requestedResolution: resolution as ReturnResolution,
      ...(note ? { reasonNote: note.slice(0, 500) } : {}),
    });
    publicRef = created.publicRef;
  } catch (err) {
    // The service's refusals are sentences meant for this person. Anything else is
    // a real fault and is left to the error boundary.
    if (err instanceof AppError) fail(err.message);
    throw err;
  }

  revalidatePath(base);
  revalidatePath('/returns');
  redirect(`${base}?opened=${encodeURIComponent(publicRef)}`);
}
