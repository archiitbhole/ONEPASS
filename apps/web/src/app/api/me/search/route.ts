/**
 * Search your own things.
 *
 * The command palette in the consumer shell matches screen names in the browser,
 * which is instant and needs no server. What it cannot do in the browser is find
 * *your* ticket, *your* receipt, the warranty on the kettle — so this endpoint
 * does, across the five record types a person actually looks for by name.
 *
 * Three rules hold it together.
 *
 * **It is always the caller's own rows.** Every query filters on
 * `actor.userId`, taken from the session rather than from anything in the
 * request. There is no user parameter to tamper with, which is the only design
 * that cannot be got wrong later: a `userId` in the query string is one missing
 * check away from being everybody's search endpoint.
 *
 * **It returns what the row already shows them.** A title, a reference, a date —
 * the same fields the list pages render. No amounts, no merchant identifiers, no
 * passenger details; the palette is a way to reach a screen, and the screen is
 * where the detail lives, behind its own authorization.
 *
 * **It is a scan, and honest about it.** `ILIKE` over a handful of columns,
 * bounded to this user's rows and five hits per source. That is the right shape
 * for a personal record set — tens to hundreds of rows — and it is not a
 * full-text index; if someone's history ever outgrows it, the fix is
 * `pg_trgm` and a real index, not a bigger limit.
 */
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { bookings, flightBookings, receipts, tickets, warranties, organizations } from '@/db/schema';
import { json, route } from '@/lib/api';
import { authorize } from '@/lib/authz/authorize';

/** Per source, not in total: five tickets and five receipts beat ten tickets. */
const PER_SOURCE = 5;

const querySchema = z.object({
  // Two characters is where a search stops being a list of everything. The cap
  // is there because a 400-character `ILIKE` pattern is a CPU bill, not a query.
  q: z.string().trim().min(2).max(64),
});

export interface SearchHit {
  /** What to show. */
  title: string;
  /** The second line — a date, a seat, a reference. */
  detail: string | null;
  /** The group label on the right of the row. */
  where: string;
  href: string;
}

/**
 * Escape a user's text for `LIKE`.
 *
 * Without this a `%` types a match-everything into the pattern and `_` quietly
 * matches any character. Neither is an injection — the value is still a bound
 * parameter — but both make the search do something the person did not ask for.
 */
function likeTerm(value: string): string {
  return `%${value.replace(/([\\%_])/g, '\\$1')}%`;
}

/** A day, in the form the rest of the consumer app writes dates. */
const DAY = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'Asia/Kolkata',
});

function day(value: Date | string | null): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : DAY.format(date);
}

export const GET = route({ querySchema, rateLimit: { name: 'me:search' } }, async (ctx) => {
  // `self.profile:read` is the permission a person holds over their own account.
  // Every row below is theirs, so there is nothing else to ask for.
  const { actor } = await authorize({ permission: 'self.profile:read', actor: ctx.actor ?? undefined });

  const term = likeTerm(ctx.query.q);
  const mine = actor.userId;

  // Five independent, bounded queries rather than one union: each is a simple
  // indexed scan over one user's rows, and a source that fails or grows slow
  // cannot take the others with it.
  const [ticketRows, bookingRows, receiptRows, warrantyRows, tripRows] = await Promise.all([
    db
      .select({
        publicRef: tickets.publicRef,
        title: tickets.title,
        subtitle: tickets.subtitle,
        seatLabel: tickets.seatLabel,
        validFrom: tickets.validFrom,
      })
      .from(tickets)
      .where(
        and(
          eq(tickets.userId, mine),
          or(ilike(tickets.title, term), ilike(tickets.subtitle, term), ilike(tickets.publicRef, term)),
        ),
      )
      .orderBy(desc(tickets.validFrom))
      .limit(PER_SOURCE),

    // A booking has no title of its own — it is a slot at a business — so the
    // business's name is the thing a person would search for.
    db
      .select({
        publicRef: bookings.publicRef,
        status: bookings.status,
        startsAt: bookings.startsAt,
        organizationName: organizations.name,
      })
      .from(bookings)
      .innerJoin(organizations, eq(organizations.id, bookings.organizationId))
      .where(and(eq(bookings.userId, mine), or(ilike(organizations.name, term), ilike(bookings.publicRef, term))))
      .orderBy(desc(bookings.createdAt))
      .limit(PER_SOURCE),

    db
      .select({
        publicRef: receipts.publicRef,
        merchantReceiptNo: receipts.merchantReceiptNo,
        issuedAt: receipts.issuedAt,
        organizationName: organizations.name,
      })
      .from(receipts)
      .innerJoin(organizations, eq(organizations.id, receipts.organizationId))
      .where(
        and(
          eq(receipts.userId, mine),
          or(
            ilike(organizations.name, term),
            ilike(receipts.publicRef, term),
            ilike(receipts.merchantReceiptNo, term),
          ),
        ),
      )
      .orderBy(desc(receipts.issuedAt))
      .limit(PER_SOURCE),

    db
      .select({
        publicRef: warranties.publicRef,
        productName: warranties.productName,
        expiresOn: warranties.expiresOn,
      })
      .from(warranties)
      .where(
        and(
          eq(warranties.userId, mine),
          or(
            ilike(warranties.productName, term),
            ilike(warranties.serialNumber, term),
            ilike(warranties.publicRef, term),
          ),
        ),
      )
      .orderBy(desc(warranties.expiresOn))
      .limit(PER_SOURCE),

    // Flights are searched by where they go, which is how anybody refers to
    // them: "Delhi", "DEL BOM", or the reference off the confirmation.
    db
      .select({
        publicRef: flightBookings.publicRef,
        originCode: flightBookings.originCode,
        destinationCode: flightBookings.destinationCode,
        departAt: flightBookings.departAt,
        state: flightBookings.state,
      })
      .from(flightBookings)
      .where(
        and(
          eq(flightBookings.userId, mine),
          or(
            ilike(flightBookings.originCode, term),
            ilike(flightBookings.destinationCode, term),
            ilike(flightBookings.publicRef, term),
            ilike(sql`${flightBookings.originCode} || ' ' || ${flightBookings.destinationCode}`, term),
          ),
        ),
      )
      .orderBy(desc(flightBookings.createdAt))
      .limit(PER_SOURCE),
  ]);

  const hits: SearchHit[] = [
    ...ticketRows.map((row) => ({
      title: row.title,
      // The subtitle a ticket carries is already "Fri, 18 Sept, 3:50 pm"; adding
      // the date again next to it reads as a mistake, so the date is the
      // fallback for a ticket that has no subtitle rather than an addition.
      detail: [row.subtitle ?? day(row.validFrom), row.seatLabel].filter(Boolean).join(' · ') || null,
      where: 'Ticket',
      href: `/tickets/${row.publicRef}`,
    })),
    ...bookingRows.map((row) => ({
      title: row.organizationName,
      detail: [day(row.startsAt), row.status.toLowerCase()].filter(Boolean).join(' · ') || null,
      where: 'Booking',
      href: `/bookings/${row.publicRef}`,
    })),
    ...receiptRows.map((row) => ({
      title: row.organizationName,
      detail: [day(row.issuedAt), row.merchantReceiptNo].filter(Boolean).join(' · ') || null,
      where: 'Receipt',
      href: `/receipts/${row.publicRef}`,
    })),
    ...warrantyRows.map((row) => ({
      title: row.productName,
      detail: day(row.expiresOn) ? `Covered until ${day(row.expiresOn)}` : null,
      where: 'Warranty',
      href: `/warranties/${row.publicRef}`,
    })),
    ...tripRows.map((row) => ({
      title: `${row.originCode} → ${row.destinationCode}`,
      detail: [day(row.departAt), row.state.replaceAll('_', ' ').toLowerCase()].filter(Boolean).join(' · ') || null,
      where: 'Trip',
      href: `/travel/trips/${row.publicRef}`,
    })),
  ];

  return json({ hits });
});
