/**
 * Request a fresh code. Rate limited on the destination as well as the IP, so one
 * address cannot be used to spam a person from many sources.
 */
import { route, json } from '@/lib/api';
import { otpBody } from '@/lib/auth/contracts';
import { issueOtp, normaliseDestination } from '@/lib/auth/otp';
import { consume } from '@/lib/ratelimit';
import { rateLimited } from '@/lib/errors';

export const POST = route(
  { bodySchema: otpBody, rateLimit: { name: 'auth:otp:request' }, loadActor: false },
  async (ctx) => {
    const channel = ctx.body.destination.includes('@') ? 'EMAIL' : 'SMS';
    const destination = normaliseDestination(channel, ctx.body.destination);

    const perDestination = await consume('auth:otp:request', `dest:${destination}`);
    if (!perDestination.ok) {
      throw rateLimited(`Too many codes requested. Try again in ${perDestination.resetSeconds} seconds.`);
    }

    await issueOtp({ purpose: ctx.body.purpose, channel, destination, ip: ctx.ip });
    // Same answer whether or not that destination belongs to anyone.
    return json({ status: 'sent' }, { status: 202 });
  },
);
