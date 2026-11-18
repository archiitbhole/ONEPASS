/**
 * Platform-wide transactions.
 *
 * The only view in the system that crosses tenants, which is exactly why it is
 * gated on a platform permission that no partner role can ever hold: a
 * `partner.*` permission is computed per membership and is therefore incapable of
 * reaching this handler.
 *
 * What it returns is money and references, not people. A consumer's contact
 * details are not part of a reconciliation question, so they are not projected at
 * all here — the safest masking is the field you never select. Provider order and
 * payment ids are included because they are what a dispute is actually settled
 * with; they are references at the payment provider, not credentials, and the
 * schema deliberately holds nothing that could authorise a payment on its own.
 */
import { and, desc, eq, gte, lt, lte, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { organizations, transactions, userProfiles } from '@/db/schema';
import { json, paginate, route } from '@/lib/api';
import { authorize } from '@/lib/authz/authorize';
import { isUlid } from '@/lib/ids';
import { BRAND } from '@/lib/brand';

const ulidParam = z.string().refine(isUlid, 'must be an id');

const querySchema = z.object({
  organizationId: ulidParam.optional(),
  userId: ulidParam.optional(),
  status: z
    .enum(['INITIATED', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'REFUNDED', 'CANCELLED'])
    .optional(),
  provider: z.enum(['RAZORPAY', 'STRIPE', 'SANDBOX']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  cursor: ulidParam.optional(),
  /** Hard ceiling: a page is a page, whatever the caller asks for. */
  limit: z.coerce.number().int().min(1).max(100).optional(),
});


export const GET = route(
  {
    querySchema,
    rateLimit: { name: 'api:general', subject: (ctx) => ctx.actor?.userId ?? ctx.ip ?? 'anonymous' },
  },
  async ({ query, actor }) => {
    await authorize({ permission: 'platform.transaction:read', actor: actor ?? undefined });

    const limit = query.limit ?? 25;
    const where: (SQL | undefined)[] = [];
    if (query.organizationId) where.push(eq(transactions.organizationId, query.organizationId));
    if (query.userId) where.push(eq(transactions.userId, query.userId));
    if (query.status) where.push(eq(transactions.status, query.status));
    if (query.provider) where.push(eq(transactions.provider, query.provider));
    if (query.from) where.push(gte(transactions.createdAt, query.from));
    if (query.to) where.push(lte(transactions.createdAt, query.to));
    // Ids are ULIDs, so newest-first is `id desc` and the cursor is `id <`. No
    // offset, so a page cannot shift under a reader while payments are taken.
    if (query.cursor) where.push(lt(transactions.id, query.cursor));

    const rows = await db
      .select({
        id: transactions.id,
        status: transactions.status,
        amountMinor: transactions.amountMinor,
        currency: transactions.currency,
        description: transactions.description,
        provider: transactions.provider,
        providerOrderId: transactions.providerOrderId,
        providerPaymentId: transactions.providerPaymentId,
        failureCode: transactions.failureCode,
        createdAt: transactions.createdAt,
        capturedAt: transactions.capturedAt,
        organizationId: transactions.organizationId,
        organizationName: organizations.name,
        organizationSlug: organizations.slug,
        userId: transactions.userId,
        userDisplayName: userProfiles.displayName,
      })
      .from(transactions)
      .innerJoin(organizations, eq(organizations.id, transactions.organizationId))
      .leftJoin(userProfiles, eq(userProfiles.userId, transactions.userId))
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(transactions.id))
      .limit(limit + 1);

    const page = paginate(rows, limit);

    return json({
      items: page.items.map((row) => ({
        id: row.id,
        status: row.status,
        // Minor units all the way to the client. Money is never a float, and it is
        // not the API's business to guess which locale will render it.
        amountMinor: row.amountMinor,
        currency: row.currency,
        description: row.description,
        provider: row.provider,
        providerOrderId: row.providerOrderId,
        providerPaymentId: row.providerPaymentId,
        failureCode: row.failureCode,
        createdAt: row.createdAt,
        capturedAt: row.capturedAt,
        organization: { id: row.organizationId, name: row.organizationName, slug: row.organizationSlug },
        user: { id: row.userId, displayName: row.userDisplayName ?? BRAND.fallbackPersonName },
      })),
      nextCursor: page.nextCursor,
    });
  },
);
