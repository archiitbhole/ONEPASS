/**
 * Approving, rejecting and suspending a partner.
 *
 * As with the user actions, the decision itself is not implemented here.
 * `PATCH /api/admin/partners/[id]` owns the state machine — a live partner cannot
 * be "rejected", an application cannot be "suspended", an already-approved
 * organization cannot be approved twice — and it owns the outbox event that tells
 * the partner's own console, and the audit entry that records who decided what.
 * This action assembles the request and shows the answer (see
 * components/admin/route-bridge).
 *
 * Approving is what switches a business on: `authorize()` refuses every
 * `partner.*` permission at an organization that is not ACTIVE, so this one write
 * is what lets a partner's whole team in — and suspending is what puts them all
 * out again in the same single write. That is why both sit in REQUIRES_ELEVATION
 * and why the note is mandatory on every refusal.
 */
'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { PATCH as adminPartnerPatch } from '@/app/api/admin/partners/[id]/route';
import { requirePlatform } from '@/components/admin/guard';
import { callAdminRoute } from '@/components/admin/route-bridge';
import { isUlid } from '@/lib/ids';

const BASE = '/control/partners';

const DONE: Record<string, string> = {
  APPROVE: 'Partner approved. Their team can sign in to the business console now.',
  REJECT: 'Application rejected. The decision and its note are on the organization record.',
  SUSPEND: 'Partner suspended. Every member of their team lost access with that one write.',
};

export async function decidePartner(formData: FormData): Promise<void> {
  // The console's own door, first. The handler authorizes again, with the right
  // permission for the specific decision and with elevation required.
  await requirePlatform('platform.partner:read', BASE);

  const organizationId = String(formData.get('organizationId') ?? '');
  const action = String(formData.get('action') ?? '');
  const note = String(formData.get('note') ?? '').trim();

  if (!isUlid(organizationId)) {
    redirect(`${BASE}?error=${encodeURIComponent('That is not an organization this console knows.')}`);
  }
  if (action !== 'APPROVE' && action !== 'REJECT' && action !== 'SUSPEND') {
    redirect(`${BASE}?error=${encodeURIComponent('That is not a decision an application can take.')}`);
  }
  // The API requires a note on a refusal and on a suspension. Checked here too so
  // an empty box does not spend the elevation window on a round trip.
  if (action !== 'APPROVE' && note.length < 3) {
    redirect(
      `${BASE}?error=${encodeURIComponent(
        'A rejection or a suspension needs a note. It is what the partner’s account manager has to work from, and what makes the decision reviewable later.',
      )}`,
    );
  }

  const result = await callAdminRoute({
    handler: adminPartnerPatch,
    method: 'PATCH',
    path: `/api/admin/partners/${organizationId}`,
    params: { id: organizationId },
    body: note ? { action, note: note.slice(0, 500) } : { action },
  });

  if (!result.ok) {
    const message =
      result.code === 'REAUTH_REQUIRED'
        ? 'Deciding a partner application needs a recent sign-in. Sign in again, then repeat this.'
        : (result.message ?? 'That did not go through.');
    redirect(`${BASE}?error=${encodeURIComponent(message)}`);
  }

  revalidatePath(BASE);
  revalidatePath('/control');
  redirect(`${BASE}?done=${encodeURIComponent(DONE[action] ?? 'Done.')}`);
}
