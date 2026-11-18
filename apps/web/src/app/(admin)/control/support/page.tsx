/**
 * Support tickets.
 *
 * The queue support works: who asked, what they asked, what state it is in and
 * whose name is against it. The requester's contact details are masked here as
 * everywhere else in this console — a ticket is answered through the
 * notification the platform sends, not by copying an address off a screen.
 *
 * An honest note about this build: the queue is fed, and this screen is what
 * moves it. `POST /api/support` is the intake — a person files from the Help
 * screen and `redactSecrets` strips anything password-, one-time-code- or
 * card-shaped at that door, so a secret never reaches the row an agent reads
 * here. Every move a ticket then makes happens on this page, and each one goes
 * through `moveTicket` in src/lib/support/service.ts, which owns the
 * transitions, the row lock, the audit entry and the notification the requester
 * gets. This page keeps no copy of that state machine: it reads
 * `TICKET_TRANSITIONS` to decide which buttons to draw, so a button can never
 * ask for a move the service would refuse — and the service checks again on
 * every post regardless, because a drawn button is a layout decision and not a
 * lock. An empty queue therefore means "nobody has filed anything", not "the
 * query came back short", which is worth saying on the screen: an empty
 * operations screen with no explanation is indistinguishable from a broken one.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { and, count, desc, eq, isNull, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '@/db/client';
import { supportTickets, userProfiles, users } from '@/db/schema';
import {
  Badge,
  Button,
  Card,
  CardHead,
  Empty,
  Notice,
  StatusBadge,
  TableScroll,
  formatDateTime,
  formatRelative,
} from '@/components/ui';
import { FilterLinks, PageHeader, Summary } from '@/components/partner/shell';
import { requirePlatform } from '@/components/admin/guard';
import { ActionOutcome } from '@/components/admin/parts';
import { firstParam, maskEmail, oneOf, withParam } from '@/components/admin/redact';
import { TICKET_TRANSITIONS, type TicketStatus } from '@/lib/support/service';
import { moveSupportTicket } from './actions';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = { title: 'Support' };
export const dynamic = 'force-dynamic';

const STATUSES = ['OPEN', 'PENDING', 'RESOLVED', 'CLOSED'] as const;
const ASSIGNMENT = ['MINE', 'UNASSIGNED'] as const;
const BASE = '/control/support';
const LIMIT = 50;

/**
 * Three aliases onto two tables. The requester and the assignee are both users
 * with profiles, and joining the same table twice without naming the copies is
 * how a queue ends up showing the agent's name in the customer column.
 */
const requesterUser = alias(users, 'requester_user');
const requesterProfile = alias(userProfiles, 'requester_profile');
const assigneeProfile = alias(userProfiles, 'assignee_profile');

/**
 * What a move is called on a button, given where the ticket is coming from.
 *
 * `PENDING → OPEN` and `RESOLVED → OPEN` are the same transition to the
 * database and two different acts to a person: one is putting a ticket back in
 * the working queue, the other is admitting the answer did not land.
 */
function moveLabel(from: TicketStatus, to: TicketStatus): string {
  if (to === 'PENDING') return 'Move to pending';
  if (to === 'RESOLVED') return 'Resolve';
  if (to === 'CLOSED') return 'Close';
  return from === 'RESOLVED' ? 'Reopen' : 'Back to open';
}

export default async function ControlSupportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requirePlatform('platform.support:read', BASE);
  const query = await searchParams;

  const status = oneOf(query.status, STATUSES);
  const assignment = oneOf(query.assignment, ASSIGNMENT);

  const where: (SQL | undefined)[] = [];
  if (status) where.push(eq(supportTickets.status, status));
  if (assignment === 'MINE') where.push(eq(supportTickets.assignedToUserId, ctx.actor.userId));
  if (assignment === 'UNASSIGNED') where.push(isNull(supportTickets.assignedToUserId));
  const filter = where.length ? and(...where) : undefined;

  const rows = await db
    .select({
      id: supportTickets.id,
      subject: supportTickets.subject,
      body: supportTickets.body,
      status: supportTickets.status,
      resolvedAt: supportTickets.resolvedAt,
      createdAt: supportTickets.createdAt,
      updatedAt: supportTickets.updatedAt,
      requesterId: supportTickets.userId,
      requesterName: requesterProfile.displayName,
      requesterEmail: requesterUser.email,
      assignedToUserId: supportTickets.assignedToUserId,
      assigneeName: assigneeProfile.displayName,
    })
    .from(supportTickets)
    .leftJoin(requesterUser, eq(requesterUser.id, supportTickets.userId))
    .leftJoin(requesterProfile, eq(requesterProfile.userId, supportTickets.userId))
    .leftJoin(assigneeProfile, eq(assigneeProfile.userId, supportTickets.assignedToUserId))
    .where(filter)
    // Ids are ULIDs, so newest-first is `id desc`.
    .orderBy(desc(supportTickets.id))
    .limit(LIMIT);

  const byStatus = await db
    .select({ status: supportTickets.status, total: count() })
    .from(supportTickets)
    .groupBy(supportTickets.status);

  const [unassigned] = await db
    .select({ total: count() })
    .from(supportTickets)
    .where(isNull(supportTickets.assignedToUserId));

  const totalTickets = byStatus.reduce((sum, row) => sum + row.total, 0);
  const current = { status, assignment };
  // Where a move returns to: the filtered view the agent was actually working.
  const back = withParam(BASE, current, {});

  // Read draws this page; write is a separate permission, and the action checks
  // it again on every post. Hiding a button is a layout decision, never a lock.
  const mayMove = ctx.permissions.has('platform.support:write');

  return (
    <div className="stack stack-5">
      <PageHeader
        eyebrow="Platform"
        title="Support"
        lede={`Tickets, their state and whose name is against them. Requester contact details are masked here as everywhere else in this console — a reply goes out as a ${BRAND.name} notification, not to an address read off this screen.`}
      />

      <ActionOutcome error={firstParam(query.error)} done={firstParam(query.done)} />

      {totalTickets === 0 ? (
        <Notice tone="info">
          <p>
            No ticket has been filed yet. People file from the Help screen, which posts to{' '}
            <span className="mono">/api/support</span> and stores the message with anything
            password-, code- or card-shaped stripped out; this queue is where those tickets are
            worked. It is empty because nothing has been filed, not because a query came back
            short.
          </p>
        </Notice>
      ) : null}

      <Card>
        <div className="stack stack-4">
          <FilterLinks
            label="Filter tickets by status"
            current={status}
            options={[
              { href: withParam(BASE, current, { status: null }), label: 'All', value: null },
              ...STATUSES.map((value) => ({
                href: withParam(BASE, current, { status: value }),
                label: value.toLowerCase(),
                value,
              })),
            ]}
          />
          <FilterLinks
            label="Filter tickets by assignment"
            current={assignment}
            options={[
              { href: withParam(BASE, current, { assignment: null }), label: 'Anyone', value: null },
              { href: withParam(BASE, current, { assignment: 'MINE' }), label: 'assigned to me', value: 'MINE' },
              {
                href: withParam(BASE, current, { assignment: 'UNASSIGNED' }),
                label: 'unassigned',
                value: 'UNASSIGNED',
              },
            ]}
          />
          <Summary
            items={[
              { label: 'Tickets', value: totalTickets },
              ...STATUSES.map((value) => ({
                label: value.toLowerCase(),
                value: byStatus.find((row) => row.status === value)?.total ?? 0,
              })),
              { label: 'Unassigned', value: unassigned?.total ?? 0 },
            ]}
          />
        </div>
      </Card>

      <Card>
        <CardHead title="Queue" action={<span className="small muted">Newest first</span>} />
        {rows.length === 0 ? (
          <Empty
            title={status || assignment ? 'Nothing matches those filters' : 'No tickets'}
            body={
              status || assignment
                ? 'No ticket sits inside those filters.'
                : 'A ticket appears here as soon as somebody files one from the Help screen.'
            }
            action={
              status || assignment ? (
                <Link className="btn btn-sm" href={BASE}>
                  Clear the filters
                </Link>
              ) : null
            }
          />
        ) : (
          <div className="stack stack-4">
            {mayMove ? (
              <p className="tiny muted">
                Only the moves <span className="mono">moveTicket</span> would accept from a ticket&apos;s
                current state are offered, so a button here cannot be refused for being the wrong
                move. Taking a ticket happens with the move you make: tick{' '}
                <em>assign it to me</em> and your name goes on it in the same write — there is no
                assign-only path, because one service call is the only thing that changes a ticket.
              </p>
            ) : null}

            <TableScroll>
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Subject</th>
                    <th scope="col">Requester</th>
                    <th scope="col">Status</th>
                    <th scope="col">Assignee</th>
                    <th scope="col">Opened</th>
                    <th scope="col">Last touched</th>
                    <th scope="col">Move it</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const moves = TICKET_TRANSITIONS[row.status];
                    const mine = row.assignedToUserId === ctx.actor.userId;

                    return (
                      <tr key={row.id}>
                        <td style={{ minWidth: 260 }}>
                          <span style={{ fontWeight: 600 }}>{row.subject}</span>
                          <details style={{ marginTop: 4 }}>
                            <summary className="tiny muted">read the message</summary>
                            <p className="small" style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>
                              {row.body}
                            </p>
                          </details>
                        </td>
                        <td className="small">
                          <Link href={`/control/users/${row.requesterId}`}>
                            {row.requesterName ?? BRAND.fallbackPersonName}
                          </Link>
                          <div className="tiny muted mono">{maskEmail(row.requesterEmail) ?? 'no email'}</div>
                        </td>
                        <td><StatusBadge status={row.status} /></td>
                        <td className="small">
                          {row.assignedToUserId ? (
                            <>
                              <Link href={`/control/users/${row.assignedToUserId}`}>
                                {row.assigneeName ?? 'platform staff'}
                              </Link>
                              {mine ? (
                                <> <Badge tone="accent">you</Badge></>
                              ) : null}
                            </>
                          ) : (
                            <Badge tone="warn">unassigned</Badge>
                          )}
                        </td>
                        <td className="small">{formatDateTime(row.createdAt)}</td>
                        <td className="small">
                          {row.resolvedAt
                            ? `resolved ${formatRelative(row.resolvedAt)}`
                            : formatRelative(row.updatedAt)}
                        </td>
                        <td style={{ minWidth: 210 }}>
                          {!mayMove ? (
                            <span className="tiny muted">
                              Moving a ticket needs <span className="mono">platform.support:write</span>,
                              which your platform role does not hold.
                            </span>
                          ) : moves.length === 0 ? (
                            <span className="tiny muted">
                              Closed. A closed ticket does not move again.
                            </span>
                          ) : (
                            <form action={moveSupportTicket} className="stack stack-3">
                              <input type="hidden" name="ticketId" value={row.id} />
                              <input type="hidden" name="back" value={back} />

                              {mine ? null : (
                                <label className="row tiny" style={{ gap: 6 }} htmlFor={`assign-${row.id}`}>
                                  <input
                                    id={`assign-${row.id}`}
                                    type="checkbox"
                                    name="assign"
                                    value="1"
                                    defaultChecked={row.assignedToUserId === null}
                                  />
                                  assign it to me
                                </label>
                              )}

                              <div className="row-wrap" style={{ gap: 6 }}>
                                {moves.map((to) => (
                                  <Button
                                    key={to}
                                    type="submit"
                                    name="to"
                                    value={to}
                                    size="sm"
                                    variant={to === 'RESOLVED' ? 'primary' : 'default'}
                                  >
                                    {moveLabel(row.status, to)}
                                  </Button>
                                ))}
                              </div>
                            </form>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableScroll>
          </div>
        )}
      </Card>
    </div>
  );
}
