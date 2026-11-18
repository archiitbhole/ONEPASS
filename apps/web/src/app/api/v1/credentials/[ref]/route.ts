/**
 * A credential by its public reference — what a QR scan lands on.
 *
 * Same disclosure rules as /v1/verify, and it records the check too: a scan is a
 * verification whether it arrived as a POST or as someone opening a link.
 */
import { route, json } from '@/lib/api';
import { verifyCredential } from '@/lib/credentials/service';

export const GET = route({ rateLimit: { name: 'pass:verify' } }, async (ctx) => {
  const result = await verifyCredential({
    presentedRef: ctx.params.ref ?? '',
    channel: 'public',
    verifierUserId: ctx.actor?.userId ?? null,
    requestId: ctx.requestId,
    ip: ctx.ip,
  });
  return json(result);
});
