/**
 * The platform user directory: search and list.
 *
 * ── Privacy by default ────────────────────────────────────────
 * Contact details go out masked. An administrator's job — approving a partner,
 * investigating a security event, suspending an account that is being abused —
 * does not require reading a consumer's email address or mobile number, so the
 * masked form is the only form this API produces. There is no query parameter
 * that unmasks it, because a switch that turns privacy off is a switch that gets
 * turned off.
 *
 * Searching by an address is still allowed: support is handed the value by the
 * person on the phone, and confirming a value you already hold is a different act
 * from being given the directory. The term itself is not written to the audit
 * trail, only the fact that a targeted lookup happened — an append-only log is
 * the last place to accumulate email addresses.
 *
 * Nothing here spreads a row. `passwordHash`, `sessionGeneration` and
 * `mfaSecretCipher` live on the same table as `displayName`, and the only defence
 * that survives a schema change is naming every field on the way out.
 */
import { and, desc, eq, ilike, lt, or, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { userProfiles, users } from '@/db/schema';
import { json, paginate, route } from '@/lib/api';
import { recordAudit } from '@/lib/audit';
import { authorize } from '@/lib/authz/authorize';
import { isUlid } from '@/lib/ids';
import { BRAND } from '@/lib/brand';

/** `meera@example.in` → `m•••@example.in`. The domain is kept: it is a routing
 *  detail, not an identifier, and support needs to see which provider is involved. */
function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const at = email.indexOf('@');
  if (at <= 0) return '•••';
  return `${email.slice(0, 1)}•••${email.slice(at)}`;
}

/** `+919876543201` → `+91 98•• ••01`. Enough to confirm a number someone read
 *  out, never enough to dial one that was not already known. */
function maskMobile(mobile: string | null): string | null {
  if (!mobile) return null;
  const digits = mobile.replace(/\D/g, '');
  if (digits.length < 6) return '•••• ••••';
  const local = digits.slice(-10);
  const country = digits.slice(0, digits.length - local.length);
  return `${country ? `+${country} ` : ''}${local.slice(0, 2)}•• ••${local.slice(-2)}`;
}

const querySchema = z.object({
  q: z.string().trim().min(1).max(120).optional(),
  status: z
    .enum(['PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED', 'DELETION_PENDING'])
    .optional(),
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
    rateLimit: { name: 'admin:sensitive', subject: (ctx) => ctx.actor?.userId ?? ctx.ip ?? 'anonymous' },
  },
  async ({ query, actor, requestId, ip, userAgent }) => {
    const auth = await authorize({ permission: 'platform.user:read', actor: actor ?? undefined });

    const limit = query.limit ?? 25;
    const where: (SQL | undefined)[] = [];
    if (query.status) where.push(eq(users.status, query.status));
    if (query.q) {
      const term = likeTerm(query.q);
      where.push(
        or(
          // An exact id is the common case from a support ticket or an audit row.
          isUlid(query.q) ? eq(users.id, query.q) : undefined,
          ilike(users.email, term),
          ilike(users.mobile, term),
          ilike(userProfiles.displayName, term),
        ),
      );
    }
    // Ids are ULIDs, so newest-first is `id desc` and the cursor is `id <`. No
    // offset, so a page cannot shift under a reader while accounts are created.
    if (query.cursor) where.push(lt(users.id, query.cursor));

    const rows = await db
      .select({
        id: users.id,
        status: users.status,
        email: users.email,
        mobile: users.mobile,
        emailVerifiedAt: users.emailVerifiedAt,
        mobileVerifiedAt: users.mobileVerifiedAt,
        isPlatformStaff: users.isPlatformStaff,
        mfaEnabled: users.mfaEnabled,
        lockedUntil: users.lockedUntil,
        lastLoginAt: users.lastLoginAt,
        createdAt: users.createdAt,
        displayName: userProfiles.displayName,
      })
      .from(users)
      .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(users.id))
      .limit(limit + 1);

    const page = paginate(rows, limit);

    // Paging through the directory is routine; looking a specific person up is the
    // act worth being able to review afterwards, so only that is recorded.
    if (query.q) {
      await recordAudit({
        action: 'platform.user.search',
        targetType: 'user',
        result: 'SUCCESS',
        actorUserId: auth.actor.userId,
        actorRole: auth.actorRole,
        requestId,
        ip,
        userAgent,
        // The term is a contact detail more often than not; only its shape is kept.
        metadata: { matched: page.items.length, byId: isUlid(query.q), status: query.status ?? null },
      });
    }

    return json({
      items: page.items.map((row) => ({
        id: row.id,
        status: row.status,
        displayName: row.displayName ?? BRAND.fallbackPersonName,
        email: maskEmail(row.email),
        mobile: maskMobile(row.mobile),
        emailVerified: row.emailVerifiedAt !== null,
        mobileVerified: row.mobileVerifiedAt !== null,
        mfaEnabled: row.mfaEnabled,
        isPlatformStaff: row.isPlatformStaff,
        lockedUntil: row.lockedUntil,
        lastLoginAt: row.lastLoginAt,
        createdAt: row.createdAt,
      })),
      nextCursor: page.nextCursor,
    });
  },
);
