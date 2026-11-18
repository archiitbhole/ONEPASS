/**
 * Splitting a bill, from a form.
 *
 * Four actions, three of them the ordinary redirect-with-a-message shape used
 * everywhere else in the app, and one — creating a split — that deliberately is
 * not.
 *
 * `createSplit` returns one plaintext claim token per share and never returns
 * them again; only the SHA-256 is stored. A redirect cannot carry them: the
 * query string is written to the browser's history, the server log and anything
 * sitting in front of it. So creation returns its result *to the client
 * component that called it*, through `useActionState`, and the tokens live in
 * React state on one rendered page until it is navigated away from. That is the
 * only place they ever exist in readable form after the transaction commits.
 *
 * Everything the split rules care about — the shares summing to the total, the
 * twelve-hour reminder interval, who may waive — is enforced by the service
 * inside its own transaction. These actions shape the form and pass the
 * service's refusal on as the sentence it already is.
 */
'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  createSplit,
  declineShare,
  remindShare,
  waiveShare,
  type SplitMethod,
} from '@/lib/commerce/split';
import { AppError } from '@/lib/errors';
import { currentActor } from '../_queries';
import { BRAND } from '@/lib/brand';

const METHODS: readonly SplitMethod[] = ['EQUAL', 'BY_AMOUNT', 'BY_SHARE'];

export interface CreatedShareToken {
  displayLabel: string;
  amountMinor: number;
  token: string;
  /** The organiser's own share — the first one, which needs no invitation. */
  isOrganiser: boolean;
}

export type CreateSplitState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | {
      status: 'created';
      publicRef: string;
      title: string;
      totalMinor: number;
      currency: string;
      tokens: CreatedShareToken[];
    };

/** Rupees typed into a form → whole paise, or null when the field is unusable. */
function paise(value: FormDataEntryValue | undefined): number | null {
  const raw = String(value ?? '').trim();
  if (raw === '') return null;
  const rupees = Number(raw);
  if (!Number.isFinite(rupees) || rupees < 0) return null;
  return Math.round(rupees * 100);
}

function whole(value: FormDataEntryValue | undefined): number | null {
  const raw = String(value ?? '').trim();
  if (raw === '') return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

export async function createSplitAction(
  _previous: CreateSplitState,
  formData: FormData,
): Promise<CreateSplitState> {
  const actor = await currentActor();

  const title = String(formData.get('title') ?? '').trim();
  const note = String(formData.get('note') ?? '').trim();
  const methodRaw = String(formData.get('method') ?? '');
  const totalMinor = paise(formData.get('totalRupees') ?? undefined);

  if (title.length < 3) return { status: 'error', message: 'Give the split a title people will recognise.' };
  if (!METHODS.includes(methodRaw as SplitMethod)) {
    return { status: 'error', message: 'Choose how the total is divided.' };
  }
  const method = methodRaw as SplitMethod;

  if (totalMinor === null || totalMinor <= 0) {
    return { status: 'error', message: 'The total has to be an amount above zero.' };
  }

  // Four parallel lists, one per column of the participant rows. `getAll`
  // preserves document order, so index i of each is the same row.
  const labels = formData.getAll('label').map((v) => String(v).trim());
  const amounts = formData.getAll('amountRupees');
  const units = formData.getAll('shareUnits');
  const contacts = formData.getAll('contact').map((v) => String(v).trim());

  const participants = labels
    .map((displayLabel, i) => ({
      displayLabel,
      amountMinor: paise(amounts[i]),
      shareUnits: whole(units[i]),
      invitee: contacts[i] ?? '',
    }))
    .filter((p) => p.displayLabel.length > 0);

  if (participants.length < 2) {
    return {
      status: 'error',
      message: 'A split needs you and at least one other person. Name everyone who owes a share.',
    };
  }

  if (method === 'BY_AMOUNT' && participants.some((p) => p.amountMinor === null)) {
    return { status: 'error', message: 'Splitting by amount means every person needs an amount.' };
  }
  if (method === 'BY_SHARE' && participants.some((p) => p.shareUnits === null)) {
    return { status: 'error', message: 'Splitting by share means every person needs a whole number of shares.' };
  }

  try {
    const created = await createSplit({
      organiserUserId: actor.userId,
      title: title.slice(0, 160),
      ...(note ? { note: note.slice(0, 300) } : {}),
      totalMinor,
      method,
      // The first participant is the organiser's own share. `allocateShares`
      // puts the rounding remainder there on purpose.
      participants: participants.map((p) => ({
        displayLabel: p.displayLabel,
        ...(method === 'BY_AMOUNT' ? { amountMinor: p.amountMinor } : {}),
        ...(method === 'BY_SHARE' ? { shareUnits: p.shareUnits } : {}),
        ...(p.invitee ? { invitee: p.invitee } : {}),
      })),
    });

    const amountByShare = new Map(created.shares.map((s) => [s.id, s.amountMinor]));

    revalidatePath('/split');

    return {
      status: 'created',
      publicRef: created.split.publicRef,
      title: created.split.title,
      totalMinor: created.split.totalMinor,
      currency: created.split.currency,
      tokens: created.claimTokens.map((t, index) => ({
        displayLabel: t.displayLabel,
        amountMinor: amountByShare.get(t.shareId) ?? 0,
        token: t.token,
        isOrganiser: index === 0,
      })),
    };
  } catch (err) {
    // The service's refusals are sentences written for this person — "the shares
    // add up to 90000 paise but the total is 100000 paise" says exactly what to fix.
    if (err instanceof AppError) return { status: 'error', message: err.message };
    throw err;
  }
}

/** Where a share action came from, so a refusal lands back on the split it is about. */
function back(ref: string, key: 'error' | 'done', message: string): never {
  redirect(`/split/${encodeURIComponent(ref)}?${key}=${encodeURIComponent(message)}`);
}

export async function remindShareAction(formData: FormData): Promise<void> {
  const actor = await currentActor();
  const ref = String(formData.get('splitRef') ?? '');
  const shareId = String(formData.get('shareId') ?? '');
  if (!ref || !shareId) redirect('/split');

  try {
    const result = await remindShare({ shareId, organiserUserId: actor.userId });
    revalidatePath(`/split/${ref}`);
    back(
      ref,
      'done',
      result.notified
        ? `Reminder sent — they have it in their ${BRAND.name} notifications.`
        : `Reminder recorded. They have no ${BRAND.name} account yet, so the claim link you were given is still the only way they hear about it.`,
    );
  } catch (err) {
    if (err instanceof AppError) back(ref, 'error', err.message);
    throw err;
  }
}

export async function waiveShareAction(formData: FormData): Promise<void> {
  const actor = await currentActor();
  const ref = String(formData.get('splitRef') ?? '');
  const shareId = String(formData.get('shareId') ?? '');
  if (!ref || !shareId) redirect('/split');

  try {
    await waiveShare({ shareId, organiserUserId: actor.userId });
    revalidatePath(`/split/${ref}`);
    revalidatePath('/split');
    back(ref, 'done', 'Share waived. You are covering it, so the split can settle for less than its total.');
  } catch (err) {
    if (err instanceof AppError) back(ref, 'error', err.message);
    throw err;
  }
}

/** A participant saying a share is not theirs. The amount stays outstanding. */
export async function declineShareAction(formData: FormData): Promise<void> {
  const actor = await currentActor();
  const ref = String(formData.get('splitRef') ?? '');
  const shareId = String(formData.get('shareId') ?? '');
  if (!ref || !shareId) redirect('/split');

  try {
    await declineShare({ shareId, userId: actor.userId });
    revalidatePath(`/split/${ref}`);
    revalidatePath('/split');
    back(ref, 'done', 'Declined. The organiser has been told, and can cover it or reassign it.');
  } catch (err) {
    if (err instanceof AppError) back(ref, 'error', err.message);
    throw err;
  }
}
