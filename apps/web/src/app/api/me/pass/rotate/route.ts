/**
 * Reissue the pass.
 *
 * This is the answer to "someone photographed my QR": the secret is replaced, so
 * every code ever shown from the old one stops verifying immediately. The pass
 * reference changes with it, which is why the new one is returned — a client holding
 * the old reference has nothing usable.
 */
import { z } from 'zod';
import { json, route } from '@/lib/api';
import { notify, recordAudit } from '@/lib/audit';
import { authorize } from '@/lib/authz/authorize';
import { AppError } from '@/lib/errors';
import { rotatePass } from '@/lib/pass/service';
import { BRAND } from '@/lib/brand';

/** Nothing to send. Strict, so a stray field is a 422 rather than a silent no-op. */
const bodySchema = z.object({}).strict();

export const POST = route({ bodySchema }, async (ctx) => {
  const { actor, actorRole } = await authorize({
    permission: 'self.pass:rotate',
    actor: ctx.actor ?? undefined,
  });

  const audit = (result: 'SUCCESS' | 'FAILED', targetId: string | null, metadata: Record<string, unknown>) =>
    recordAudit({
      action: 'self.pass.rotate',
      targetType: 'pass',
      targetId,
      result,
      actorUserId: actor.userId,
      actorRole,
      requestId: ctx.requestId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata,
    });

  let rotated: { passRef: string };
  try {
    // rotatePass emits PASS_ROTATED itself, so the realtime channel cannot miss it.
    rotated = await rotatePass(actor.userId);
  } catch (err) {
    await audit('FAILED', null, { reason: err instanceof AppError ? err.code : 'ERROR' });
    throw err;
  }

  await notify({
    userId: actor.userId,
    category: 'SECURITY',
    title: 'Your pass was reissued',
    body: `Any code shown from your old pass no longer works. Open ${BRAND.name} to show the new one.`,
    linkPath: '/pass',
  });

  await audit('SUCCESS', rotated.passRef, {});

  return json({ passRef: rotated.passRef, rotatedAt: new Date() });
});
