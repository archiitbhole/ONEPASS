/**
 * Step-up: confirm the password on a session that is already signed in.
 *
 * The answer to REAUTH_REQUIRED. Elevation lasts `SESSION_ELEVATION_MINUTES`
 * and applies to this session only — another device signed in to the same
 * account is not elevated by it.
 *
 * Rate limited per user rather than per address: the caller is already
 * identified by their session, so a per-IP budget would only let somebody at an
 * unlocked laptop keep guessing from behind a VPN.
 */
import { json, route } from '@/lib/api';
import { stepUpBody, type StepUpResponse } from '@/lib/auth/contracts';
import { stepUp } from '@/lib/auth/flows';
import { unauthenticated } from '@/lib/errors';

export const POST = route(
  {
    bodySchema: stepUpBody,
    rateLimit: { name: 'auth:step-up', subject: (ctx) => ctx.actor?.userId ?? ctx.ip ?? 'anonymous' },
  },
  async (ctx) => {
    if (!ctx.actor) throw unauthenticated('Sign in to continue.');

    const { elevatedUntil } = await stepUp({
      userId: ctx.actor.userId,
      sessionId: ctx.actor.session.sessionId,
      password: ctx.body.password,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
    });

    const body: StepUpResponse = { status: 'elevated', elevatedUntil: elevatedUntil.toISOString() };
    return json(body);
  },
);
