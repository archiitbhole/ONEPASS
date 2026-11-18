/**
 * Domain-scoped database connections.
 *
 * `client.ts` exposes one pool for migrations, seeding and tests. This module
 * exposes the three that application code should actually use, each connecting
 * as its own PostgreSQL role with only the grants that domain needs (see
 * ./isolation.sql, and ./tests/isolation.sql for the proof).
 *
 * The point is what happens when application code is wrong. `authorize()`
 * already filters every partner query by organization id and has adversarial
 * tests behind it — but a filter that has to be remembered is a filter that can
 * be forgotten, and an injection has no obligation to remember it at all. On a
 * business connection, `SELECT * FROM users` does not return a filtered result:
 * it returns `permission denied for table users`, because the role holds no
 * grant on that table. The boundary sits below the code that could get it wrong.
 *
 * Deployment: three URLs, three passwords, three roles. Set them and the
 * separation is live. Leave them unset and everything falls back to the single
 * connection, which is correct for local development and for the test suite,
 * and is reported as such by `isolationStatus()` rather than being quietly
 * assumed.
 */
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { getEnv } from '@/lib/env';
import * as schema from './schema';

export type Domain = 'consumer' | 'business' | 'platform';

const pools = new Map<Domain, ReturnType<typeof postgres>>();
const handles = new Map<Domain, ReturnType<typeof drizzle<typeof schema>>>();

/**
 * The connection string for a domain, or the shared one when no separate role
 * has been configured. Never throws: an unconfigured deployment must still run,
 * it must simply not claim an isolation it does not have.
 */
function urlFor(domain: Domain): { url: string; separated: boolean } {
  const env = getEnv();
  const specific =
    domain === 'consumer'
      ? process.env.DATABASE_URL_CONSUMER
      : domain === 'business'
        ? process.env.DATABASE_URL_BUSINESS
        : process.env.DATABASE_URL_PLATFORM;

  return specific ? { url: specific, separated: true } : { url: env.DATABASE_URL, separated: false };
}

function poolFor(domain: Domain): ReturnType<typeof postgres> {
  const existing = pools.get(domain);
  if (existing) return existing;

  const env = getEnv();
  const { url } = urlFor(domain);
  const pool = postgres(url, {
    // Each domain gets a slice of the budget rather than the whole of it, so a
    // burst of consumer traffic cannot starve the partner console.
    max: Math.max(2, Math.floor(env.DATABASE_POOL_MAX / 3)),
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
    onnotice: () => {},
  });
  pools.set(domain, pool);
  return pool;
}

export function dbFor(domain: Domain): ReturnType<typeof drizzle<typeof schema>> {
  const existing = handles.get(domain);
  if (existing) return existing;
  const handle = drizzle(poolFor(domain), { schema });
  handles.set(domain, handle);
  return handle;
}

/**
 * Run a partner query with the tenant pinned for the duration.
 *
 * `set_config(..., true)` is transaction-local, so the setting is discarded at
 * commit. That matters more than it looks with a pooled connection: a
 * session-level setting would survive the request and be inherited by whoever
 * picked the connection up next, which is a cross-tenant leak with a very quiet
 * failure mode. Transaction-local means the worst case is *no* tenant, and the
 * policies fail closed on that.
 *
 * Callers pass the organization id that `authorize()` returned — never one taken
 * from the URL or the request body. The policy is the second lock, not the first.
 */
export async function withTenant<T>(
  organizationId: string,
  fn: (tx: Parameters<Parameters<ReturnType<typeof dbFor>['transaction']>[0]>[0]) => Promise<T>,
): Promise<T> {
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(organizationId)) {
    // A malformed id must not reach set_config. Postgres would accept it and the
    // policy would simply match nothing, which is safe — but it would also hide
    // the bug, and a tenant id that is not a ULID means something upstream is
    // passing user input where an authorization result belongs.
    throw new Error('withTenant requires a ULID organization id from authorize()');
  }

  return dbFor('business').transaction(async (tx) => {
    await tx.execute(
      // Parameterised: the id is a value, never interpolated into SQL text.
      sql`select set_config('app.organization_id', ${organizationId}, true)`,
    );
    return fn(tx);
  });
}

export interface IsolationStatus {
  separated: boolean;
  domains: Record<Domain, { configured: boolean; role: string }>;
  note: string;
}

/**
 * What isolation is actually in force right now.
 *
 * Exposed on the admin health endpoint so the answer to "are the three domains
 * separated?" is read from the running process rather than from a document that
 * was true when it was written.
 */
export function isolationStatus(): IsolationStatus {
  const consumer = urlFor('consumer').separated;
  const business = urlFor('business').separated;
  const platform = urlFor('platform').separated;
  const separated = consumer && business && platform;

  return {
    separated,
    domains: {
      consumer: { configured: consumer, role: 'onepass_consumer' },
      business: { configured: business, role: 'onepass_business' },
      platform: { configured: platform, role: 'onepass_admin' },
    },
    note: separated
      ? 'Each domain connects as its own least-privilege role; cross-domain reads fail at the database.'
      : 'Domain URLs are not set, so all three share one connection. Row-level security still applies where the role has it, but grant-level separation is NOT in force. Set DATABASE_URL_CONSUMER, DATABASE_URL_BUSINESS and DATABASE_URL_PLATFORM to enable it.',
  };
}

export async function closeDomainPools(): Promise<void> {
  await Promise.all([...pools.values()].map((p) => p.end({ timeout: 5 })));
  pools.clear();
  handles.clear();
}
