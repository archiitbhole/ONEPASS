/**
 * Acknowledging security events.
 *
 * `POST /api/admin/security` already does this properly: it acknowledges only the
 * events that are still unacknowledged (`is null` in the predicate, so two people
 * clearing the same queue cannot overwrite each other), writes one audit entry per
 * event rather than one per batch, and reports back which ids it did not touch.
 * This action collects the ticked boxes and calls it.
 *
 * Acknowledging does not delete or edit an event. It stamps who looked and when,
 * so the queue shrinks without the history doing the same — which is why the
 * button says "acknowledge" rather than "clear".
 */
'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { POST as adminSecurityPost } from '@/app/api/admin/security/route';
import { requirePlatform } from '@/components/admin/guard';
import { callAdminRoute } from '@/components/admin/route-bridge';
import { isUlid } from '@/lib/ids';
import { DEFAULT_LOOKBACK_MINUTES, runDetectors } from '@/lib/security/detect';

const BASE = '/control/security';

export async function acknowledgeEvents(formData: FormData): Promise<void> {
  await requirePlatform('platform.security:read', BASE);

  const back = String(formData.get('back') ?? BASE);
  const target = back.startsWith('/control/security') ? back : BASE;
  const separator = target.includes('?') ? '&' : '?';

  // Bounded at 50 by the API. The page never renders more than that at once, but
  // a hand-built post is not the page.
  const eventIds = formData
    .getAll('eventIds')
    .map((value) => String(value))
    .filter(isUlid)
    .slice(0, 50);

  const note = String(formData.get('note') ?? '').trim();

  if (eventIds.length === 0) {
    redirect(
      `${target}${separator}error=${encodeURIComponent(
        'Nothing was ticked, so nothing was acknowledged.',
      )}`,
    );
  }

  const result = await callAdminRoute({
    handler: adminSecurityPost,
    method: 'POST',
    path: '/api/admin/security',
    body: note ? { eventIds, note: note.slice(0, 500) } : { eventIds },
  });

  if (!result.ok) {
    redirect(
      `${target}${separator}error=${encodeURIComponent(result.message ?? 'That did not go through.')}`,
    );
  }

  revalidatePath(BASE);
  revalidatePath('/control');
  redirect(
    `${target}${separator}done=${encodeURIComponent(
      `${eventIds.length} ${eventIds.length === 1 ? 'event' : 'events'} sent for acknowledgement. Anything already acknowledged was left as it was.`,
    )}`,
  );
}


/**
 * Run the detectors now.
 *
 * There is no scheduler in this repository, so the sweep is a button. In
 * production it wants a few-minute cadence; saying that here is more honest than
 * a screen that implies something is watching continuously when nothing is.
 *
 * The sweep only ever writes to `security_events`, and it suppresses a finding
 * whose fingerprint is already filed, so pressing this twice does not double the
 * queue. It cannot suspend anyone — response is a separate, human decision made
 * on the account screen.
 */
export async function runSecuritySweep(formData: FormData): Promise<void> {
  // Detection writes to the security record, so it sits behind the same
  // permission as acknowledging rather than behind read.
  await requirePlatform('platform.security:acknowledge', BASE);

  const back = String(formData.get('back') ?? BASE);
  const target = back.startsWith('/control/security') ? back : BASE;
  const separator = target.includes('?') ? '&' : '?';

  let message: string;
  try {
    const report = await runDetectors({ lookbackMinutes: DEFAULT_LOOKBACK_MINUTES });
    const kinds = Object.entries(report.byKind)
      .map(([kind, n]) => `${n} ${kind.replace('suspicious.', '').replace(/_/g, ' ')}`)
      .join(', ');

    message =
      report.written === 0 && report.suppressed === 0
        ? `Swept the last ${DEFAULT_LOOKBACK_MINUTES} minutes. Nothing met a threshold.`
        : `Swept the last ${DEFAULT_LOOKBACK_MINUTES} minutes: ${report.written} new ${report.written === 1 ? 'finding' : 'findings'}` +
          (report.suppressed > 0 ? `, ${report.suppressed} already filed` : '') +
          (kinds ? ` (${kinds}).` : '.');
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'The sweep did not complete.';
    redirect(`${target}${separator}error=${encodeURIComponent(detail)}`);
  }

  revalidatePath(BASE);
  revalidatePath('/control');
  redirect(`${target}${separator}done=${encodeURIComponent(message)}`);
}
