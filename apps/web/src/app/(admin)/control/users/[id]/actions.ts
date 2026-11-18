/**
 * Suspending and restoring one account, from the console.
 *
 * The action does not implement the suspension. `PATCH /api/admin/users/[id]`
 * already does — it refuses to let an administrator suspend their own account,
 * decides what "restore" means for someone who never verified a factor, notifies
 * the person in the same transaction as the change, revokes every session, and
 * writes the audit entry with the reason. Re-implementing that behind a form is
 * how a console and its API start telling two different stories about the same
 * account, so this calls the handler instead (see components/admin/route-bridge).
 *
 * Two things are still checked here, before the call:
 *   · the guard, so a non-platform actor posting this form gets the same 404 the
 *     pages give rather than reaching the handler at all;
 *   · the reason, because `platform.user:suspend` sits in REQUIRES_ELEVATION and
 *     a round trip that ends in "reason is too short" would burn the elevation
 *     window for nothing.
 *
 * A refusal comes back as the handler's own sentence and is shown to the
 * administrator. "You cannot change your own account from here" is a situation,
 * not a fault, and it reads better than anything this file could invent.
 */
'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { PATCH as adminUserPatch } from '@/app/api/admin/users/[id]/route';
import { requirePlatform } from '@/components/admin/guard';
import { callAdminRoute } from '@/components/admin/route-bridge';
import { isUlid } from '@/lib/ids';

export async function setUserStatus(formData: FormData): Promise<void> {
  // The console's own door, first. The handler authorizes again.
  await requirePlatform('platform.user:read', '/control/users');

  const userId = String(formData.get('userId') ?? '');
  const action = String(formData.get('action') ?? '');
  const reason = String(formData.get('reason') ?? '').trim();

  if (!isUlid(userId)) {
    redirect(`/control/users?error=${encodeURIComponent('That is not an account this console knows.')}`);
  }

  const base = `/control/users/${userId}`;

  if (action !== 'SUSPEND' && action !== 'RESTORE') {
    redirect(`${base}?error=${encodeURIComponent('That is not a change an account can take.')}`);
  }
  if (reason.length < 3) {
    redirect(
      `${base}?error=${encodeURIComponent(
        'A suspension needs a stated reason. An account that was closed for reasons nobody wrote down cannot be reviewed later.',
      )}`,
    );
  }

  const result = await callAdminRoute({
    handler: adminUserPatch,
    method: 'PATCH',
    path: `/api/admin/users/${userId}`,
    params: { id: userId },
    body: { action, reason: reason.slice(0, 240) },
  });

  if (!result.ok) {
    const message =
      result.code === 'REAUTH_REQUIRED'
        ? 'Suspending an account needs a recent sign-in. Sign in again, then repeat this.'
        : (result.message ?? 'That did not go through.');
    redirect(`${base}?error=${encodeURIComponent(message)}`);
  }

  revalidatePath(base);
  revalidatePath('/control/users');
  redirect(
    `${base}?done=${encodeURIComponent(
      action === 'SUSPEND'
        ? 'Account suspended. Every session was revoked and the person has been notified.'
        : 'Account restored. The person has been notified.',
    )}`,
  );
}
