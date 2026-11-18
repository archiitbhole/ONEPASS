/**
 * The isolation layer is actually in the database the tests run against.
 *
 * `drizzle-kit push` removes what `schema.ts` does not declare, and the
 * row-level-security policies and `business_customer_view` are declared in
 * `isolation.sql` instead. A bare push therefore dropped all of them — 34
 * policies to 0 — and every test that followed passed, against a database with
 * no tenant isolation at all. `npm run db:push` now re-applies the layer; this
 * test is the tripwire for any path that forgets to.
 */
import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';

describe('the isolation layer', () => {
  it('has row-level security on the relationship tables', async () => {
    const rows = await db.execute<{ relname: string; relrowsecurity: boolean }>(sql`
      select relname, relrowsecurity from pg_class
       where relname in ('bookings', 'tickets', 'receipts', 'transactions')
    `);
    const list = rows as unknown as { relname: string; relrowsecurity: boolean }[];
    expect(list).toHaveLength(4);
    for (const row of list) expect(row.relrowsecurity, row.relname).toBe(true);
  });

  it('has its policies and the consented customer view', async () => {
    const [policies] = (await db.execute<{ n: number }>(
      sql`select count(*)::int as n from pg_policies where schemaname = 'public'`,
    )) as unknown as { n: number }[];
    const [views] = (await db.execute<{ n: number }>(
      sql`select count(*)::int as n from pg_views where viewname = 'business_customer_view'`,
    )) as unknown as { n: number }[];
    expect(policies!.n).toBeGreaterThan(0);
    expect(views!.n).toBe(1);
  });
});
