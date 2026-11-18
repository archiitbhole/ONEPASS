/**
 * The security timeline: sign-ins, revocations and anything the platform flagged
 * about this account.
 *
 * Two tables feed it. They can be merged and paged as one stream because both use
 * ULID primary keys, which sort lexicographically in creation order — so `id desc`
 * across the union is a true chronological ordering and `id < cursor` is a correct
 * "older than" on both at once.
 *
 * What is deliberately absent: the peppered IP hash, which is a correlation key for
 * operators rather than information for the owner, and the auth event `detail` blob,
 * which is written for the people running the auth pipeline.
 */
import { and, desc, eq, lt } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { authEventKind, authEvents, securityEvents } from '@/db/schema';
import { json, paginate, route } from '@/lib/api';
import { authorize } from '@/lib/authz/authorize';
import { ULID_PATTERN } from '@/lib/ids';

type AuthKind = (typeof authEventKind.enumValues)[number];

/**
 * A security page has to read as sentences. The mapping lives beside the endpoint
 * that serves it so a new enum member fails the build here rather than reaching a
 * client as a raw SCREAMING_CASE token.
 */
const AUTH_SUMMARY: Record<AuthKind, string> = {
  LOGIN_SUCCESS: 'Signed in.',
  LOGIN_FAILED: 'A sign-in attempt failed.',
  LOGOUT: 'Signed out.',
  SESSION_REVOKED: 'A device was signed out.',
  PASSWORD_CHANGED: 'The account password was changed.',
  OTP_SENT: 'A one-time code was sent.',
  OTP_VERIFIED: 'A one-time code was accepted.',
  OTP_FAILED: 'A one-time code was rejected.',
  MFA_CHALLENGED: 'Two-factor authentication was requested.',
  ACCOUNT_LOCKED: 'The account was locked after repeated failures.',
  RECOVERY_STARTED: 'Account recovery was started.',
  RECOVERY_COMPLETED: 'Account recovery was completed.',
  STEP_UP_SUCCEEDED: 'The password was confirmed to unlock a sensitive action.',
  STEP_UP_FAILED: 'A wrong password was entered to unlock a sensitive action.',
};

interface TimelineItem {
  id: string;
  source: 'AUTH' | 'SECURITY';
  kind: string;
  summary: string;
  severity: 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  userAgent: string | null;
  acknowledged: boolean;
  at: Date;
}

const DEFAULT_LIMIT = 25;

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().regex(ULID_PATTERN).optional(),
});

export const GET = route({ querySchema }, async (ctx) => {
  const { actor } = await authorize({ permission: 'self.security:read', actor: ctx.actor ?? undefined });

  // Applied here rather than as a zod `.default()`: route() infers the schema's input
  // type, under which a defaulted field still reads as possibly undefined.
  const limit = ctx.query.limit ?? DEFAULT_LIMIT;

  const take = limit + 1;

  // Each side is asked for a full page: either table could hold all of the newest
  // rows, so anything less could drop events that belong on this page.
  const [auth, security] = await Promise.all([
    db
      .select({
        id: authEvents.id,
        kind: authEvents.kind,
        userAgent: authEvents.userAgent,
        createdAt: authEvents.createdAt,
      })
      .from(authEvents)
      .where(
        and(
          eq(authEvents.userId, actor.userId),
          ctx.query.cursor ? lt(authEvents.id, ctx.query.cursor) : undefined,
        ),
      )
      .orderBy(desc(authEvents.id))
      .limit(take),
    db
      .select({
        id: securityEvents.id,
        kind: securityEvents.kind,
        severity: securityEvents.severity,
        summary: securityEvents.summary,
        acknowledgedAt: securityEvents.acknowledgedAt,
        createdAt: securityEvents.createdAt,
      })
      .from(securityEvents)
      .where(
        and(
          eq(securityEvents.userId, actor.userId),
          ctx.query.cursor ? lt(securityEvents.id, ctx.query.cursor) : undefined,
        ),
      )
      .orderBy(desc(securityEvents.id))
      .limit(take),
  ]);

  const merged: TimelineItem[] = [
    ...auth.map((e) => ({
      id: e.id,
      source: 'AUTH' as const,
      kind: e.kind,
      summary: AUTH_SUMMARY[e.kind],
      severity: (e.kind === 'LOGIN_FAILED' || e.kind === 'OTP_FAILED'
        ? 'LOW'
        : e.kind === 'ACCOUNT_LOCKED'
          ? 'MEDIUM'
          : 'INFO') as TimelineItem['severity'],
      userAgent: e.userAgent,
      acknowledged: false,
      at: e.createdAt,
    })),
    ...security.map((e) => ({
      id: e.id,
      source: 'SECURITY' as const,
      kind: e.kind,
      summary: e.summary,
      severity: e.severity,
      userAgent: null,
      acknowledged: Boolean(e.acknowledgedAt),
      at: e.createdAt,
    })),
  ]
    .sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
    .slice(0, take);

  return json(paginate(merged, limit));
});
