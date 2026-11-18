/**
 * One teammate: change what they may do, or take their access away.
 *
 * The member is loaded by membership id *and* organization id, and the row is then
 * re-checked with `assertSameOrg()`. Both matter: the filter is what makes the query
 * cheap and correct, and the assertion is what makes a future refactor that drops the
 * filter fail loudly instead of quietly serving another tenant's team.
 *
 * Two rules keep an organization from locking itself out, and both answer 409 rather
 * than doing something surprising:
 *  · Nobody edits their own membership. Self-demotion is almost always a mistake, and
 *    a role change you can apply to yourself is a role change an attacker who has
 *    your session can apply to themselves.
 *  · The last active owner cannot be demoted, suspended or removed. An organization
 *    with no owner has nobody who can issue an API key or manage the team again.
 */
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { organizationMembers, roles as rolesTable, userProfiles, userRoles, users } from '@/db/schema';
import { json, route } from '@/lib/api';
import { recordAudit } from '@/lib/audit';
import {
  assertSameOrg,
  authorize,
  type Actor,
  type AuthorizedContext,
} from '@/lib/authz/authorize';
import { type Permission, type RoleName } from '@/lib/authz/permissions';
import { conflict, internal, notFound, unprocessable } from '@/lib/errors';
import { ulid } from '@/lib/ids';

/** The tenant id comes from the guard, never from the path. See ../../route.ts. */
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

async function loadMember(auth: AuthorizedContext, organizationId: string, memberId: string | undefined) {
  if (!memberId) throw notFound('Not found.');

  const [row] = await db
    .select({
      id: organizationMembers.id,
      organizationId: organizationMembers.organizationId,
      userId: organizationMembers.userId,
      status: organizationMembers.status,
      joinedAt: organizationMembers.joinedAt,
      invitedAt: organizationMembers.createdAt,
      email: users.email,
      displayName: userProfiles.displayName,
    })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .leftJoin(userProfiles, eq(userProfiles.userId, organizationMembers.userId))
    .where(and(eq(organizationMembers.id, memberId), eq(organizationMembers.organizationId, organizationId)))
    .limit(1);

  // Someone else's teammate and a teammate who does not exist look identical.
  if (!row) throw notFound('Not found.');
  assertSameOrg(auth, row.organizationId);

  const roleRows = await db
    .select({ id: userRoles.id, name: rolesTable.name })
    .from(userRoles)
    .innerJoin(rolesTable, eq(rolesTable.id, userRoles.roleId))
    .where(eq(userRoles.membershipId, row.id));

  return { row, roles: roleRows.map((r) => r.name as RoleName) };
}

/** Refuses the change that would leave the organization with no active owner. */
async function assertNotLastOwner(organizationId: string, memberId: string, currentRoles: RoleName[]) {
  if (!currentRoles.includes('PARTNER_OWNER')) return;

  const owners = await db
    .select({ memberId: organizationMembers.id })
    .from(organizationMembers)
    .innerJoin(userRoles, eq(userRoles.membershipId, organizationMembers.id))
    .innerJoin(rolesTable, eq(rolesTable.id, userRoles.roleId))
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        eq(organizationMembers.status, 'ACTIVE'),
        eq(rolesTable.name, 'PARTNER_OWNER'),
      ),
    );

  if (owners.every((o) => o.memberId === memberId)) {
    throw conflict('This is the last owner. Make someone else an owner first.');
  }
}

function publicMember(
  row: { id: string; displayName: string | null; email: string | null; status: string; invitedAt: Date; joinedAt: Date | null },
  roles: RoleName[],
) {
  return {
    memberId: row.id,
    displayName: row.displayName,
    email: row.email,
    status: row.status,
    roles,
    invitedAt: row.invitedAt,
    joinedAt: row.joinedAt,
  };
}

const patchSchema = z
  .object({
    role: z.enum(['PARTNER_STAFF', 'PARTNER_ADMIN', 'PARTNER_OWNER']).optional(),
    status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
  })
  .strict();

export const PATCH = route({ bodySchema: patchSchema }, async (ctx) => {
  const { auth, organizationId } = await authorizeOrg(ctx, 'partner.member:manage');

  // Changing a role is its own permission. A status change does not need it, so it is
  // only demanded when the request actually reassigns authority.
  if (ctx.body.role) {
    await authorize({
      permission: 'partner.role:assign',
      organizationId: ctx.params.orgId,
      actor: ctx.actor ?? undefined,
    });
  }

  if (!ctx.body.role && !ctx.body.status) {
    throw unprocessable('There is nothing to change in that request.');
  }

  const { row, roles } = await loadMember(auth, organizationId, ctx.params.memberId);

  if (row.userId === auth.actor.userId) {
    throw conflict('You cannot change your own membership. Ask another owner.');
  }

  const losingOwnership = (ctx.body.role && ctx.body.role !== 'PARTNER_OWNER') || ctx.body.status === 'SUSPENDED';
  if (losingOwnership) await assertNotLastOwner(organizationId, row.id, roles);

  let nextRoles = roles;
  let nextStatus = row.status;
  let nextJoinedAt = row.joinedAt;

  await db.transaction(async (tx) => {
    if (ctx.body.role) {
      // Replace rather than add: "change their role" means they end up with exactly
      // the one that was asked for, not that one plus whatever they had before.
      const role = await tx.query.roles.findFirst({ where: eq(rolesTable.name, ctx.body.role!) });
      if (!role) throw internal('That role is not configured on this deployment.');

      await tx.delete(userRoles).where(eq(userRoles.membershipId, row.id));
      await tx.insert(userRoles).values({
        id: ulid(),
        userId: row.userId,
        roleId: role.id,
        membershipId: row.id,
        grantedByUserId: auth.actor.userId,
      });
      nextRoles = [ctx.body.role];
    }

    if (ctx.body.status) {
      nextStatus = ctx.body.status;
      // Accepting a pending invitation is the moment someone actually joins.
      nextJoinedAt = ctx.body.status === 'ACTIVE' ? (row.joinedAt ?? new Date()) : row.joinedAt;
      await tx
        .update(organizationMembers)
        .set({ status: ctx.body.status, joinedAt: nextJoinedAt, updatedAt: new Date() })
        .where(and(eq(organizationMembers.id, row.id), eq(organizationMembers.organizationId, organizationId)));
    }

    await recordAudit(
      {
        action: 'partner.member.update',
        targetType: 'organization_member',
        targetId: row.id,
        result: 'SUCCESS',
        actorUserId: auth.actor.userId,
        actorRole: auth.actorRole,
        organizationId,
        requestId: ctx.requestId,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        metadata: {
          roles: { from: roles, to: nextRoles },
          status: { from: row.status, to: nextStatus },
        },
      },
      tx,
    );
  });

  return json({
    member: publicMember({ ...row, status: nextStatus, joinedAt: nextJoinedAt }, nextRoles),
  });
});

export const DELETE = route({}, async (ctx) => {
  const { auth, organizationId } = await authorizeOrg(ctx, 'partner.member:manage');

  const { row, roles } = await loadMember(auth, organizationId, ctx.params.memberId);

  if (row.userId === auth.actor.userId) {
    throw conflict('You cannot remove yourself from the team. Ask another owner.');
  }
  await assertNotLastOwner(organizationId, row.id, roles);

  await db.transaction(async (tx) => {
    // Removing the membership removes the roles with it — user_roles cascades on the
    // membership — so access ends with this one write. The person's ONEPASS account is
    // untouched: it was never this organization's to delete.
    await tx
      .delete(organizationMembers)
      .where(and(eq(organizationMembers.id, row.id), eq(organizationMembers.organizationId, organizationId)));

    await recordAudit(
      {
        action: 'partner.member.remove',
        targetType: 'organization_member',
        targetId: row.id,
        result: 'SUCCESS',
        actorUserId: auth.actor.userId,
        actorRole: auth.actorRole,
        organizationId,
        requestId: ctx.requestId,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        metadata: { roles, status: row.status },
      },
      tx,
    );
  });

  return json({ removed: publicMember(row, roles) });
});
