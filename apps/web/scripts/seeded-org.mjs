/**
 * The seeded hotel's id, read from the database rather than written down.
 *
 * It was written down — the same ULID in the responsive sweep and the
 * accessibility audit — which is correct on the machine that produced it and
 * wrong everywhere else, because a fresh seed mints fresh ULIDs. A clean-room
 * rebuild therefore audited the partner console's 404 page: the accessibility
 * run crashed on a field that never appeared, and the responsive sweep quietly
 * passed, since a 404 page has no horizontal overflow to find.
 *
 * `e2e/global-setup.ts` has always resolved it this way. These scripts now do
 * too, so there is one answer to "which organization" instead of three.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import postgres from 'postgres';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Resolve it, or return null so a caller can skip those pages rather than die. */
export async function seededOrgId(slugLike = 'grand-sahyadri%') {
  if (process.env.ONEPASS_AUDIT_ORG) return process.env.ONEPASS_AUDIT_ORG;

  loadEnv({ path: path.resolve(here, '..', '.env') });
  const url = process.env.DATABASE_URL;
  if (!url) return null;

  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const rows = await sql`select id from organizations where slug like ${slugLike} limit 1`;
    return rows[0]?.id?.trim() ?? null;
  } catch {
    return null;
  } finally {
    await sql.end({ timeout: 5 });
  }
}
