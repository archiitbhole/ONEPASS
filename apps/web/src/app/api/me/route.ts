/**
 * The signed-in person, as a client needs them on first paint: who they are, what
 * they may do, and which organizations they belong to.
 *
 * Every field is copied out by hand rather than spread from the row. The users table
 * carries a password hash and a sealed MFA secret, so a spread would be one new
 * column away from shipping a credential to the browser.
 */
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { users } from '@/db/schema';
import { json, route } from '@/lib/api';
import { authorize } from '@/lib/authz/authorize';
import { permissionsForRoles } from '@/lib/authz/permissions';
import { notFound } from '@/lib/errors';

export const GET = route({}, async (ctx) => {
  const { actor } = await authorize({ permission: 'self.profile:read', actor: ctx.actor ?? undefined });

  // The id comes from the guard, never from the request — there is no path or query
  // parameter here that could point this read at somebody else's row.
  const user = await db.query.users.findFirst({
    where: eq(users.id, actor.userId),
    with: { profile: true },
  });
  if (!user) throw notFound('Not found.');

  return json({
    user: {
      id: user.id,
      status: user.status,
      email: user.email,
      emailVerified: Boolean(user.emailVerifiedAt),
      mobile: user.mobile,
      mobileVerified: Boolean(user.mobileVerifiedAt),
      mfaEnabled: user.mfaEnabled,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
    },
    profile: user.profile
      ? {
          displayName: user.profile.displayName,
          givenName: user.profile.givenName,
          familyName: user.profile.familyName,
          city: user.profile.city,
          region: user.profile.region,
          countryCode: user.profile.countryCode,
          locale: user.profile.locale,
          avatarUrl: user.profile.avatarUrl,
          birthYear: user.profile.birthYear,
        }
      : null,
    roles: {
      isPlatformStaff: user.isPlatformStaff,
      platform: actor.platformRoles,
      // What the client may render. Partner permissions are deliberately absent:
      // they only exist per organization, so they are reported with the membership.
      permissions: [...permissionsForRoles(actor.platformRoles)],
    },
    memberships: actor.memberships.map((m) => ({
      organizationId: m.organizationId,
      name: m.organizationName,
      slug: m.organizationSlug,
      organizationStatus: m.organizationStatus,
      membershipStatus: m.status,
      roles: m.roles,
    })),
    session: {
      id: actor.session.sessionId,
      elevated: actor.elevated,
      expiresAt: actor.session.expiresAt,
    },
  });
});
