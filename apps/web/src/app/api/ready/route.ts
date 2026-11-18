/**
 * Readiness.
 *
 * "Should this instance receive traffic right now" — which, unlike liveness, does
 * depend on the things a request needs: Postgres for every read, Redis for shared
 * rate-limit and realtime state. A failing readiness check pulls the instance out
 * of the load balancer; it does not restart it.
 *
 * It is public, so the body is a verdict and nothing else: two words, no driver
 * error, no host name, no connection string, no timing. An unauthenticated caller
 * learns whether the service is taking traffic — which they would learn anyway by
 * sending a request — and nothing about the shape of the deployment behind it.
 */
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { json, route } from '@/lib/api';
import { redis } from '@/lib/redis';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** A probe that can hang is not a probe: a stuck check must read as "down". */
const PROBE_TIMEOUT_MS = 1500;

function withTimeout<T>(work: PromiseLike<T>): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), PROBE_TIMEOUT_MS);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      // The rejection reason is deliberately dropped rather than reported.
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

async function databaseState(): Promise<'up' | 'down'> {
  const result = await withTimeout(db.execute(sql`select 1`));
  return result === null ? 'down' : 'up';
}

async function redisState(): Promise<'up' | 'down' | 'not-configured'> {
  const client = redis();
  if (!client) return 'not-configured';
  const pong = await withTimeout(client.ping());
  return pong === null ? 'down' : 'up';
}

export const GET = route({ loadActor: false }, async () => {
  const [database, cache] = await Promise.all([databaseState(), redisState()]);

  // 'not-configured' is only reachable outside production: env.ts refuses to boot
  // production without REDIS_URL, because per-instance rate limits and realtime
  // fan-out are wrong. Locally, running on Postgres alone is a supported setup and
  // must not hold the instance out of rotation.
  const ready = database === 'up' && cache !== 'down';

  return json(
    { database, redis: cache },
    { status: ready ? 200 : 503, headers: { 'cache-control': 'no-store' } },
  );
});
