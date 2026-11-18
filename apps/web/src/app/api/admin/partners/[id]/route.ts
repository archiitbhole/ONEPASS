/**
 * Partner review: approve, reject, suspend.
 *
 * This is the only route that moves an organization's status, and the status is
 * what the entire partner surface hangs off — authorize() refuses every
 * `partner.*` permission at an organization that is not ACTIVE, so approving a
 * business here is what switches its staff on, and suspending it is what switches
 * them all off in one write.
 *
 * The transitions are a deliberate state machine rather than a free assignment:
 * rejecting a live partner is a suspension, and re-approving one is not the same
 * act as approving a fresh application. Refusing the nonsensical moves keeps the
 * audit trail honest about which of those actually happened.
 */
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { organizations } from '@/db/schema';
import { json, route } from '@/lib/api';
import { emitEvent, orgChannel, recordAudit } from '@/lib/audit';
import { authorize } from '@/lib/authz/authorize';
import { conflict, notFound } from '@/lib/errors';
import { isUlid } from '@/lib/ids';

/** `support@hotel.in` → `s•••@hotel.in`; contact details stay masked in admin views. */
function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const at = email.indexOf('@');
  if (at <= 0) return '•••';
  return `${email.slice(0, 1)}•••${email.slice(at)}`;
}

type OrganizationRow = typeof organizations.$inferSelect;

/** Field by field, never a spread: this row gains columns over time. */
function organizationView(org: OrganizationRow) {
  return {
    id: org.id,
    slug: org.slug,
    name: org.name,
    kind: org.kind,
    status: org.status,
    legalName: org.legalName,
    registrationNo: org.registrationNo,
    city: org.city,
    countryCode: org.countryCode,
    websiteUrl: org.websiteUrl,
    supportEmail: maskEmail(org.supportEmail),
    connectorKind: org.connectorKind,
    reviewedAt: org.reviewedAt,
    reviewedByUserId: org.reviewedByUserId,
    reviewNote: org.reviewNote,
    createdAt: org.createdAt,
    updatedAt: org.updatedAt,
  };
}

const patchSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('APPROVE'), note: z.string().trim().max(500).optional() }),
  // A refusal or a suspension that does not say why is not reviewable later, and
  // it is the note the partner's account manager has to work from.
  z.object({ action: z.literal('REJECT'), note: z.string().trim().min(3).max(500) }),
  z.object({ action: z.literal('SUSPEND'), note: z.string().trim().min(3).max(500) }),
]);


export const PATCH = route(
  {
    bodySchema: patchSchema,
    rateLimit: { name: 'admin:sensitive', subject: (ctx) => ctx.actor?.userId ?? ctx.ip ?? 'anonymous' },
  },
  async ({ body, params, actor, requestId, ip, userAgent }) => {
    // Approving and rejecting are the same decision in two directions, so they share
    // a permission; suspending a partner that is already live is a different power
    // and is held separately. Both are in REQUIRES_ELEVATION — named again here so
    // the requirement is visible where the damage would be done.
    const auth = await authorize({
      permission: body.action === 'SUSPEND' ? 'platform.partner:suspend' : 'platform.partner:approve',
      requireElevation: true,
      actor: actor ?? undefined,
    });

    const id = params.id;
    // A malformed id is answered as "not found" rather than "invalid".
    if (!isUlid(id)) throw notFound('Not found.');

    const org = await db.query.organizations.findFirst({ where: eq(organizations.id, id) });
    if (!org || org.deletedAt) throw notFound('Not found.');

    if (body.action === 'APPROVE' && org.status === 'ACTIVE') {
      throw conflict('This organization is already approved.');
    }
    if (body.action === 'REJECT' && org.status !== 'PENDING_REVIEW') {
      throw conflict('Only an organization awaiting review can be rejected.');
    }
    if (body.action === 'SUSPEND' && org.status !== 'ACTIVE') {
      throw conflict('Only an active organization can be suspended.');
    }

    const nextStatus =
      body.action === 'APPROVE' ? 'ACTIVE' : body.action === 'REJECT' ? 'REJECTED' : 'SUSPENDED';
    const reviewedAt = new Date();

    const [updated] = await db.transaction(async (tx) => {
      const rows = await tx
        .update(organizations)
        .set({
          status: nextStatus,
          // Every one of these three is a review decision, so all three record who
          // made it and when — a suspended organization with no reviewer is a row
          // nobody can account for.
          reviewedAt,
          reviewedByUserId: auth.actor.userId,
          reviewNote: body.note ?? null,
          updatedAt: reviewedAt,
        })
        .where(eq(organizations.id, id))
        .returning();

      // The event commits with the change, so it can never announce a decision that
      // was rolled back. The payload carries no reviewer id: the organization's team
      // needs to know the outcome, not which member of platform staff signed it off.
      if (body.action === 'APPROVE') {
        await emitEvent(
          {
            type: 'PARTNER_APPROVED',
            aggregateType: 'organization',
            aggregateId: id,
            channel: orgChannel(id),
            payload: { organizationId: id, name: org.name, status: nextStatus, reviewedAt: reviewedAt.toISOString() },
          },
          tx,
        );
      } else if (body.action === 'SUSPEND') {
        await emitEvent(
          {
            type: 'PARTNER_SUSPENDED',
            aggregateType: 'organization',
            aggregateId: id,
            channel: orgChannel(id),
            payload: { organizationId: id, name: org.name, status: nextStatus, reviewedAt: reviewedAt.toISOString() },
          },
          tx,
        );
      }
      // A rejection emits nothing: EVENT_TYPES has no member for it, and inventing
      // a type at the call site would put an event on the wire that no consumer
      // knows how to read. The audit entry below is the record of it.

      return rows;
    });

    if (!updated) throw notFound('Not found.');

    await recordAudit({
      action: `platform.partner.${body.action.toLowerCase()}`,
      targetType: 'organization',
      targetId: id,
      result: 'SUCCESS',
      actorUserId: auth.actor.userId,
      actorRole: auth.actorRole,
      organizationId: id,
      requestId,
      ip,
      userAgent,
      metadata: { from: org.status, to: nextStatus, note: body.note ?? null },
    });

    return json({ organization: organizationView(updated) });
  },
);
