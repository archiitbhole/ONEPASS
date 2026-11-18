/**
 * One user, seen from the platform side: read, suspend, restore.
 *
 * ── Privacy by default ────────────────────────────────────────
 * Contact details go out masked here too. An administrator's job — investigating
 * abuse, answering a support ticket, suspending an account — does not require
 * reading a consumer's email address or mobile number, so the masked form is the
 * only form this API produces, and there is no parameter that unmasks it. What an
 * administrator does need is whether a factor is *verified*, which is a boolean
 * and is given plainly.
 *
 * Every field is named on the way out. `passwordHash`, `sessionGeneration` and
 * `mfaSecretCipher` sit on the same row as `status`, and the only defence that
 * survives someone adding a column is refusing to spread the row.
 */
import { and, count, eq, gt, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { organizationMembers, organizations, sessions, userProfiles, users } from '@/db/schema';
import { json, route } from '@/lib/api';
import { notify, recordAudit } from '@/lib/audit';
import { authorize } from '@/lib/authz/authorize';
import { revokeAllSessions } from '@/lib/auth/session';
import { conflict, notFound } from '@/lib/errors';
import { isUlid } from '@/lib/ids';
import { BRAND } from '@/lib/brand';

/** `meera@example.in` → `m•••@example.in`; the domain is a routing detail, not an identifier. */
function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const at = email.indexOf('@');
  if (at <= 0) return '•••';
  return `${email.slice(0, 1)}•••${email.slice(at)}`;
}

/** `+919876543201` → `+91 98•• ••01`: enough to confirm a number, never enough to dial one. */
function maskMobile(mobile: string | null): string | null {
  if (!mobile) return null;
  const digits = mobile.replace(/\D/g, '');
  if (digits.length < 6) return '•••• ••••';
  const local = digits.slice(-10);
  const country = digits.slice(0, digits.length - local.length);
  return `${country ? `+${country} ` : ''}${local.slice(0, 2)}•• ••${local.slice(-2)}`;
}

type UserRow = typeof users.$inferSelect;
type ProfileRow = typeof userProfiles.$inferSelect;

/** The one place a user row becomes a response. Field by field, deliberately. */
function identityView(user: UserRow, profile: ProfileRow | null | undefined) {
  return {
    id: user.id,
    status: user.status,
    displayName: profile?.displayName ?? BRAND.fallbackPersonName,
    email: maskEmail(user.email),
    mobile: maskMobile(user.mobile),
    emailVerified: user.emailVerifiedAt !== null,
    mobileVerified: user.mobileVerifiedAt !== null,
    mfaEnabled: user.mfaEnabled,
    isPlatformStaff: user.isPlatformStaff,
    failedLogins: user.failedLogins,
    lockedUntil: user.lockedUntil,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    deletedAt: user.deletedAt,
    profile: profile
      ? {
          city: profile.city,
          region: profile.region,
          countryCode: profile.countryCode,
          locale: profile.locale,
        }
      : null,
  };
}

function targetId(params: Record<string, string>): string {
  const id = params.id;
  // A malformed id is answered as "not found" rather than "invalid", so the route
  // never becomes a cheap way to test which id shapes exist.
  if (!isUlid(id)) throw notFound('Not found.');
  return id;
}

async function loadUser(id: string) {
  const user = await db.query.users.findFirst({ where: eq(users.id, id), with: { profile: true } });
  if (!user) throw notFound('Not found.');
  return user;
}

export const GET = route(
  { rateLimit: { name: 'admin:sensitive', subject: (ctx) => ctx.actor?.userId ?? ctx.ip ?? 'anonymous' } },
  async ({ params, actor, requestId, ip, userAgent }) => {
    const auth = await authorize({ permission: 'platform.user:read', actor: actor ?? undefined });
    const id = targetId(params);
    const user = await loadUser(id);

    const memberships = await db
      .select({
        membershipId: organizationMembers.id,
        status: organizationMembers.status,
        joinedAt: organizationMembers.joinedAt,
        organizationId: organizations.id,
        organizationName: organizations.name,
        organizationSlug: organizations.slug,
        organizationStatus: organizations.status,
      })
      .from(organizationMembers)
      .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
      .where(eq(organizationMembers.userId, id))
      .limit(50);

    const [sessionCount] = await db
      .select({ active: count() })
      .from(sessions)
      .where(
        and(eq(sessions.userId, id), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())),
      );

    // Opening one person's record is a targeted act, so it is reviewable afterwards.
    await recordAudit({
      action: 'platform.user.read',
      targetType: 'user',
      targetId: id,
      result: 'SUCCESS',
      actorUserId: auth.actor.userId,
      actorRole: auth.actorRole,
      requestId,
      ip,
      userAgent,
    });

    return json({
      user: identityView(user, user.profile),
      memberships: memberships.map((m) => ({
        membershipId: m.membershipId,
        status: m.status,
        joinedAt: m.joinedAt,
        organization: {
          id: m.organizationId,
          name: m.organizationName,
          slug: m.organizationSlug,
          status: m.organizationStatus,
        },
      })),
      activeSessions: sessionCount?.active ?? 0,
    });
  },
);

const patchSchema = z.discriminatedUnion('action', [
  // A suspension without a stated reason is unreviewable, so the reason is required.
  z.object({ action: z.literal('SUSPEND'), reason: z.string().trim().min(3).max(240) }),
  z.object({ action: z.literal('RESTORE'), reason: z.string().trim().min(3).max(240) }),
]);


export const PATCH = route(
  {
    bodySchema: patchSchema,
    rateLimit: { name: 'admin:sensitive', subject: (ctx) => ctx.actor?.userId ?? ctx.ip ?? 'anonymous' },
  },
  async ({ body, params, actor, requestId, ip, userAgent }) => {
    // platform.user:suspend is in REQUIRES_ELEVATION; asking for it explicitly keeps
    // the requirement visible at the point of use and true if that set ever changes.
    const auth = await authorize({
      permission: 'platform.user:suspend',
      requireElevation: true,
      actor: actor ?? undefined,
    });

    const id = targetId(params);
    const user = await loadUser(id);

    // Suspending yourself locks the platform team out of the console one seat at a
    // time, and is never what was meant.
    if (user.id === auth.actor.userId) {
      throw conflict('You cannot change your own account from here.');
    }

    const suspending = body.action === 'SUSPEND';
    if (suspending && user.status === 'SUSPENDED') throw conflict('This account is already suspended.');
    if (!suspending && user.status !== 'SUSPENDED') throw conflict('This account is not suspended.');

    // Restoring returns the account to where it was before, which is ACTIVE only if
    // a factor was ever verified — otherwise it goes back to waiting for one.
    const nextStatus = suspending
      ? 'SUSPENDED'
      : user.emailVerifiedAt || user.mobileVerifiedAt
        ? 'ACTIVE'
        : 'PENDING_VERIFICATION';

    await db.transaction(async (tx) => {
      await tx.update(users).set({ status: nextStatus, updatedAt: new Date() }).where(eq(users.id, id));

      // The person is told, in the same transaction as the change. They cannot sign
      // in to read it, which is why notify() also fans the event out to email.
      await notify(
        {
          userId: id,
          category: 'ACCOUNT',
          title: suspending
            ? `Your ${BRAND.name} account has been suspended`
            : `Your ${BRAND.name} account has been restored`,
          body: suspending
            ? `A platform administrator suspended this account. Reason: ${body.reason}`
            : `A platform administrator restored access to this account. Reason: ${body.reason}`,
          linkPath: '/account/security',
          data: { action: body.action },
        },
        tx,
      );
    });

    if (suspending) {
      // Setting the status already stops every session resolving — resolveSession
      // refuses a non-active user — but sessions are revoked explicitly as well, so
      // the revocation is a recorded fact rather than a side effect, and the session
      // generation moves so nothing can be replayed if the status is ever restored.
      await revokeAllSessions(id, 'platform-suspension');
    }

    await recordAudit({
      action: suspending ? 'platform.user.suspend' : 'platform.user.restore',
      targetType: 'user',
      targetId: id,
      result: 'SUCCESS',
      actorUserId: auth.actor.userId,
      actorRole: auth.actorRole,
      requestId,
      ip,
      userAgent,
      metadata: { reason: body.reason, from: user.status, to: nextStatus },
    });

    // Read the row back rather than assembling the answer from what we hoped we
    // wrote: revoking sessions touches this row too, and the caller should see the
    // state that is actually stored.
    const updated = await loadUser(id);
    return json({ user: identityView(updated, updated.profile) });
  },
);
