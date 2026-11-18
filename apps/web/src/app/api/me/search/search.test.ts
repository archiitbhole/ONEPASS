/**
 * The palette's search endpoint, and the one property it must never lose.
 *
 * A search box over somebody's tickets, receipts and trips is a pleasant feature
 * and a good way to build an accidental data leak: it touches five tables, it
 * takes free text, and the difference between "my receipts" and "receipts" is a
 * single `where` clause. So the first test here gives two people the same
 * searchable words and checks that each finds only their own — and the rest
 * cover the ways a scan like this goes wrong: wildcards typed into the pattern,
 * a query that is really a fishing expedition, and a caller with no session.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/client';
import * as t from '@/db/schema';
import {
  ensureReferenceData,
  resetDatabase,
  makeUser,
  makeOrg,
  makeVenue,
  addPlatformRole,
} from '@/test/factories';
import { ulid, publicRef } from '@/lib/ids';

/**
 * A cookie jar, because `getActor()` reads the session cookie through
 * `next/headers` and that store only exists inside a real Next request. The
 * session in it is genuine — minted by `issueSession`, resolved by
 * `resolveSession` — so the authorization under test is the real path, not a
 * stubbed one.
 */
const jar = new Map<string, string>();

vi.mock('next/headers', () => ({
  cookies: async () => ({
    set: (name: string, value: string) => void jar.set(name, value),
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    delete: (name: string) => void jar.delete(name),
  }),
}));

const { issueSession } = await import('@/lib/auth/session');
const { GET } = await import('./route');
const { getEnv } = await import('@/lib/env');

const noParams = { params: Promise.resolve({} as Record<string, string>) };
const ORIGIN = process.env.APP_URL ?? 'http://localhost:3000';

interface Hit {
  title: string;
  detail: string | null;
  where: string;
  href: string;
}

/**
 * Sign this user in for the calls that follow.
 *
 * Registration gives every account the CONSUMER role, which is what carries
 * `self.profile:read`; `makeUser` does not, so it is granted here. Without it
 * the endpoint refuses the caller — correctly, and in a way that would make this
 * file pass for the wrong reason if it were papered over.
 */
async function signedInAs(userId: string): Promise<void> {
  await addPlatformRole(userId, 'CONSUMER');
  const { token } = await issueSession({ userId });
  jar.set(getEnv().SESSION_COOKIE_NAME, token);
}

async function search(q: string) {
  const request = new Request(`${ORIGIN}/api/me/search?q=${encodeURIComponent(q)}`, {
    headers: { origin: ORIGIN },
  });
  const res = await (GET as unknown as (req: Request, ctx: typeof noParams) => Promise<Response>)(
    request,
    noParams,
  );
  return { status: res.status, body: (await res.json()) as { hits?: Hit[] } };
}

async function giveTicket(userId: string, organizationId: string, title: string) {
  const venueId = await makeVenue(organizationId, { name: 'Test Venue' });
  const bookingId = ulid();
  await db.insert(t.bookings).values({
    id: bookingId,
    publicRef: publicRef('bkg'),
    userId,
    organizationId,
    venueId,
    status: 'CONFIRMED',
    quantity: 1,
    listPriceMinor: 30000,
    amountMinor: 30000,
    startsAt: new Date(Date.now() + 3600_000),
  });
  const ticketId = ulid();
  const ref = publicRef('tkt');
  await db.insert(t.tickets).values({
    id: ticketId,
    publicRef: ref,
    bookingId,
    userId,
    organizationId,
    venueId,
    title,
    subtitle: 'Row F · 7:30 pm',
    validFrom: new Date(Date.now() + 3600_000),
  });
  return ref;
}

beforeAll(async () => {
  await ensureReferenceData();
});

beforeEach(async () => {
  await resetDatabase();
  jar.clear();
});

describe('searching your own things', () => {
  it('finds only the caller’s rows, never another person’s', async () => {
    const org = await makeOrg('Phoenix Cinemas');
    const mine = await makeUser({ name: 'Meera K' });
    const theirs = await makeUser({ name: 'Rahul N' });

    // The same words on both tickets: if the filter were missing, the search
    // would be the thing that found them both.
    const myRef = await giveTicket(mine.id, org, 'Sunday matinee');
    const theirRef = await giveTicket(theirs.id, org, 'Sunday matinee');

    await signedInAs(mine.id);
    const asMine = await search('matinee');
    expect(asMine.status).toBe(200);
    const hrefs = (asMine.body.hits ?? []).map((h) => h.href);
    expect(hrefs).toContain(`/tickets/${myRef}`);
    expect(hrefs).not.toContain(`/tickets/${theirRef}`);
    expect(hrefs).toHaveLength(1);

    // And the other way round, so this passes for a reason rather than because
    // the second row was never created.
    await signedInAs(theirs.id);
    const asTheirs = await search('matinee');
    const theirHrefs = (asTheirs.body.hits ?? []).map((h) => h.href);
    expect(theirHrefs).toEqual([`/tickets/${theirRef}`]);
  });

  it('treats a wildcard as text, not as a pattern', async () => {
    const org = await makeOrg('Phoenix Cinemas');
    const mine = await makeUser({ name: 'Meera K' });
    await giveTicket(mine.id, org, 'Sunday matinee');

    // `%` reaches the pattern escaped, so it matches a literal per cent sign —
    // of which there are none. Unescaped it would return everything, which is
    // how a search box becomes an export button.
    await signedInAs(mine.id);
    const res = await search('%');
    expect(res.status).toBe(422); // one character: under the minimum

    const res2 = await search('%%');
    expect(res2.status).toBe(200);
    expect(res2.body.hits).toHaveLength(0);

    // The underscore is the other LIKE metacharacter and matches any single
    // character when it is not escaped.
    const res3 = await search('_unday');
    expect(res3.status).toBe(200);
    expect(res3.body.hits).toHaveLength(0);
  });

  it('refuses a query too short to be a search', async () => {
    const mine = await makeUser({ name: 'Meera K' });
    await signedInAs(mine.id);
    const res = await search('a');
    expect(res.status).toBe(422);
  });

  it('refuses a caller without a session', async () => {
    const request = new Request(`${ORIGIN}/api/me/search?q=matinee`, { headers: { origin: ORIGIN } });
    const res = await (GET as unknown as (req: Request, ctx: typeof noParams) => Promise<Response>)(
      request,
      noParams,
    );
    expect(res.status).toBe(401);
  });

  it('returns a reference and a label, and nothing about money', async () => {
    const org = await makeOrg('Phoenix Cinemas');
    const mine = await makeUser({ name: 'Meera K' });
    await giveTicket(mine.id, org, 'Sunday matinee');

    await signedInAs(mine.id);
    const res = await search('matinee');
    const hit = (res.body.hits ?? [])[0]!;

    expect(hit.title).toBe('Sunday matinee');
    expect(hit.where).toBe('Ticket');
    expect(hit.href).toMatch(/^\/tickets\/tkt_/);
    // The palette is a way to reach a screen. Amounts, internal ids and anything
    // else the screen would ask its own questions about stay on the screen.
    expect(JSON.stringify(hit)).not.toMatch(/Minor|amount|"id"/i);
  });
});
