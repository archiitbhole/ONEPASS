/**
 * Partner organizations, from the platform side.
 *
 * This is the queue an administrator reviews an application from, so it carries
 * what a review actually turns on — legal name, registration number, city, the
 * website, who last acted on it and when.
 *
 * ── Privacy by default ────────────────────────────────────────
 * The support address is masked like any other contact detail. An administrator's
 * job here is to decide whether a business is real, not to correspond with it from
 * the console, and defaulting to masked means there is no view in this API where
 * an address arrives in the clear. As everywhere in the admin surface, the
 * response is built field by field rather than by spreading the row.
 */
import { and, desc, eq, ilike, lt, or, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { organizations } from '@/db/schema';
import { json, paginate, route } from '@/lib/api';
import { authorize } from '@/lib/authz/authorize';
import { isUlid } from '@/lib/ids';

/** `support@hotel.in` → `s•••@hotel.in`. */
function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const at = email.indexOf('@');
  if (at <= 0) return '•••';
  return `${email.slice(0, 1)}•••${email.slice(at)}`;
}

const querySchema = z.object({
  q: z.string().trim().min(1).max(120).optional(),
  status: z.enum(['PENDING_REVIEW', 'ACTIVE', 'SUSPENDED', 'REJECTED']).optional(),
  kind: z.enum(['HOSPITALITY', 'RETAIL', 'ENTERTAINMENT', 'FINANCIAL_SERVICES', 'OTHER']).optional(),
  cursor: z.string().refine(isUlid, 'must be an id').optional(),
  /** Hard ceiling: a page is a page, whatever the caller asks for. */
  limit: z.coerce.number().int().min(1).max(100).optional(),
});


/** `%` and `_` are wildcards in LIKE; a search term is data, so they are escaped. */
function likeTerm(input: string): string {
  return `%${input.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

export const GET = route(
  {
    querySchema,
    rateLimit: { name: 'api:general', subject: (ctx) => ctx.actor?.userId ?? ctx.ip ?? 'anonymous' },
  },
  async ({ query, actor }) => {
    await authorize({ permission: 'platform.partner:read', actor: actor ?? undefined });

    const limit = query.limit ?? 25;
    const where: (SQL | undefined)[] = [];
    if (query.status) where.push(eq(organizations.status, query.status));
    if (query.kind) where.push(eq(organizations.kind, query.kind));
    if (query.q) {
      const term = likeTerm(query.q);
      where.push(
        or(
          isUlid(query.q) ? eq(organizations.id, query.q) : undefined,
          ilike(organizations.name, term),
          ilike(organizations.slug, term),
          ilike(organizations.legalName, term),
          ilike(organizations.registrationNo, term),
        ),
      );
    }
    // Ids are ULIDs, so newest-first is `id desc` and the cursor is `id <`.
    if (query.cursor) where.push(lt(organizations.id, query.cursor));

    const rows = await db
      .select({
        id: organizations.id,
        slug: organizations.slug,
        name: organizations.name,
        kind: organizations.kind,
        status: organizations.status,
        legalName: organizations.legalName,
        registrationNo: organizations.registrationNo,
        city: organizations.city,
        countryCode: organizations.countryCode,
        websiteUrl: organizations.websiteUrl,
        supportEmail: organizations.supportEmail,
        connectorKind: organizations.connectorKind,
        reviewedAt: organizations.reviewedAt,
        reviewedByUserId: organizations.reviewedByUserId,
        reviewNote: organizations.reviewNote,
        createdAt: organizations.createdAt,
        deletedAt: organizations.deletedAt,
      })
      .from(organizations)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(organizations.id))
      .limit(limit + 1);

    const page = paginate(rows, limit);

    return json({
      items: page.items.map((row) => ({
        id: row.id,
        slug: row.slug,
        name: row.name,
        kind: row.kind,
        status: row.status,
        legalName: row.legalName,
        registrationNo: row.registrationNo,
        city: row.city,
        countryCode: row.countryCode,
        websiteUrl: row.websiteUrl,
        supportEmail: maskEmail(row.supportEmail),
        connectorKind: row.connectorKind,
        reviewedAt: row.reviewedAt,
        reviewedByUserId: row.reviewedByUserId,
        reviewNote: row.reviewNote,
        createdAt: row.createdAt,
        deletedAt: row.deletedAt,
      })),
      nextCursor: page.nextCursor,
    });
  },
);
