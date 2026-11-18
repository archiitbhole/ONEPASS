/**
 * The devices currently holding a live session.
 *
 * No pagination: `listSessions` is already capped, and a list that a person is meant
 * to read and act on ("is that me?") is worthless if it scrolls forever. What is
 * returned is what the owner needs to recognise a device — never the token hash and
 * never the peppered IP, which exist so that a database dump identifies nobody.
 */
import { json, route } from '@/lib/api';
import { authorize } from '@/lib/authz/authorize';
import { listSessions } from '@/lib/auth/session';

export const GET = route(
  {
    // Keyed to the person, not the address: a shared NAT should not let one caller
    // spend everybody else's budget.
    rateLimit: { name: 'auth:session:list', subject: (ctx) => ctx.actor?.userId ?? ctx.ip ?? 'anonymous' },
  },
  async (ctx) => {
    const { actor } = await authorize({ permission: 'self.session:read', actor: ctx.actor ?? undefined });

    const rows = await listSessions(actor.userId);

    return json({
      items: rows.map((s) => ({
        id: s.id,
        current: s.id === actor.session.sessionId,
        createdAt: s.createdAt,
        lastActiveAt: s.lastActiveAt,
        expiresAt: s.expiresAt,
        userAgent: s.userAgent,
        elevated: Boolean(s.elevatedAt),
        device: s.device
          ? {
              id: s.device.id,
              label: s.device.label,
              platform: s.device.platform,
              trusted: s.device.trusted,
              lastSeenAt: s.device.lastSeenAt,
            }
          : null,
      })),
    });
  },
);
