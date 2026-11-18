/**
 * Notification preferences — the write half, and the one switch that will not move.
 *
 * The rule worth a test is not "a boolean round-trips". It is that the SECURITY
 * category is refused, that the refusal is audited rather than silently
 * swallowed, and that an upsert keyed on (user, category, channel) can only ever
 * reach the caller's own row — the three things a future refactor of this
 * endpoint could plausibly break without anybody noticing.
 *
 * Everything goes through the real route handler with the body the switch posts,
 * so the permission, the strict schema and the error envelope are under test too.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import * as t from '@/db/schema';
import {
  addPlatformRole,
  clearRateLimits,
  ensureReferenceData,
  makeUser,
  resetDatabase,
} from '@/test/factories';

const jar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    set: (name: string, value: string) => void jar.set(name, value),
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    delete: (name: string) => void jar.delete(name),
  }),
}));

const { issueSession } = await import('@/lib/auth/session');
const { getEnv } = await import('@/lib/env');
const { PATCH: patchRoute, GET: getRoute } = await import('./route');

const ORIGIN = process.env.APP_URL ?? 'http://localhost:3000';
type Handler = (r: Request, c: unknown) => Promise<Response>;

async function setPreference(body: unknown) {
  const res = await (patchRoute as unknown as Handler)(
    new Request(`${ORIGIN}/api/me/notifications/preferences`, {
      method: 'PATCH',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    {},
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function listPreferences() {
  const res = await (getRoute as unknown as Handler)(
    new Request(`${ORIGIN}/api/me/notifications/preferences`, { headers: { origin: ORIGIN } }),
    {},
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function signIn(userId: string) {
  await addPlatformRole(userId, 'CONSUMER');
  const { token } = await issueSession({ userId });
  jar.set(getEnv().SESSION_COOKIE_NAME, token);
}

beforeAll(async () => {
  await ensureReferenceData();
});
beforeEach(async () => {
  await resetDatabase();
  await clearRateLimits();
  jar.clear();
});

describe('PATCH /api/me/notifications/preferences', () => {
  it('creates a row for a channel registration never wrote', async () => {
    const user = await makeUser({ name: 'Meera' });
    await signIn(user.id);

    const res = await setPreference({ category: 'PARTNER', channel: 'EMAIL', enabled: true });
    expect(res.status).toBe(200);
    expect(res.body.preference).toMatchObject({ category: 'PARTNER', channel: 'EMAIL', enabled: true });

    const rows = await db
      .select()
      .from(t.notificationPreferences)
      .where(
        and(
          eq(t.notificationPreferences.userId, user.id),
          eq(t.notificationPreferences.category, 'PARTNER'),
          eq(t.notificationPreferences.channel, 'EMAIL'),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.enabled).toBe(true);
  });

  it('updates rather than duplicates when the same switch moves twice', async () => {
    const user = await makeUser({ name: 'Meera' });
    await signIn(user.id);

    await setPreference({ category: 'PARTNER', channel: 'IN_APP', enabled: false });
    await setPreference({ category: 'PARTNER', channel: 'IN_APP', enabled: true });

    const rows = await db
      .select()
      .from(t.notificationPreferences)
      .where(
        and(
          eq(t.notificationPreferences.userId, user.id),
          eq(t.notificationPreferences.category, 'PARTNER'),
          eq(t.notificationPreferences.channel, 'IN_APP'),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.enabled).toBe(true);
  });

  it('refuses to silence security notices, and records the attempt', async () => {
    const user = await makeUser({ name: 'Meera' });
    await signIn(user.id);

    const res = await setPreference({ category: 'SECURITY', channel: 'IN_APP', enabled: false });
    expect(res.status).toBe(422);
    const error = res.body.error as { message: string };
    expect(error.message).toMatch(/cannot be switched off/i);

    const audits = await db
      .select()
      .from(t.auditLogs)
      .where(eq(t.auditLogs.action, 'self.notification.preference'));
    expect(audits).toHaveLength(1);
    expect(audits[0]?.result).toBe('FAILED');

    const rows = await db
      .select()
      .from(t.notificationPreferences)
      .where(
        and(
          eq(t.notificationPreferences.userId, user.id),
          eq(t.notificationPreferences.category, 'SECURITY'),
        ),
      );
    for (const row of rows) expect(row.enabled).toBe(true);
  });

  it('still allows security notices to be switched back on', async () => {
    const user = await makeUser({ name: 'Meera' });
    await signIn(user.id);
    const res = await setPreference({ category: 'SECURITY', channel: 'EMAIL', enabled: true });
    expect(res.status).toBe(200);
  });

  it('rejects a field the endpoint did not agree to', async () => {
    const user = await makeUser({ name: 'Meera' });
    await signIn(user.id);
    const res = await setPreference({ category: 'PARTNER', channel: 'IN_APP', enabled: true, userId: 'someone-else' });
    expect(res.status).toBe(422);
  });

  it('never touches another account’s row', async () => {
    const mine = await makeUser({ name: 'Meera' });
    const theirs = await makeUser({ name: 'Rahul' });
    await db.insert(t.notificationPreferences).values({
      id: '01JPREFOTHER00000000000001',
      userId: theirs.id,
      category: 'PARTNER',
      channel: 'IN_APP',
      enabled: true,
      updatedAt: new Date(),
    });
    await signIn(mine.id);

    await setPreference({ category: 'PARTNER', channel: 'IN_APP', enabled: false });

    const other = await db
      .select()
      .from(t.notificationPreferences)
      .where(eq(t.notificationPreferences.id, '01JPREFOTHER00000000000001'));
    expect(other[0]?.enabled).toBe(true);
  });

  it('answers 401 when nobody is signed in', async () => {
    const res = await setPreference({ category: 'PARTNER', channel: 'IN_APP', enabled: true });
    expect(res.status).toBe(401);
  });

  it('refuses a category the enum has never heard of', async () => {
    const user = await makeUser({ name: 'Meera' });
    await signIn(user.id);
    const res = await setPreference({ category: 'MARKETING', channel: 'IN_APP', enabled: true });
    expect(res.status).toBe(422);
  });
});

describe('GET /api/me/notifications/preferences', () => {
  it('returns only the caller’s rows and names what cannot be switched off', async () => {
    const mine = await makeUser({ name: 'Meera' });
    const theirs = await makeUser({ name: 'Rahul' });
    await db.insert(t.notificationPreferences).values({
      id: '01JPREFOTHER00000000000002',
      userId: theirs.id,
      category: 'PARTNER',
      channel: 'IN_APP',
      enabled: false,
      updatedAt: new Date(),
    });
    await signIn(mine.id);
    await setPreference({ category: 'PRODUCT', channel: 'IN_APP', enabled: false });

    const res = await listPreferences();
    expect(res.status).toBe(200);
    const items = res.body.items as { category: string; enabled: boolean }[];
    expect(items.some((i) => i.category === 'PRODUCT' && i.enabled === false)).toBe(true);
    expect(items).toHaveLength(1);
    expect(res.body.alwaysOn).toEqual(['SECURITY']);
  });
});
