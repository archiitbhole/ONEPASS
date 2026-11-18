/**
 * The team inside one organization.
 *
 * Same tenant rule as everywhere in this subtree: the organization id comes back from
 * `authorize()`, and every query filters on that rather than on the path value.
 *
 * Inviting is where privilege escalation would happen if it were going to, so the
 * role being handed out is authorized separately. `partner.member:invite` is enough
 * to bring in a counter user; anything above that needs `partner.role:assign` as
 * well, which only an owner holds and which requires a recent re-authentication. So a
 * partner admin cannot mint an owner and quietly promote themselves through the back
 * door of an invite form.
 *
 * A member is addressed by their membership id, never by their platform user id: the
 * membership is the thing that exists inside this tenant, and it is the only handle
 * the other team routes accept.
 */
import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { organizationMembers, roles as rolesTable, userProfiles, userRoles, users } from '@/db/schema';
import { json, paginate, route } from '@/lib/api';
import { recordAudit } from '@/lib/audit';
import { deliverEmail } from '@/lib/delivery';
import {
  assertSameOrg,
  authorize,
  type Actor,
  type AuthorizedContext,
} from '@/lib/authz/authorize';
import { type Permission, type RoleName } from '@/lib/authz/permissions';
import { conflict, internal, notFound } from '@/lib/errors';
import { ULID_PATTERN, ulid } from '@/lib/ids';
import { BRAND } from '@/lib/brand';

/** The tenant id comes from the guard, never from the path. See ../route.ts. */
async function authorizeOrg(
  ctx: { params: Record<string, string>; actor: Actor | null },
  permission: Permission,
): Promise<{ auth: AuthorizedContext; organizationId: string }> {
  const auth = await authorize({
    permission,
    organizationId: ctx.params.orgId,
    actor: ctx.actor ?? undefined,
  });
  if (!auth.organizationId) throw notFound('Not found.');
  return { auth, organizationId: auth.organizationId };
}

/** Roles are held per membership, so one member can carry more than one. */
async function rolesByMembership(membershipIds: string[]): Promise<Map<string, RoleName[]>> {
  const byMembership = new Map<string, RoleName[]>();
  if (membershipIds.length === 0) return byMembership;

  const rows = await db
    .select({ membershipId: userRoles.membershipId, name: rolesTable.name })
    .from(userRoles)
    .innerJoin(rolesTable, eq(rolesTable.id, userRoles.roleId))
    .where(inArray(userRoles.membershipId, membershipIds));

  for (const row of rows) {
    if (!row.membershipId) continue;
    const list = byMembership.get(row.membershipId) ?? [];
    list.push(row.name as RoleName);
    byMembership.set(row.membershipId, list);
  }
  return byMembership;
}

const querySchema = z.object({
  status: z.enum(['INVITED', 'ACTIVE', 'SUSPENDED']).optional(),
  cursor: z.string().regex(ULID_PATTERN).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const GET = route({ querySchema }, async (ctx) => {
  const { auth, organizationId } = await authorizeOrg(ctx, 'partner.member:read');
  const limit = ctx.query.limit ?? 25;

  const rows = await db
    .select({
      id: organizationMembers.id,
      organizationId: organizationMembers.organizationId,
      status: organizationMembers.status,
      joinedAt: organizationMembers.joinedAt,
      invitedAt: organizationMembers.createdAt,
      email: users.email,
      displayName: userProfiles.displayName,
    })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .leftJoin(userProfiles, eq(userProfiles.userId, organizationMembers.userId))
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        ctx.query.status ? eq(organizationMembers.status, ctx.query.status) : undefined,
        // ULID ids sort by creation, so newest-first is `id desc` and the cursor is
        // `id <`. No offset, so the page cannot shift while someone is invited.
        ctx.query.cursor ? lt(organizationMembers.id, ctx.query.cursor) : undefined,
      ),
    )
    .orderBy(desc(organizationMembers.id))
    .limit(limit + 1);

  const page = paginate(rows, limit);
  for (const row of page.items) assertSameOrg(auth, row.organizationId);

  const roles = await rolesByMembership(page.items.map((row) => row.id));

  return json({
    items: page.items.map((row) => ({
      memberId: row.id,
      displayName: row.displayName,
      email: row.email,
      status: row.status,
      roles: roles.get(row.id) ?? [],
      invitedAt: row.invitedAt,
      joinedAt: row.joinedAt,
    })),
    nextCursor: page.nextCursor,
  });
});

const inviteSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(320),
    displayName: z.string().trim().min(1).max(120).optional(),
    role: z.enum(['PARTNER_STAFF', 'PARTNER_ADMIN', 'PARTNER_OWNER']),
  })
  .strict();

export const POST = route({ bodySchema: inviteSchema }, async (ctx) => {
  const { auth, organizationId } = await authorizeOrg(ctx, 'partner.member:invite');

  // Inviting someone is one permission; deciding how much authority they arrive with
  // is another. Anything above counter staff is a role assignment, so it is
  // authorized as one — which also means it inherits the re-authentication step-up.
  if (ctx.body.role !== 'PARTNER_STAFF') {
    await authorize({
      permission: 'partner.role:assign',
      organizationId: ctx.params.orgId,
      actor: ctx.actor ?? undefined,
    });
  }

  const role = await db.query.roles.findFirst({ where: eq(rolesTable.name, ctx.body.role) });
  if (!role) throw internal('That role is not configured on this deployment.');

  const email = ctx.body.email;
  const existingUser = await db.query.users.findFirst({ where: eq(users.email, email) });

  if (existingUser) {
    const existingMembership = await db.query.organizationMembers.findFirst({
      where: and(
        eq(organizationMembers.organizationId, organizationId),
        eq(organizationMembers.userId, existingUser.id),
      ),
    });
    if (existingMembership) {
      assertSameOrg(auth, existingMembership.organizationId);
      throw conflict('That person is already on this team.');
    }
  }

  const membershipId = ulid();
  const userId = existingUser?.id ?? ulid();
  const displayName = ctx.body.displayName ?? email.split('@')[0] ?? 'New teammate';

  await db.transaction(async (tx) => {
    if (!existingUser) {
      // An invited address that has no ONEPASS account yet gets a shell one: no
      // password, unverified, so it cannot be signed into until the person completes
      // registration themselves. Creating it here also means the invite answers the
      // same way whether or not the address is already a ONEPASS user, which keeps
      // this endpoint from becoming an account-enumeration oracle.
      await tx.insert(users).values({ id: userId, status: 'PENDING_VERIFICATION', email });
      await tx.insert(userProfiles).values({
        id: ulid(),
        userId,
        displayName: displayName.slice(0, 120),
      });
    }

    // INVITED, not ACTIVE: authorize() only honours an ACTIVE membership, so the
    // invitation grants nothing until it is accepted.
    await tx.insert(organizationMembers).values({
      id: membershipId,
      organizationId,
      userId,
      status: 'INVITED',
      invitedByUserId: auth.actor.userId,
    });

    await tx.insert(userRoles).values({
      id: ulid(),
      userId,
      roleId: role.id,
      membershipId,
      grantedByUserId: auth.actor.userId,
    });

    await recordAudit(
      {
        action: 'partner.member.invite',
        targetType: 'organization_member',
        targetId: membershipId,
        result: 'SUCCESS',
        actorUserId: auth.actor.userId,
        actorRole: auth.actorRole,
        organizationId,
        requestId: ctx.requestId,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        metadata: { email, role: ctx.body.role, newAccount: !existingUser },
      },
      tx,
    );
  });

  // After the commit, never inside it: a delivery call is a network round trip, and
  // holding a database transaction open across one is how connection pools die. A
  // failed send leaves a valid invitation that can be re-sent.
  const delivery = await deliverEmail({
    to: email,
    subject: `You have been invited to ${auth.membership?.organizationName ?? `a ${BRAND.name} business`}`,
    text:
      `${auth.actor.displayName} has invited you to join ` +
      `${auth.membership?.organizationName ?? 'their business'} on ${BRAND.name} as ${ctx.body.role}.\n\n` +
      `Sign in to ${BRAND.name} with this address to accept.`,
    tag: 'partner-invite',
  });
  if (!delivery.delivered) {
    ctx.log.warn({ membershipId, provider: delivery.provider }, 'partner invite email was not delivered');
  }

  return json(
    {
      member: {
        memberId: membershipId,
        displayName,
        email,
        status: 'INVITED',
        roles: [ctx.body.role],
        invitedAt: new Date(),
        joinedAt: null,
      },
      invitationEmailed: delivery.delivered,
    },
    { status: 201 },
  );
});
