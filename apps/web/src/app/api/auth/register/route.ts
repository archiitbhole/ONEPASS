/**
 * Registration. Always answers the same way, whether or not the address is free —
 * see lib/auth/flows.ts for why.
 */
import { route, json } from '@/lib/api';
import { registerBody } from '@/lib/auth/contracts';
import { register } from '@/lib/auth/flows';

export const POST = route(
  { bodySchema: registerBody, rateLimit: { name: 'auth:register:ip' }, loadActor: false },
  async (ctx) => {
    await register({
      email: ctx.body.email,
      password: ctx.body.password,
      displayName: ctx.body.displayName,
      mobile: ctx.body.mobile ?? null,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
    });
    return json(
      { status: 'pending', message: 'Check your email for a six-digit code.' },
      { status: 202 },
    );
  },
);
