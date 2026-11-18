/**
 * Editing your own profile.
 *
 * The schema is `.strict()` on purpose: an unknown key is rejected rather than
 * ignored, so a client cannot smuggle `userId` or `status` into the update object and
 * hope a future refactor starts reading it.
 */
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { userProfiles } from '@/db/schema';
import { json, route } from '@/lib/api';
import { recordAudit } from '@/lib/audit';
import { authorize } from '@/lib/authz/authorize';
import { ulid } from '@/lib/ids';

/** `en`, `en-IN`, `mr-IN` — a BCP-47 tag, not free text that ends up in a page lang. */
const LOCALE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

const bodySchema = z
  .object({
    displayName: z.string().trim().min(1).max(120).optional(),
    // Explicit null clears the field; omitting it leaves the stored value alone.
    city: z.string().trim().max(80).nullable().optional(),
    locale: z.string().trim().max(12).regex(LOCALE, 'That is not a valid language tag.').optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Send at least one field to change.' });

export const PATCH = route({ bodySchema }, async (ctx) => {
  const { actor, actorRole } = await authorize({
    permission: 'self.profile:write',
    actor: ctx.actor ?? undefined,
  });

  const changes: Partial<typeof userProfiles.$inferInsert> = {};
  if (ctx.body.displayName !== undefined) changes.displayName = ctx.body.displayName;
  if (ctx.body.city !== undefined) changes.city = ctx.body.city;
  if (ctx.body.locale !== undefined) changes.locale = ctx.body.locale;

  let [row] = await db
    .update(userProfiles)
    .set({ ...changes, updatedAt: new Date() })
    .where(eq(userProfiles.userId, actor.userId))
    .returning();

  // Registration creates the profile, so a missing row is a data fault rather than
  // the caller's problem — write one instead of failing an edit they are allowed to make.
  if (!row) {
    [row] = await db
      .insert(userProfiles)
      .values({
        id: ulid(),
        userId: actor.userId,
        displayName: changes.displayName ?? actor.displayName,
        city: changes.city ?? null,
        ...(changes.locale ? { locale: changes.locale } : {}),
      })
      .returning();
  }

  await recordAudit({
    action: 'self.profile.update',
    targetType: 'user_profile',
    targetId: row?.id ?? null,
    result: 'SUCCESS',
    actorUserId: actor.userId,
    actorRole,
    requestId: ctx.requestId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    // Which fields moved, not what they moved to: the values are in the row already,
    // and the audit trail is read by staff who have no business seeing them.
    metadata: { fields: Object.keys(changes) },
  });

  return json({
    profile: {
      displayName: row?.displayName ?? actor.displayName,
      city: row?.city ?? null,
      locale: row?.locale ?? 'en-IN',
      updatedAt: row?.updatedAt ?? new Date(),
    },
  });
});
