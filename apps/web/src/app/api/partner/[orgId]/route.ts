/**
 * The organization's own profile — the root of every partner-facing route.
 *
 * The tenant rule that governs this whole subtree lives in `authorizeOrg()` below:
 * the organization id arrives in the path, is handed to `authorize()`, and is then
 * discarded. What every query filters on is the id the guard resolved from the
 * caller's own membership. A partner from another organization never reaches a
 * query, because `authorize()` answers "not found" for "not yours" and "does not
 * exist" alike — a 403 would confirm the organization is real.
 *
 * PATCH is deliberately narrow. It edits the business's own description of itself
 * and nothing else: `status`, `slug`, and the platform's review fields are absent
 * from the schema and `.strict()` rejects them outright, so a partner cannot approve
 * itself, un-suspend itself, or take over another organization's slug by editing a
 * request body.
 */
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { organizations } from '@/db/schema';
import { json, route } from '@/lib/api';
import { recordAudit } from '@/lib/audit';
import {
  assertSameOrg,
  authorize,
  loadOrganization,
  type Actor,
  type AuthorizedContext,
} from '@/lib/authz/authorize';
import { type Permission } from '@/lib/authz/permissions';
import { notFound, unprocessable } from '@/lib/errors';

/**
 * The single entry point for tenant scope. Returns the organization id that came
 * back from the guard — never the raw path value — so a handler physically cannot
 * query the wrong tenant by forgetting a filter.
 */
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

type OrganizationRow = typeof organizations.$inferSelect;

/**
 * Built field by field. `reviewedByUserId` and `reviewNote` stay behind: the first is
 * an internal identifier and the second is the platform's working note about this
 * applicant, neither of which is the partner's to read.
 */
function publicOrganization(row: OrganizationRow) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    kind: row.kind,
    status: row.status,
    legalName: row.legalName,
    registrationNo: row.registrationNo,
    city: row.city,
    countryCode: row.countryCode,
    supportEmail: row.supportEmail,
    websiteUrl: row.websiteUrl,
    connectorKind: row.connectorKind,
    reviewedAt: row.reviewedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export const GET = route({}, async (ctx) => {
  const { auth, organizationId } = await authorizeOrg(ctx, 'partner.org:read');

  const org = await loadOrganization(auth, organizationId);
  // Belt and braces: loadOrganization already compares, and the row is re-checked
  // here so the rule reads the same in every handler that loads a tenant row.
  assertSameOrg(auth, org.id);

  return json({
    organization: publicOrganization(org),
    // Handy for the console: what this caller may do here, without a second call.
    membership: auth.membership
      ? {
          memberId: auth.membership.membershipId,
          status: auth.membership.status,
          roles: auth.membership.roles,
        }
      : null,
  });
});

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    legalName: z.string().trim().min(1).max(200).nullable(),
    registrationNo: z.string().trim().min(1).max(64).nullable(),
    city: z.string().trim().min(1).max(80).nullable(),
    countryCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/, 'Use a two-letter country code.')
      .nullable(),
    supportEmail: z.string().trim().email().max(320).nullable(),
    websiteUrl: z
      .string()
      .trim()
      .url()
      .max(2000)
      .refine((v) => /^https?:\/\//i.test(v), 'Use an http or https address.')
      .nullable(),
    connectorKind: z.string().trim().min(1).max(64).nullable(),
  })
  .partial()
  .strict();

export const PATCH = route({ bodySchema: patchSchema }, async (ctx) => {
  const { auth, organizationId } = await authorizeOrg(ctx, 'partner.org:write');

  const existing = await loadOrganization(auth, organizationId);
  assertSameOrg(auth, existing.id);

  // Only keys the caller actually sent are written, so a PATCH never blanks a field
  // the client did not mention.
  const patch: Partial<typeof organizations.$inferInsert> = {};
  const body = ctx.body;
  if (body.name !== undefined) patch.name = body.name;
  if (body.legalName !== undefined) patch.legalName = body.legalName;
  if (body.registrationNo !== undefined) patch.registrationNo = body.registrationNo;
  if (body.city !== undefined) patch.city = body.city;
  if (body.countryCode !== undefined) patch.countryCode = body.countryCode;
  if (body.supportEmail !== undefined) patch.supportEmail = body.supportEmail;
  if (body.websiteUrl !== undefined) patch.websiteUrl = body.websiteUrl;
  if (body.connectorKind !== undefined) patch.connectorKind = body.connectorKind;

  const changed = Object.keys(patch);
  if (changed.length === 0) throw unprocessable('There is nothing to change in that request.');

  patch.updatedAt = new Date();

  const [updated] = await db
    .update(organizations)
    .set(patch)
    .where(eq(organizations.id, organizationId))
    .returning();
  if (!updated) throw notFound('Not found.');

  await recordAudit({
    action: 'partner.org.update',
    targetType: 'organization',
    targetId: organizationId,
    result: 'SUCCESS',
    actorUserId: auth.actor.userId,
    actorRole: auth.actorRole,
    organizationId,
    requestId: ctx.requestId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    // Field names, not values: the trail records what was touched, and the row
    // itself is the record of what it now says.
    metadata: { fields: changed },
  });

  return json({ organization: publicOrganization(updated) });
});
