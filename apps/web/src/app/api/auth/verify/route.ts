/** Confirm an emailed or texted code. */
import { route, json } from '@/lib/api';
import { verifyBody } from '@/lib/auth/contracts';
import { confirmVerification } from '@/lib/auth/flows';

export const POST = route(
  { bodySchema: verifyBody, rateLimit: { name: 'auth:otp:verify' }, loadActor: false },
  async (ctx) => {
    await confirmVerification({
      purpose: ctx.body.purpose,
      destination: ctx.body.destination,
      code: ctx.body.code,
      ip: ctx.ip,
      requestId: ctx.requestId,
    });
    return json({ status: 'verified' });
  },
);
