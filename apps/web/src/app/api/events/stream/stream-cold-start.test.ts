/**
 * The stream does not say it is open until it can actually hear.
 *
 * The bug this exists for is narrow and was real: `subscribe()` attaches a
 * local listener straight away, but nothing reaches it until the process has
 * issued its Redis `psubscribe`. A stream opened in the first moments after a
 * deploy could therefore say "open" and then miss an event published while that
 * subscription was still in flight — a screen that silently never moves, which
 * is the worst failure mode this system has.
 *
 * **How this is tested, and why not the obvious way.** Publishing an event and
 * waiting for it does not reproduce the window: the subscriber is process-wide
 * and, by the time any test runs, long since armed — so that test passes
 * whichever order the handler uses, and a test that cannot fail on the old code
 * protects nothing. Instead `realtimeReady()` is made deliberately slow, and
 * the assertion is that nothing claiming the stream is open appears before it
 * resolves. That is the ordering the fix is, stated directly.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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

/** How long the fake subscription takes to arm. Long enough to be unmistakable. */
const READY_MS = 400;
const timeline: { what: string; at: number }[] = [];
const started = Date.now();
const mark = (what: string) => void timeline.push({ what, at: Date.now() - started });

vi.mock('@/lib/realtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/realtime')>();
  return {
    ...actual,
    // Nothing else in this file needs the publisher, and starting it would make
    // the test depend on the outbox draining.
    startOutboxPublisher: () => {},
    realtimeReady: async () => {
      await new Promise((resolve) => setTimeout(resolve, READY_MS));
      mark('ready');
    },
    subscribe: (channels: string[], handler: (m: unknown) => void) => {
      mark('subscribe');
      return actual.subscribe(channels, handler as never);
    },
  };
});

const { issueSession } = await import('@/lib/auth/session');
const { getEnv } = await import('@/lib/env');
const { GET: streamRoute } = await import('./route');

const ORIGIN = process.env.APP_URL ?? 'http://localhost:3000';

beforeAll(async () => {
  await ensureReferenceData();
});
beforeEach(async () => {
  await resetDatabase();
  await clearRateLimits();
  jar.clear();
  timeline.length = 0;
});

async function signedInStream(signal: AbortSignal) {
  const user = await makeUser({ name: 'Meera' });
  await addPlatformRole(user.id, 'CONSUMER');
  const { token } = await issueSession({ userId: user.id });
  jar.set(getEnv().SESSION_COOKIE_NAME, token);
  // `signal` is a getter on Request, so it is supplied the way the platform
  // supplies it: to the constructor.
  return streamRoute(new Request(`${ORIGIN}/api/events/stream`, { signal }) as never);
}

describe('GET /api/events/stream', () => {
  it('refuses a caller with no session', async () => {
    const res = await streamRoute(new Request(`${ORIGIN}/api/events/stream`) as never);
    expect(res.status).toBe(401);
  });

  it('does not say it is open until the subscription is established', async () => {
    const controller = new AbortController();
    const res = await signedInStream(controller.signal);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    try {
      let seen = '';
      // Read until the open comment, recording when it arrived.
      for (let i = 0; i < 20; i++) {
        const { value, done } = await reader.read();
        if (done) break;
        seen += decoder.decode(value, { stream: true });
        if (seen.includes('stream open')) {
          mark('open');
          break;
        }
      }
      expect(seen).toContain('stream open');

      const at = (what: string) => timeline.find((e) => e.what === what)?.at;
      // The whole claim, in one line: the subscription was armed first.
      expect(at('ready')).toBeDefined();
      expect(at('subscribe')).toBeDefined();
      expect(at('open')!).toBeGreaterThanOrEqual(at('ready')!);
      expect(at('subscribe')!).toBeGreaterThanOrEqual(at('ready')!);

      // And the retry hint still goes out immediately, because a client that
      // loses the connection during the wait needs to know when to come back.
      expect(seen).toContain('retry: 3000');
    } finally {
      controller.abort();
      await reader.cancel().catch(() => {});
    }
  });

  it('gives up cleanly when the client goes away while the subscription is arming', async () => {
    const controller = new AbortController();
    const res = await signedInStream(controller.signal);
    const reader = res.body!.getReader();

    // Abort well inside the arming window.
    setTimeout(() => controller.abort(), READY_MS / 4);

    // The stream closes rather than throwing or hanging: `read()` resolves done.
    const deadline = Date.now() + 5000;
    let done = false;
    while (Date.now() < deadline && !done) {
      const chunk = await reader.read().catch(() => ({ done: true, value: undefined }));
      done = chunk.done === true;
    }
    expect(done).toBe(true);
  });
});
