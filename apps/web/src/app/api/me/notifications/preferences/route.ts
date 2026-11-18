/**
 * What you want to be told about.
 *
 * The rows have existed since registration writes them (`lib/auth/flows.ts`),
 * and until now nothing could change one: the profile screen read them back and
 * said so. This is the write half, and it is deliberately one preference per
 * request — a switch is one intention, and a batch endpoint would invite a
 * screen to send twelve rows it did not ask a person about.
 *
 * Two rules the schema cannot express:
 *
 *  · **Security notices cannot be switched off.** A person who has lost control
 *    of their account is exactly the person an attacker would silence first, so
 *    the SECURITY category is refused rather than quietly ignored. The comment
 *    in `flows.ts` has promised this since registration first wrote the rows.
 *  · **The upsert is keyed on the caller's own id.** `notification_prefs_key`
 *    is unique on (user, category, channel), so a conflict updates this
 *    person's row and can never reach anybody else's.
 *
 * What reads the answer is a separate question, and the settings screen states
 * it plainly: nothing does yet. Storing a preference nobody honours is still
 * worth doing — it is the person's choice, recorded — but a screen that implied
 * it silenced an email this deployment cannot send would not be.
 */
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { notificationCategory, notificationChannel, notificationPreferences } from '@/db/schema';
import { json, route } from '@/lib/api';
import { recordAudit } from '@/lib/audit';
import { authorize } from '@/lib/authz/authorize';
import { unprocessable } from '@/lib/errors';
import { ulid } from '@/lib/ids';

/** The category whose notices are not optional. */
const ALWAYS_ON = 'SECURITY';

const bodySchema = z
  .object({
    category: z.enum(notificationCategory.enumValues),
    channel: z.enum(notificationChannel.enumValues),
    enabled: z.boolean(),
  })
  .strict();

export const PATCH = route(
  {
    bodySchema,
    rateLimit: { name: 'me:notification-prefs', subject: (ctx) => ctx.actor?.userId ?? ctx.ip ?? 'anonymous' },
  },
  async (ctx) => {
    const { actor, actorRole } = await authorize({
      permission: 'self.notification:write',
      actor: ctx.actor ?? undefined,
    });

    const { category, channel, enabled } = ctx.body;

    if (category === ALWAYS_ON && !enabled) {
      await recordAudit({
        action: 'self.notification.preference',
        targetType: 'notification_preference',
        targetId: null,
        result: 'FAILED',
        actorUserId: actor.userId,
        actorRole,
        requestId: ctx.requestId,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        metadata: { reason: 'security_always_on', category, channel },
      });
      throw unprocessable(
        'Security notices cannot be switched off. They are how you find out that somebody else is using your account.',
      );
    }

    const updatedAt = new Date();

    // Upsert rather than update-then-insert: registration writes IN_APP rows only,
    // so the first time somebody chooses anything about another channel there is
    // no row to update, and two statements would race with themselves.
    const [row] = await db
      .insert(notificationPreferences)
      .values({ id: ulid(), userId: actor.userId, category, channel, enabled, updatedAt })
      .onConflictDoUpdate({
        target: [
          notificationPreferences.userId,
          notificationPreferences.category,
          notificationPreferences.channel,
        ],
        set: { enabled, updatedAt },
        // Belt and braces on the owner: the conflict target already scopes this to
        // the caller's own row, and this makes a mistake in that target impossible
        // to exploit rather than merely unlikely.
        where: eq(notificationPreferences.userId, actor.userId),
      })
      .returning();

    await recordAudit({
      action: 'self.notification.preference',
      targetType: 'notification_preference',
      targetId: row?.id ?? null,
      result: 'SUCCESS',
      actorUserId: actor.userId,
      actorRole,
      requestId: ctx.requestId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { category, channel, enabled },
    });

    return json({
      preference: {
        category: row?.category ?? category,
        channel: row?.channel ?? channel,
        enabled: row?.enabled ?? enabled,
        updatedAt: row?.updatedAt ?? updatedAt,
      },
    });
  },
);

export const GET = route({ rateLimit: { name: 'api:general' } }, async (ctx) => {
  const { actor } = await authorize({
    permission: 'self.notification:read',
    actor: ctx.actor ?? undefined,
  });

  const rows = await db
    .select({
      category: notificationPreferences.category,
      channel: notificationPreferences.channel,
      enabled: notificationPreferences.enabled,
      updatedAt: notificationPreferences.updatedAt,
    })
    .from(notificationPreferences)
    .where(and(eq(notificationPreferences.userId, actor.userId)));

  return json({ items: rows, alwaysOn: [ALWAYS_ON] });
});
