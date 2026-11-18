/**
 * The database handle.
 *
 * One pool per process, cached across Next.js hot reloads so development does not
 * exhaust Postgres connections. `prepare: false` keeps this safe behind a
 * transaction-mode pooler such as PgBouncer or Supabase's, which is how this will
 * be deployed.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { getEnv } from '@/lib/env';
import * as schema from './schema';

const globalForDb = globalThis as unknown as {
  __onepassSql?: ReturnType<typeof postgres>;
};

/**
 * Whether this connection should insist on TLS.
 *
 * A managed Postgres — Neon, Supabase, RDS, Aiven — is reached across the public
 * internet, and `postgres.js` only negotiates TLS when the connection string
 * says so. A URL pasted without `?sslmode=require`, which is how most of them are
 * copied out of a dashboard, therefore connects in the clear: every query, every
 * session token, every row, readable by anything on the path. Nothing warns you,
 * because it works.
 *
 * So in production TLS is the default and the URL has to opt out of it, rather
 * than the other way round. A local socket or a container-network host is left
 * alone — that traffic never leaves the machine or the private network, and
 * requiring TLS there would refuse a perfectly good `docker compose` stack.
 */
function shouldRequireTls(url: string): boolean {
  if (process.env.NODE_ENV !== 'production') return false;
  try {
    const parsed = new URL(url);
    // An explicit choice in the URL always wins, in either direction.
    if (parsed.searchParams.has('sslmode') || parsed.searchParams.has('ssl')) return false;
    const host = parsed.hostname;
    const isLocal =
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host === 'postgres' || // the service name inside docker compose
      host === 'db' ||
      host.endsWith('.internal') || // Fly, Railway private networking
      host.endsWith('.local');
    return !isLocal;
  } catch {
    return false;
  }
}

function createClient() {
  const env = getEnv();
  const requireTls = shouldRequireTls(env.DATABASE_URL);
  return postgres(env.DATABASE_URL, {
    max: env.DATABASE_POOL_MAX,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
    // 'require' encrypts without demanding a chain we can verify. Managed
    // providers commonly present a certificate signed by their own root, and
    // failing closed on verification would refuse the very databases this is
    // for; encrypted-but-unverified is the trade every Postgres client makes
    // here, and it is still the difference between ciphertext and plaintext.
    ...(requireTls ? { ssl: 'require' as const } : {}),
    onnotice: () => {},
  });
}

/**
 * Connect on first use, not on import.
 *
 * Next walks the module graph at build time to collect page data; a pool opened
 * at import would try to reach Postgres from a build machine that has no reason
 * to have it. It also keeps serverless cold starts honest — a request that never
 * touches the database never opens a connection.
 */
function client(): ReturnType<typeof postgres> {
  if (!globalForDb.__onepassSql) globalForDb.__onepassSql = createClient();
  return globalForDb.__onepassSql;
}

// The proxy target must be callable: postgres.js is used as a tagged template
// (sql`select 1`), and a Proxy's apply trap only fires when the target is a
// function. An object target silently breaks every template literal.
export const sql = new Proxy(function noop() {} as unknown as ReturnType<typeof postgres>, {
  get: (_t, prop, receiver) => Reflect.get(client() as object, prop, receiver),
  apply: (_t, thisArg, args) => Reflect.apply(client() as never, thisArg, args as never),
}) as ReturnType<typeof postgres>;

let cachedDb: ReturnType<typeof drizzle<typeof schema>> | null = null;
export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get: (_t, prop, receiver) => {
    if (!cachedDb) cachedDb = drizzle(client(), { schema });
    return Reflect.get(cachedDb as object, prop, receiver);
  },
});
export type Db = ReturnType<typeof drizzle<typeof schema>>;
export type DbOrTx = Db | Parameters<Parameters<Db['transaction']>[0]>[0];
export { schema };
