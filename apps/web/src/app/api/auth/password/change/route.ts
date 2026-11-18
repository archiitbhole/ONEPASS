/** Change a password from inside the app. Signs out every other device. */
import { route, json } from '@/lib/api';
import { authorize } from '@/lib/authz/authorize';
import { passwordChangeBody } from '@/lib/auth/contracts';
import { changePassword } from '@/lib/auth/flows';
import { recordAudit } from '@/lib/audit';

export const POST = route({ bodySchema: passwordChangeBody, rateLimit: { name: 'auth:password-reset' } }, async (ctx) => {
  const auth = await authorize({ permission: 'self.profile:write', actor: ctx.actor ?? undefined });

  await changePassword({
    userId: auth.actor.userId,
    currentPassword: ctx.body.currentPassword,
    newPassword: ctx.body.newPassword,
    keepSessionId: auth.actor.session.sessionId,
    ip: ctx.ip,
    requestId: ctx.requestId,
  });

  await recordAudit({
    action: 'auth.password_change',
    targetType: 'user',
    targetId: auth.actor.userId,
    result: 'SUCCESS',
    actorUserId: auth.actor.userId,
    actorRole: auth.actorRole,
    requestId: ctx.requestId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return json({ status: 'changed' });
});
