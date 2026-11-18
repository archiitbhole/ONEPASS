/**
 * Mint the code the client draws as a QR.
 *
 * The response is a 30-second envelope, not the pass secret — the secret is sealed at
 * rest and opened only inside `mintPassToken`, so a captured response, a screenshot or
 * a leaked client bundle all expire within one window.
 *
 * No audit row per mint: minting changes nothing, it happens up to twice a minute
 * while a QR is on screen, and the presentation at a counter is the event that
 * actually deserves a record. Flooding the trail here would bury it.
 */
import { json, route } from '@/lib/api';
import { authorize } from '@/lib/authz/authorize';
import { mintPassToken } from '@/lib/pass/service';

export const GET = route(
  {
    // Per person rather than per address: a hotel lobby behind one NAT is a normal
    // place to open a pass, and one guest must not exhaust the others' budget.
    rateLimit: { name: 'pass:mint', subject: (ctx) => ctx.actor?.userId ?? ctx.ip ?? 'anonymous' },
  },
  async (ctx) => {
    const { actor } = await authorize({ permission: 'self.pass:read', actor: ctx.actor ?? undefined });

    const minted = await mintPassToken(actor.userId);

    return json({
      passRef: minted.passRef,
      token: minted.token,
      expiresInSeconds: minted.expiresInSeconds,
      stepSeconds: minted.stepSeconds,
    });
  },
);
