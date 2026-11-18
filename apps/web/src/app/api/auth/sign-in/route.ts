/**
 * Sign in.
 *
 * Two rate limits, deliberately: one per IP to slow a spray across many accounts,
 * and one per identifier so a distributed attack still cannot grind a single
 * account. Every failure returns the same message and the same status.
 */
import { route, json } from '@/lib/api';
import { signInBody, type SignInResponse } from '@/lib/auth/contracts';
import { signIn } from '@/lib/auth/flows';
import { setSessionCookie } from '@/lib/auth/session';
import { consume } from '@/lib/ratelimit';
import { normaliseDestination } from '@/lib/auth/otp';
import { unauthenticated, rateLimited } from '@/lib/errors';

export const POST = route(
  { bodySchema: signInBody, rateLimit: { name: 'auth:login:ip' }, loadActor: false },
  async (ctx) => {
    const identifier = normaliseDestination('EMAIL', ctx.body.email);
    const perAccount = await consume('auth:login:identifier', identifier);
    if (!perAccount.ok) {
      // Deliberately the same shape as any other rate limit, so this does not
      // become a way to discover which addresses are worth attacking.
      throw rateLimited(`Too many attempts. Try again in ${perAccount.resetSeconds} seconds.`);
    }

    const result = await signIn({
      email: ctx.body.email,
      password: ctx.body.password,
      device: {
        deviceHandle: ctx.body.deviceHandle ?? null,
        devicePlatform: ctx.body.devicePlatform ?? null,
        deviceLabel: ctx.body.deviceLabel ?? null,
      },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
    });

    if (!result.ok) throw unauthenticated('That email or password is not right.');

    await setSessionCookie(result.token);

    // Typed against the contract rather than assembled ad hoc: the screen reads
    // `mustVerifyEmail` to decide whether to send the person on for a code, and
    // it used to read a field this endpoint never sent.
    const body: SignInResponse = { status: 'signed-in', mustVerifyEmail: result.mustVerifyEmail };
    return json(body);
  },
);
