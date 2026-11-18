/**
 * Support intake and the person's own ticket list.
 *
 * The consumer side only. The platform queue is read through the Control
 * console, which authorizes on `platform.support:read` — a person can file and
 * read their own, and nothing else.
 */
import { z } from 'zod';
import { route, json } from '@/lib/api';
import { unauthenticated } from '@/lib/errors';
import { SUPPORT_CATEGORIES, listMyTickets, openTicket } from '@/lib/support/service';

const schema = z.object({
  category: z.enum(SUPPORT_CATEGORIES),
  subject: z.string().trim().min(4).max(180),
  body: z.string().trim().min(10).max(5000),
  reference: z.string().trim().max(40).optional(),
});

export const GET = route({}, async (ctx) => {
  if (!ctx.actor) throw unauthenticated();
  const tickets = await listMyTickets(ctx.actor.userId);
  // Built field by field — the row carries an assignee id that is staff
  // information, not the requester's.
  return json({
    tickets: tickets.map((t) => ({
      id: t.id,
      subject: t.subject,
      body: t.body,
      status: t.status,
      createdAt: t.createdAt.toISOString(),
      resolvedAt: t.resolvedAt?.toISOString() ?? null,
    })),
  });
});

export const POST = route(
  { bodySchema: schema, rateLimit: { name: 'support:open' } },
  async (ctx) => {
    if (!ctx.actor) throw unauthenticated();

    const ticket = await openTicket({
      userId: ctx.actor.userId,
      category: ctx.body.category,
      subject: ctx.body.subject,
      body: ctx.body.body,
      reference: ctx.body.reference ?? null,
    });

    return json(
      { id: ticket.id, subject: ticket.subject, status: ticket.status },
      { status: 201 },
    );
  },
);
