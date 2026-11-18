/**
 * The security queue.
 *
 * An event here is a statement that something worth a human's attention happened —
 * a lockout, a burst of failed sign-ins, a credential that failed its integrity
 * check. Until this screen existed, responding to one meant psql.
 *
 * Two decisions worth naming:
 *
 *  · The evidence is on the card, not behind a "view raw" link. `hashIntact:
 *    false` *is* the finding — an alert whose working nobody can see is an alert
 *    nobody acts on. The metadata was stripped of anything credential-shaped by
 *    `sanitise()` when it was written, so what is rendered is safe to render.
 *
 *  · `ipHash` is never selected. It is a peppered one-way hash that exists so
 *    events can be correlated inside the database; on a screen it becomes a
 *    tracking identifier with a longer life than the investigation that produced
 *    it.
 *
 * Acknowledging is an append to the record, not an edit of it: the event keeps its
 * severity, its summary and its evidence, and gains the name of whoever looked.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { and, desc, eq, isNotNull, isNull, type SQL } from 'drizzle-orm';
import { db } from '@/db/client';
import { organizations, securityEvents, userProfiles, users } from '@/db/schema';
import {
  Badge,
  Card,
  CardHead,
  Empty,
  TableScroll,
  formatDateTime,
  formatRelative,
} from '@/components/ui';
import { FilterLinks, PageHeader, Summary } from '@/components/partner/shell';
import { LiveRefresh } from '@/components/realtime/live-refresh';
import { requirePlatform } from '@/components/admin/guard';
import { ActionOutcome, MetadataTable } from '@/components/admin/parts';
import { firstParam, oneOf, withParam } from '@/components/admin/redact';
import { acknowledgeEvents, runSecuritySweep } from './actions';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = { title: 'Security' };
export const dynamic = 'force-dynamic';

const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] as const;
const STATES = ['OPEN', 'ACKNOWLEDGED'] as const;
const BASE = '/control/security';
/** The API acknowledges at most 50 ids in one call, so the page never offers more. */
const LIMIT = 50;

type Severity = (typeof SEVERITIES)[number];

function severityTone(severity: Severity): 'bad' | 'warn' | 'info' | 'neutral' {
  if (severity === 'CRITICAL' || severity === 'HIGH') return 'bad';
  if (severity === 'MEDIUM') return 'warn';
  if (severity === 'LOW') return 'info';
  return 'neutral';
}

export default async function ControlSecurityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requirePlatform('platform.security:read', BASE);
  const query = await searchParams;

  const severity = oneOf(query.severity, SEVERITIES);
  const state = oneOf(query.state, STATES);

  const where: (SQL | undefined)[] = [];
  if (severity) where.push(eq(securityEvents.severity, severity));
  if (state === 'OPEN') where.push(isNull(securityEvents.acknowledgedAt));
  if (state === 'ACKNOWLEDGED') where.push(isNotNull(securityEvents.acknowledgedAt));

  const rows = await db
    .select({
      id: securityEvents.id,
      kind: securityEvents.kind,
      severity: securityEvents.severity,
      summary: securityEvents.summary,
      metadata: securityEvents.metadata,
      requestId: securityEvents.requestId,
      userId: securityEvents.userId,
      organizationId: securityEvents.organizationId,
      acknowledgedAt: securityEvents.acknowledgedAt,
      acknowledgedByUserId: securityEvents.acknowledgedByUserId,
      createdAt: securityEvents.createdAt,
      subjectName: userProfiles.displayName,
      organizationName: organizations.name,
    })
    .from(securityEvents)
    .leftJoin(users, eq(users.id, securityEvents.userId))
    .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
    .leftJoin(organizations, eq(organizations.id, securityEvents.organizationId))
    .where(where.length ? and(...where) : undefined)
    // Ids are ULIDs, so newest-first is `id desc`.
    .orderBy(desc(securityEvents.id))
    .limit(LIMIT);

  // Severity first, then newest — a CRITICAL from this morning outranks a LOW
  // from this minute, and the queue is worked in that order.
  const ordered = [...rows].sort((a, b) => {
    const rank = SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity);
    return rank !== 0 ? rank : b.id.localeCompare(a.id);
  });

  const open = ordered.filter((event) => event.acknowledgedAt === null);
  const urgentOpen = open.filter(
    (event) => event.severity === 'CRITICAL' || event.severity === 'HIGH',
  ).length;

  const mayAcknowledge = ctx.permissions.has('platform.security:acknowledge');
  // Detection writes to the record, so it sits behind the same permission.
  const maySweep = mayAcknowledge;
  const current = { severity, state };
  const back = withParam(BASE, current, {});

  return (
    <div className="stack stack-5">
      <PageHeader
        eyebrow="Platform"
        title="Security"
        lede="Newest first within severity. Acknowledging an event records who looked and when — it never edits or deletes what was recorded."
        actions={
          <>
            {urgentOpen > 0 ? (
              <Badge tone="bad" dot>
                {urgentOpen} high or critical open
              </Badge>
            ) : (
              <Badge tone="ok" dot>
                nothing urgent open
              </Badge>
            )}
            <LiveRefresh
              types={['SECURITY_ALERT_CREATED']}
            noun="finding"
            />
          </>
        }
      />

      {maySweep ? (
        <Card>
          <div className="stack stack-3">
            <CardHead title="Run the detectors" />
            <p className="muted text-sm">
              Impossible travel, scan velocity, device bursts and credential stuffing, over the last three
              hours.
            </p>
            <p className="muted text-sm">
              Nothing runs these on a schedule in this build — there is no scheduler here, so the sweep is a
              button. It reads what is already recorded, files what meets a threshold, and skips anything it
              has filed before. It cannot suspend an account: that stays a decision someone makes on the
              account screen, with the evidence in front of them.
            </p>
            <p className="muted text-sm">
              Travel is measured between the venues where a pass was actually presented, not from IP
              addresses — {BRAND.name} stores only a one-way hash of an address, which cannot be geolocated, and
              that is worth keeping.
            </p>
            <form action={runSecuritySweep}>
              <input type="hidden" name="back" value={back} />
              <button className="btn btn-sm" type="submit">
                Sweep the last 3 hours
              </button>
            </form>
          </div>
        </Card>
      ) : null}

      <ActionOutcome error={firstParam(query.error)} done={firstParam(query.done)} />

      <Card>
        <div className="stack stack-4">
          <FilterLinks
            label="Filter security events by severity"
            current={severity}
            options={[
              { href: withParam(BASE, current, { severity: null }), label: 'Any severity', value: null },
              ...SEVERITIES.map((value) => ({
                href: withParam(BASE, current, { severity: value }),
                label: value.toLowerCase(),
                value,
              })),
            ]}
          />
          <FilterLinks
            label="Filter security events by state"
            current={state}
            options={[
              { href: withParam(BASE, current, { state: null }), label: 'All', value: null },
              { href: withParam(BASE, current, { state: 'OPEN' }), label: 'open', value: 'OPEN' },
              {
                href: withParam(BASE, current, { state: 'ACKNOWLEDGED' }),
                label: 'acknowledged',
                value: 'ACKNOWLEDGED',
              },
            ]}
          />
          <Summary
            items={[
              { label: 'Shown', value: `${ordered.length}${ordered.length === LIMIT ? ' (capped)' : ''}` },
              { label: 'Open', value: open.length },
              { label: 'High or critical', value: urgentOpen },
            ]}
          />
        </div>
      </Card>

      {ordered.length === 0 ? (
        <Card>
          <Empty
            title={severity || state ? 'Nothing matches that filter' : 'No security events'}
            body={
              severity || state
                ? 'No recorded event sits inside those filters.'
                : 'Nothing on this platform has yet done anything worth recording as a security event.'
            }
            action={
              severity || state ? (
                <Link className="btn btn-sm" href={BASE}>
                  Clear the filters
                </Link>
              ) : null
            }
          />
        </Card>
      ) : (
        <form action={acknowledgeEvents} className="stack stack-4">
          <input type="hidden" name="back" value={back} />

          {ordered.map((event) => (
            <Card key={event.id}>
              <div className="stack stack-4">
                <div className="row-between">
                  <div className="grow">
                    <p className="row-wrap" style={{ gap: 8 }}>
                      <Badge tone={severityTone(event.severity)} dot>
                        {event.severity.toLowerCase()}
                      </Badge>
                      <span className="mono small">{event.kind}</span>
                      {event.acknowledgedAt ? (
                        <Badge tone="neutral">acknowledged</Badge>
                      ) : (
                        <Badge tone="warn">open</Badge>
                      )}
                    </p>
                    <p style={{ marginTop: 6, fontWeight: 600 }}>{event.summary}</p>
                    <p className="tiny muted" style={{ marginTop: 4 }}>
                      {formatDateTime(event.createdAt)} · {formatRelative(event.createdAt)}
                      {event.requestId ? (
                        <>
                          {' '}
                          · request <span className="mono">{event.requestId}</span>
                        </>
                      ) : null}
                    </p>
                  </div>

                  {mayAcknowledge && !event.acknowledgedAt ? (
                    <label className="row small" style={{ gap: 8 }} htmlFor={`ack-${event.id}`}>
                      <input
                        id={`ack-${event.id}`}
                        type="checkbox"
                        name="eventIds"
                        value={event.id}
                      />
                      Acknowledge
                    </label>
                  ) : null}
                </div>

                <div className="grid grid-2">
                  <div>
                    <p className="eyebrow">Evidence</p>
                    <MetadataTable metadata={event.metadata} />
                  </div>
                  <div>
                    <p className="eyebrow">Subject</p>
                    <TableScroll>
                      <table className="table">
                        <tbody>
                          <tr>
                            <td className="small muted">Account</td>
                            <td className="small">
                              {event.userId ? (
                                <Link href={`/control/users/${event.userId}`}>
                                  {event.subjectName ?? BRAND.fallbackPersonName}
                                </Link>
                              ) : (
                                <span className="muted">none named</span>
                              )}
                            </td>
                          </tr>
                          <tr>
                            <td className="small muted">Organization</td>
                            <td className="small">
                              {event.organizationName ?? <span className="muted">none named</span>}
                            </td>
                          </tr>
                          <tr>
                            <td className="small muted">Event id</td>
                            <td className="tiny mono break-all">{event.id}</td>
                          </tr>
                          <tr>
                            <td className="small muted">Acknowledged</td>
                            <td className="small">
                              {event.acknowledgedAt ? (
                                <>
                                  {formatDateTime(event.acknowledgedAt)}
                                  {event.acknowledgedByUserId ? (
                                    <div className="tiny muted mono">
                                      by {event.acknowledgedByUserId}
                                    </div>
                                  ) : null}
                                </>
                              ) : (
                                <span className="muted">not yet</span>
                              )}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </TableScroll>
                  </div>
                </div>
              </div>
            </Card>
          ))}

          {mayAcknowledge && open.length > 0 ? (
            <Card>
              <CardHead title="Acknowledge the ticked events" />
              <div className="stack stack-3">
                <div className="field">
                  <label className="label" htmlFor="ack-note">
                    Note
                  </label>
                  <input
                    id="ack-note"
                    className="input"
                    name="note"
                    maxLength={500}
                    placeholder="Optional. Recorded against every event in this batch."
                  />
                </div>
                <button type="submit" className="btn btn-primary">
                  Acknowledge selected
                </button>
                <p className="tiny muted">
                  One audit entry is written per event, not per batch, so an event looked up later
                  shows who acknowledged it. An event someone else has already acknowledged is left
                  exactly as it is.
                </p>
              </div>
            </Card>
          ) : !mayAcknowledge ? (
            <Card>
              <p className="small muted">
                Acknowledging needs <span className="mono">platform.security:acknowledge</span>, which
                your platform role does not hold. This queue is read-only for you.
              </p>
            </Card>
          ) : null}
        </form>
      )}
    </div>
  );
}
