/**
 * Password recovery, in two steps against one endpoint. Starting a reset always
 * reports success — telling a caller that an address has no account is the same
 * disclosure as telling them it does.
 */
import { route, json } from '@/lib/api';
import { passwordResetBody } from '@/lib/auth/contracts';
import { startPasswordReset, completePasswordReset } from '@/lib/auth/flows';

export const POST = route(
  { bodySchema: passwordResetBody, rateLimit: { name: 'auth:password-reset' }, loadActor: false },
  async (ctx) => {
    if (ctx.body.step === 'start') {
      await startPasswordReset({ email: ctx.body.email, ip: ctx.ip, requestId: ctx.requestId });
      return json({ status: 'sent', message: 'If that address has an account, a code is on its way.' }, { status: 202 });
    }

    await completePasswordReset({
      email: ctx.body.email,
      code: ctx.body.code,
      newPassword: ctx.body.newPassword,
      ip: ctx.ip,
      requestId: ctx.requestId,
    });
    return json({ status: 'reset', message: 'Password changed. Sign in with the new one.' });
  },
);
