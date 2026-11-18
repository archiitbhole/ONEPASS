/**
 * The sweeps, and the sample-window re-anchor.
 *
 * Two jobs that both exist because time keeps moving after the data is written.
 *
 * THE SWEEPS. Several tables carry a state that is only correct until a moment
 * passes: an offer past its window is still LIVE, a hold past its expiry still
 * holds capacity, a ticket past its validity is still ISSUED. Verification
 * always compares against the clock, so nothing is ever *wrong* to a consumer —
 * but a merchant console that lists an ended offer as live is a console that
 * misreports, and capacity held by an abandoned checkout is capacity nobody can
 * buy. In production these run on a schedule; there is no scheduler here, so
 * this is the command that does it.
 *
 * THE RE-ANCHOR. The sample data turns on "tonight" meaning tonight. Seeded on Monday
 * and shown on Thursday, "Tonight at Phoenix — ₹149" ended three days ago and
 * the whole story collapses. Rather than re-seeding — which would throw away
 * the eight weeks of trading history the advisor needs — this shifts the
 * forward-looking rows onto the current day and leaves history where it is.
 *
 *   npm run db:refresh
 */
import { and, eq, gt, gte, lt, sql } from 'drizzle-orm';
import { ulid } from '@/lib/ids';
import { db } from './client';
import * as t from './schema';
import { expireStaleHolds } from '@/lib/commerce/inventory';
import { activateDueOffers, expireEndedOffers } from '@/lib/commerce/offers';
import { expireTickets } from '@/lib/commerce/tickets';
import { sweepNoShows } from '@/lib/commerce/booking';
import { NOW_SHOWING_LABEL } from './seed-commerce';

export interface SweepResult {
  expiredHolds: number;
  endedOffers: number;
  activatedOffers: number;
  expiredTickets: number;
  noShows: number;
}

/** Every time-driven state transition, in dependency order. */
export async function runSweeps(now = new Date()): Promise<SweepResult> {
  // Holds first: releasing capacity before offers are re-evaluated means an
  // offer is not marked sold out on the strength of capacity nobody holds.
  const expiredHolds = await expireStaleHolds(now.getTime());
  const activatedOffers = await activateDueOffers(now);
  const endedOffers = await expireEndedOffers(now);
  const expiredTickets = await expireTickets(now);
  const noShows = await sweepNoShows(now);

  return { expiredHolds, endedOffers, activatedOffers, expiredTickets, noShows };
}

/** Today at a given IST hour, as a UTC instant. */
function istToday(hour: number, minute = 0, dayOffset = 0): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + dayOffset);
  d.setUTCHours(hour - 5, minute - 30, 0, 0);
  return d;
}

/**
 * The same instant, rolled forward until it is actually ahead of now.
 *
 * `istToday` answers "19:00 today" literally, which is the wrong answer at
 * 20:30: the re-anchor moved "Tonight at Phoenix" onto an evening that had
 * already happened, the sweep immediately marked it ENDED again, and the whole
 * point of running the refresh was lost. Anyone opening the product after about
 * half past six in the evening saw no live deals at all — and because the rows
 * *had* just been rewritten, it looked like the data was fine.
 *
 * Rolling by whole days keeps the weekday-and-hour shape the forecaster reads,
 * so "tonight" becomes tomorrow evening rather than an hour from now.
 */
function nextIst(hour: number, minute = 0, dayOffset = 0, now = Date.now()): Date {
  let at = istToday(hour, minute, dayOffset);
  // A small margin, so a slot does not land two minutes ahead of the clock and
  // read as "starting now" on a screen meant to show something forthcoming.
  const margin = 5 * 60_000;
  let guard = 0;
  while (at.getTime() - margin <= now && guard < 14) {
    at = istToday(hour, minute, dayOffset + 1 + guard);
    guard += 1;
  }
  return at;
}

function daysUntilSaturday(): number {
  const today = new Date().getUTCDay();
  const delta = (6 - today + 7) % 7;
  // If today is Saturday, aim at the next one so "Saturday" is still ahead.
  return delta === 0 ? 7 : delta;
}

/**
 * The forward-looking sample rows, by the label the seed gave them.
 *
 * Matching on label rather than id because ids change on every re-seed and
 * these labels are the seed's own contract with this function. Each entry says
 * what hour that slot belongs at and how many days ahead.
 */
const LIVE_SLOTS: { label: string; hour: number; minute?: number; dayOffset: number; hours: number }[] = [
  { label: 'Tonight 19:00 — Screen 7 (IMAX)', hour: 19, dayOffset: 0, hours: 3 },
  { label: 'Tonight 20:00 — rooftop', hour: 20, dayOffset: 0, hours: 2 },
  { label: 'Evening bay — level 2', hour: 17, dayOffset: 0, hours: 6 },
  { label: 'Deluxe room — tomorrow', hour: 14, dayOffset: 1, hours: 20 },
];

/** Offers keyed to a slot label, with how long before the slot they close. */
const LIVE_OFFERS: { title: string; endsHour: number; endsMinute: number; dayOffset: number }[] = [
  { title: 'Tonight at Phoenix — ₹149 a seat', endsHour: 18, endsMinute: 30, dayOffset: 0 },
  { title: 'Rooftop dinner — 30% off tonight', endsHour: 19, endsMinute: 30, dayOffset: 0 },
  { title: 'Tomorrow night — ₹3,900 deluxe', endsHour: 12, endsMinute: 0, dayOffset: 1 },
  { title: 'Evening parking — ₹40 with any ticket', endsHour: 23, endsMinute: 0, dayOffset: 30 },
];

export interface RefreshResult {
  slotsMoved: number;
  offersMoved: number;
  saturdaySlotsMoved: number;
  /** 1 when the refresh had to issue a ticket so the door console has something to admit. */
  ticketsIssued: number;
  sweeps: SweepResult;
}

/**
 * Move the sample data's forward-looking rows onto the current day.
 *
 * Deliberately narrow: it touches only the rows the seed created with a
 * forward intent, named above. The eight weeks of trading history stay exactly
 * where they are, because that is what the advisor and the forecaster measure —
 * shifting it would move the Tuesday dip onto another weekday and make the
 * best finding in the walkthrough an accident.
 */
export async function refreshSampleWindow(): Promise<RefreshResult> {
  let slotsMoved = 0;
  let offersMoved = 0;

  for (const spec of LIVE_SLOTS) {
    const startsAt = nextIst(spec.hour, spec.minute ?? 0, spec.dayOffset);
    const endsAt = new Date(startsAt.getTime() + spec.hours * 3600_000);

    const rows = await db
      .update(t.inventorySlots)
      .set({ startsAt, endsAt, updatedAt: new Date() })
      .where(eq(t.inventorySlots.label, spec.label))
      .returning({ id: t.inventorySlots.id });
    slotsMoved += rows.length;
  }

  // The two Saturday slots move to the next Saturday, whichever day it is now.
  const sat = daysUntilSaturday();
  const saturdaySpecs = [
    { label: 'Saturday 15:00 — Screen 3', hour: 15, hours: 3 },
    { label: 'Saturday 20:00 — rooftop', hour: 20, hours: 2 },
  ];
  let saturdaySlotsMoved = 0;
  for (const spec of saturdaySpecs) {
    const startsAt = istToday(spec.hour, 0, sat);
    const rows = await db
      .update(t.inventorySlots)
      .set({ startsAt, endsAt: new Date(startsAt.getTime() + spec.hours * 3600_000), updatedAt: new Date() })
      .where(eq(t.inventorySlots.label, spec.label))
      .returning({ id: t.inventorySlots.id });
    saturdaySlotsMoved += rows.length;
  }

  for (const spec of LIVE_OFFERS) {
    const endsAt = nextIst(spec.endsHour, spec.endsMinute, spec.dayOffset);
    const rows = await db
      .update(t.offers)
      .set({
        startsAt: new Date(Date.now() - 3600_000),
        endsAt,
        // Back to LIVE: an offer swept to ENDED yesterday is the whole reason
        // this function exists.
        status: 'LIVE',
        updatedAt: new Date(),
      })
      .where(eq(t.offers.title, spec.title))
      .returning({ id: t.offers.id });
    offersMoved += rows.length;
  }

  const satOffers = [
    { title: 'Saturday matinée — ₹180', endsHour: 14 },
    { title: 'Saturday rooftop — 25% off', endsHour: 19 },
  ];
  for (const spec of satOffers) {
    const rows = await db
      .update(t.offers)
      .set({
        startsAt: new Date(Date.now() - 3600_000),
        endsAt: istToday(spec.endsHour, 0, sat),
        status: 'LIVE',
        updatedAt: new Date(),
      })
      .where(eq(t.offers.title, spec.title))
      .returning({ id: t.offers.id });
    offersMoved += rows.length;
  }

  // The one slot that is anchored to the clock rather than to a wall time.
  //
  // A ticket is admittable only between its slot's start and its end, so a venue
  // whose next session is at 19:00 can admit nobody at 11:00 — which meant the
  // door console, the surface this whole product is built around, was dead for
  // most of every day and could not be demonstrated or tested. A real multiplex
  // always has something on. This keeps one screening running: it started an
  // hour ago and has two hours left, whenever "now" happens to be.
  //
  // Created rather than only moved, because `seedCommerce` skips a database that
  // already has venues — so an existing installation would otherwise never
  // acquire this slot and would stay dead after an upgrade.
  const nowShowingStart = new Date(Date.now() - 60 * 60_000);
  const nowShowingEnd = new Date(nowShowingStart.getTime() + 3 * 3600_000);
  const nowShowingRows = await db
    .update(t.inventorySlots)
    .set({ startsAt: nowShowingStart, endsAt: nowShowingEnd, updatedAt: new Date() })
    .where(eq(t.inventorySlots.label, NOW_SHOWING_LABEL))
    .returning({ id: t.inventorySlots.id });
  if (nowShowingRows.length > 0) {
    slotsMoved += nowShowingRows.length;
  } else {
    await createNowShowingSlot(nowShowingStart, nowShowingEnd);
  }

  // A ticket for a slot that just moved forward should be valid again — and its
  // validity has to move with it.
  //
  // Setting the state back to ISSUED while leaving `valid_until` in the past
  // achieved nothing: `runSweeps()` below re-expired the ticket on the same
  // command, every time, so the sample data never had an admittable ticket after
  // its first evening. The window follows the booking's slot where there is one,
  // and falls back to a week ahead where there is not, which is the same shape
  // the seed issues with.
  const restorable = new Date(Date.now() - 30 * 86_400_000);
  await db
    .update(t.tickets)
    .set({
      state: 'ISSUED',
      validUntil: sql`coalesce(
        (select s.ends_at
           from ${t.bookings} b
           join ${t.inventorySlots} s on s.id = b.slot_id
          where b.id = ${t.tickets.bookingId}),
        now() + interval '7 days'
      )`,
      updatedAt: new Date(),
    })
    .where(and(eq(t.tickets.state, 'EXPIRED'), gte(t.tickets.validUntil, restorable)));

  // Put somebody in the screening that is on now.
  //
  // Every seeded booking sits on a show that has already happened — that is what
  // the eight weeks of trading history are — so once the original evening passed
  // there was no ISSUED ticket anywhere: the door console had nothing to admit
  // and the consumer's own Tickets page, the surface the whole walkthrough turns
  // on, read "Nothing to use yet".
  //
  // Two people, not one. The door test admits a ticket and thereby consumes it,
  // and if that were the only one the consumer's page would empty out behind it.
  // Two independent bookings also happen to be the more truthful picture of a
  // 180-seat screen.
  //
  // Booked through `holdBooking` and `confirmBooking` rather than inserted, for
  // the same reason the seed does: a row assembled by hand is a shape the
  // application never produces, and it is the capacity arithmetic and the ticket
  // issue that this is meant to exercise.
  let ticketsIssued = 0;
  // Two seats for the consumer the walkthrough follows, so her ticket reads the
  // way the seed's own booking did.
  ticketsIssued += await ensureAdmittableTicket('meera@example.in', 2);
  // One for the spare account, which is the one the door test consumes.
  ticketsIssued += await ensureAdmittableTicket('rahul@example.in', 1);

  // Sweeps last, so anything genuinely past is still marked past.
  const sweeps = await runSweeps();

  return { slotsMoved, offersMoved, saturdaySlotsMoved, ticketsIssued, sweeps };
}

/**
 * Create the in-progress screening on a database seeded before it existed.
 *
 * It borrows the cinema venue that the sample data's other screenings already
 * sit on rather than inventing one, so the slot belongs to a real organization
 * with real staff and the tenant filters on the door console apply to it
 * normally. If there is no cinema — a database that was never sample-seeded, or
 * a real deployment — nothing is created, which is the correct outcome: this is
 * sample scaffolding and it has no business appearing in someone's live venue.
 */
async function createNowShowingSlot(startsAt: Date, endsAt: Date): Promise<void> {
  const [cinema] = await db
    .select({ venueId: t.venues.id, organizationId: t.venues.organizationId })
    .from(t.venues)
    .where(eq(t.venues.kind, 'CINEMA'))
    .orderBy(t.venues.createdAt)
    .limit(1);
  if (!cinema) return;

  await db.insert(t.inventorySlots).values({
    id: ulid(),
    venueId: cinema.venueId,
    organizationId: cinema.organizationId,
    label: NOW_SHOWING_LABEL,
    unit: 'SEAT',
    startsAt,
    endsAt,
    capacity: 180,
    soldCount: 96,
    listPriceMinor: 30_000,
  });
}

/**
 * One confirmed booking on the screening that is running now, for one consumer,
 * if that consumer has nothing admittable.
 *
 * "Admittable" is the door's own test, not a looser one: `admitTicket` rejects a
 * ticket whose `validFrom` is still ahead with NOT_YET_VALID, so a check that
 * only asked for ISSUED-and-not-yet-expired was satisfied by a ticket for
 * tomorrow's show and left the console with nothing it could actually accept.
 * That is why this must book against the in-progress slot rather than the next
 * forward one — a ticket for a show that has not started is not a ticket the
 * door can take.
 */
async function ensureAdmittableTicket(email: string, quantity: number): Promise<number> {
  const now = new Date();

  const [consumer] = await db
    .select({ id: t.users.id })
    .from(t.users)
    .where(eq(t.users.email, email))
    .limit(1);
  if (!consumer) return 0;

  // Per consumer, not globally. A single global check was satisfied by somebody
  // else's ticket and left this person's own page empty.
  const [existing] = await db
    .select({ id: t.tickets.id })
    .from(t.tickets)
    .where(
      and(
        eq(t.tickets.userId, consumer.id),
        eq(t.tickets.state, 'ISSUED'),
        lt(t.tickets.validFrom, now),
        gt(t.tickets.validUntil, now),
      ),
    )
    .limit(1);
  if (existing) return 0;

  const [slot] = await db
    .select()
    .from(t.inventorySlots)
    .where(
      and(
        eq(t.inventorySlots.label, NOW_SHOWING_LABEL),
        lt(t.inventorySlots.startsAt, now),
        gt(t.inventorySlots.endsAt, now),
      ),
    )
    .limit(1);
  if (!slot) return 0;

  const { holdBooking, confirmBooking } = await import('@/lib/commerce/booking');
  try {
    const held = await holdBooking({
      userId: consumer.id,
      slotId: slot.id,
      quantity,
    });
    const confirmed = await confirmBooking({ bookingId: held.id, userId: consumer.id });
    return confirmed.ticket ? 1 : 0;
  } catch {
    // Sold out, or the slot moved under us. Not worth failing a refresh over —
    // the console simply has nothing to admit, which it already says clearly.
    return 0;
  }
}
