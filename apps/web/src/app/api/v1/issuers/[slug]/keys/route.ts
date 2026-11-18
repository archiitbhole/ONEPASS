/**
 * An issuer's signing keys, every version, public halves only.
 *
 * This is what makes "verify it yourself" true after a rotation. A credential
 * names the key that signed it (`issuer.keyId`); a verifier who does not want to
 * trust ONEPASS fetches this list once, finds that key, and checks the
 * signature locally. The status tells them whether to believe the result: a
 * RETIRED key's signatures are good, a REVOKED key's are not, whatever the
 * mathematics says.
 *
 * Public and anonymous on purpose — public keys that need a login to fetch are
 * not public keys. It answers only for approved issuers: a pending or rejected
 * organization has nothing it should be signing, and the same 404 covers "no
 * such issuer" so the endpoint is not a directory of applicants.
 */
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { organizations } from '@/db/schema';
import { json, route } from '@/lib/api';
import { publishedKeys } from '@/lib/credentials/keys';
import { notFound } from '@/lib/errors';

export const GET = route({ rateLimit: { name: 'pass:verify' }, loadActor: false }, async (ctx) => {
  const slug = ctx.params.slug ?? '';
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) throw notFound('Not found.');

  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, slug) });
  if (!org || org.status !== 'ACTIVE') throw notFound('Not found.');

  const keys = await publishedKeys(org.id);
  const res = json({ issuer: { slug: org.slug, name: org.name }, keys });
  // Keys change rarely and a verifier may fetch this per scan. Five minutes is
  // short enough that a revocation propagates within a coffee, long enough to
  // absorb a queue at a door.
  res.headers.set('cache-control', 'public, max-age=300');
  return res;
});
