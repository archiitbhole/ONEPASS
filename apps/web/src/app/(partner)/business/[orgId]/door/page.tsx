/**
 * The door.
 *
 * ON CAMERA SCANNING — the honest answer, on the page as well as here.
 * `packages/pass/src/qr.js` is an encoder: it turns a reference into a module
 * matrix so a pass can be drawn. There is no decoder anywhere in the repository,
 * and `jsqr` is a devDependency of the pass package's tests rather than something
 * this app may import. Rather than open a camera that cannot read anything, this
 * console is built around the reference, which is printed under every QR and is
 * what staff fall back to anyway when a lens is dirty or a screen is cracked. A
 * USB or Bluetooth barcode scanner works today with no change: it types into the
 * field.
 *
 * Everything below the form is this organization's own admissions, read straight
 * from `tickets` with the tenant filter on.
 */
import type { Metadata } from 'next';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { ts } from '@/db/sql-helpers';
import { tickets, venues } from '@/db/schema';
import { Card, CardHead, Empty, Notice, StatusBadge, TableScroll, formatDateTime } from '@/components/ui';
import { requirePartner } from '@/components/partner/guard';
import { DoorConsole } from '@/components/partner/door-console';
import { PageHeader, Summary } from '@/components/partner/shell';
import { LiveRefresh } from '@/components/realtime/live-refresh';
import { startOfBusinessDay } from '@/components/partner/time';
import { admitAction } from './actions';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = { title: 'Door' };
export const dynamic = 'force-dynamic';

export default async function DoorPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const ctx = await requirePartner('partner.pass:verify', orgId, `/business/${orgId}/door`);
  const organizationId = ctx.organizationId;
  const dayStart = startOfBusinessDay();

  const recent = await db
    .select({
      id: tickets.id,
      publicRef: tickets.publicRef,
      title: tickets.title,
      subtitle: tickets.subtitle,
      seatLabel: tickets.seatLabel,
      admitCount: tickets.admitCount,
      admittedAt: tickets.admittedAt,
      state: tickets.state,
      venueName: venues.name,
    })
    .from(tickets)
    .leftJoin(venues, eq(venues.id, tickets.venueId))
    .where(
      and(
        eq(tickets.organizationId, organizationId),
        eq(tickets.state, 'ADMITTED'),
        gte(tickets.admittedAt, dayStart),
      ),
    )
    .orderBy(desc(tickets.admittedAt))
    .limit(25);

  const [counts] = await db
    .select({
      admitted: sql<number>`cast(count(*) filter (where ${tickets.state} = 'ADMITTED' and ${tickets.admittedAt} >= ${ts(dayStart)}) as int)`,
      guests: sql<number>`cast(coalesce(sum(${tickets.admitCount}) filter (where ${tickets.state} = 'ADMITTED' and ${tickets.admittedAt} >= ${ts(dayStart)}), 0) as int)`,
      outstanding: sql<number>`cast(count(*) filter (where ${tickets.state} = 'ISSUED' and ${tickets.validFrom} <= now() and (${tickets.validUntil} is null or ${tickets.validUntil} >= now())) as int)`,
    })
    .from(tickets)
    .where(eq(tickets.organizationId, organizationId));

  return (
    <div className="stack stack-5">
      <PageHeader
        eyebrow="Operate"
        title="Door"
        lede="Admit a ticket once, and exactly once. Two people scanning the same code at two doors will see one admission and one “already used”."
        actions={
          <LiveRefresh
            types={['TICKET_ADMITTED', 'BOOKING_CONFIRMED', 'BOOKING_CANCELLED']}
            noun="update"
          />
        }
      />

      <div className="split split-trail">
        <Card>
          <CardHead title="Scan console" />
          <DoorConsole action={admitAction.bind(null, organizationId)} />

          <Notice tone="info">
            <span>
              Camera scanning lives in the {BRAND.name} mobile app. This build ships a QR{' '}
              <strong>encoder</strong> only (packages/pass), so a browser here has nothing to decode with —
              type or scan the reference printed under the QR instead. A USB barcode scanner needs no setup.
            </span>
          </Notice>
        </Card>

        <div className="stack stack-4">
          <Card>
            <CardHead title="Today at the door" />
            <Summary
              items={[
                { label: 'Admitted', value: counts?.admitted ?? 0 },
                { label: 'Guests', value: counts?.guests ?? 0 },
                { label: 'Valid, not yet used', value: counts?.outstanding ?? 0 },
              ]}
            />
          </Card>

          <Card>
            <CardHead title="Recent admissions" action={<span className="small muted">Newest first</span>} />
            {recent.length === 0 ? (
              <Empty title="Nobody through yet today" body="Admissions appear here the moment a ticket is accepted." />
            ) : (
              <TableScroll>
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Time</th>
                      <th scope="col">Ticket</th>
                      <th scope="col">What</th>
                      <th scope="col" className="table-num">Admits</th>
                      <th scope="col">State</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((row) => (
                      <tr key={row.id}>
                        <td className="nowrap">
                          {row.admittedAt ? formatDateTime(row.admittedAt) : '—'}
                        </td>
                        <td className="mono nowrap">
                          {row.publicRef}
                        </td>
                        <td>
                          <span style={{ fontWeight: 600 }}>{row.title}</span>
                          {row.venueName ? <span className="muted"> · {row.venueName}</span> : null}
                          {row.seatLabel ? <span className="muted"> · seat {row.seatLabel}</span> : null}
                        </td>
                        <td className="table-num">{row.admitCount}</td>
                        <td>
                          <StatusBadge status={row.state} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
