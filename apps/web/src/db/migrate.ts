/**
 * Applies pending SQL migrations. Deliberately a separate command from the build:
 * a production migration is a decision someone makes, not a side effect of a deploy.
 */
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

async function main() {
  const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL (or DIRECT_DATABASE_URL) is required to migrate.');

  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(client), { migrationsFolder: './drizzle' });
    console.log('migrations applied');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('migration failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
