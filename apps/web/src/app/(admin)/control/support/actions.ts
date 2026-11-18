/**
 * Moving a ticket, from the console.
 *
 * The state machine is not here. `moveTicket` in src/lib/support/service.ts owns
 * it — which transitions exist, the `select … for update` that makes two agents
 * clicking at once produce one winner, the conditional update that catches the
 * loser, the audit entry, and the notification the person gets when their
 * request is resolved. This file assembles a form post into a call to it and
 * turns the answer back into something a screen can show.
 *
 * That division is deliberate. A console that re-implemented "a closed ticket
 * cannot reopen" would be a second place for that rule to live, and the two
 * would disagree the first time one of them was edited. So the queue offers only
 * the transitions the service would accept — it reads `TICKET_TRANSITIONS` for
 * that, rather than keeping its own list — and the service checks again anyway,
 * because the buttons a page draws are not an authorization or a validation.
 *
 * Which is also why the guard is re-run here. `platform.support:write` is
 * checked on every post, not once when the page rendered: a hidden button is a
 * layout decision, and anyone can post a form.
 *
 * A refusal comes back as the service's own sentence, unedited. "Someone else
 * moved this ticket. Reload and try again." is the true account of what
 * happened, and nothing this file could write would improve on it.
 */
'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requirePlatform } from '@/components/admin/guard';
import { AppError } from '@/lib/errors';
import { isUlid } from '@/lib/ids';
import { TICKET_TRANSITIONS, moveTicket, type TicketStatus } from '@/lib/support/service';
import { BRAND } from '@/lib/brand';

const BASE = '/control/support';

/** The states the service knows, from the service. Never a second list. */
const STATUSES = Object.keys(TICKET_TRANSITIONS) as readonly TicketStatus[];

/** One member of the ticket status union from a form field, or null. Never a cast alone. */
function asStatus(value: string): TicketStatus | null {
  return (STATUSES as readonly string[]).includes(value) ? (value as TicketStatus) : null;
}

/** What each landing state means to the person who filed it, not to the queue. */
const DONE: Record<TicketStatus, string> = {
  OPEN: 'Ticket reopened. It is back in the working queue.',
  PENDING: 'Ticket moved to pending — waiting on something before it can be answered.',
  RESOLVED: `Ticket resolved. The person who filed it has been notified through ${BRAND.name}.`,
  CLOSED: 'Ticket closed. A closed ticket does not move again.',
};

export async function moveSupportTicket(formData: FormData): Promise<void> {
  // The write permission, not the read one the page renders under: seeing a
  // queue and changing it are two different things, and this post is the second.
  const ctx = await requirePlatform('platform.support:write', BASE);

  // Back to the filtered view the agent was working, not to the top of the
  // queue — but only if it is this queue. An unchecked `back` is an open
  // redirect with extra steps.
  const requested = String(formData.get('back') ?? BASE);
  const target = requested.startsWith(BASE) ? requested : BASE;
  const separator = target.includes('?') ? '&' : '?';
  const fail = (message: string) => `${target}${separator}error=${encodeURIComponent(message)}`;

  const ticketId = String(formData.get('ticketId') ?? '');
  const to = asStatus(String(formData.get('to') ?? ''));
  // A checkbox that was not ticked is simply absent from the post.
  const assignToSelf = formData.get('assign') !== null;

  if (!isUlid(ticketId)) {
    redirect(fail('That is not a ticket this console knows.'));
  }
  if (!to) {
    redirect(fail('That is not a state a ticket can be in.'));
  }

  // `redirect` throws, so the call to the service stands outside the try that
  // catches the service's refusals — otherwise a successful redirect would be
  // read as a failed move.
  let refusal: string | null = null;
  try {
    await moveTicket({ ticketId, to, staffUserId: ctx.actor.userId, assignToSelf });
  } catch (err) {
    if (!(err instanceof AppError)) throw err;
    // Verbatim. The service says whether the ticket vanished, whether the
    // transition is not one a ticket can make, or whether another agent got
    // there first, and each of those is a situation rather than a fault.
    refusal = err.message;
  }

  if (refusal !== null) {
    redirect(fail(refusal));
  }

  revalidatePath(BASE);
  revalidatePath('/control');
  redirect(`${target}${separator}done=${encodeURIComponent(DONE[to])}`);
}
