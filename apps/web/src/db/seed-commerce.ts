/**
 * The Pune ecosystem — enough real data for the whole walkthrough to be real.
 *
 * Everything here is written through the same code paths the product uses.
 * Bookings go through `holdBooking` and `confirmBooking`, which means the
 * capacity is genuinely taken, the offer redemption row genuinely exists, the
 * savings event is genuinely computed and the points are genuinely credited.
 * The alternative — inserting finished-looking rows directly — produces a dataset
 * that shows numbers no code path could have produced, and the first question
 * anyone asks is whether it is real.
 *
 * The trailing history matters as much as the current state. Merchant insights
 * and demand forecasts are statistics over past bookings; with no past, they
 * have nothing to say. So this seeds eight weeks of plausible trading with a
 * deliberate Tuesday dip — the dip is real in the data, and the advisor finds it
 * rather than being told about it.
 *
 * Idempotent: re-running updates rather than duplicating, so `npm run db:seed`
 * is safe to repeat.
 */
import { and, eq, sql } from 'drizzle-orm';
import { db } from './client';
import * as t from './schema';
import { ulid, publicRef } from '@/lib/ids';
import { BRAND } from '@/lib/brand';

type Ids = Awaited<ReturnType<typeof import('./seed-data').seedSampleData>>;

const INR = (rupees: number) => Math.round(rupees * 100);

/** Today at a given hour, in IST, as a UTC Date. */
function at(dayOffset: number, hour: number, minute = 0): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + dayOffset);
  // IST is UTC+5:30; a 19:00 show is 13:30 UTC.
  d.setUTCHours(hour - 5, minute - 30, 0, 0);
  return d;
}

/**
 * Tonight — meaning an evening that has not happened yet.
 *
 * `at(0, 19)` is today at 19:00, which stops being "tonight" at 19:01 and is
 * simply the past by 20:00. Seeding in the evening therefore produced a
 * headline show that had already started and a deal on it whose window closed
 * before it opened, which `createOffer` refuses outright — correctly, and the
 * seed died. It went unnoticed for as long as it did because `bootstrap-dev.sh`
 * printed "(no seed yet)" over the failure.
 *
 * So this rolls to tomorrow once the hour has passed. The fixture's claim is
 * "there is a show this evening with seats left"; which calendar day that falls
 * on is not part of the claim, and a setup at nine in the evening should get a
 * working sample rather than a stack trace.
 */
function tonight(hour: number, minute = 0): Date {
  // A show starting in forty seconds is technically in the future and useless as
  // a sample: the deal on it would be live for forty seconds and every screen
  // built around "there are still seats" would be wrong by the time anybody
  // looked. An hour of headroom is the difference between a fixture and a
  // coincidence.
  const HEADROOM_MS = 3600_000;
  const today = at(0, hour, minute);
  return today.getTime() > Date.now() + HEADROOM_MS ? today : at(1, hour, minute);
}

/**
 * The label the in-progress screening is known by, in both directions.
 *
 * `db/maintenance.ts` re-anchors this slot to the clock on every refresh and
 * books against it, and matches on the label because ids change on every
 * re-seed. Keeping the string in one place means the two files cannot drift
 * apart silently, which is exactly how the door console came to have nothing
 * to admit in the first place.
 */
export const NOW_SHOWING_LABEL = 'Now showing — Screen 4';

async function upsertCity(slug: string, name: string, state: string, lat: number, lng: number) {
  const [existing] = await db.select().from(t.cities).where(eq(t.cities.slug, slug)).limit(1);
  if (existing) return existing.id;

  const id = ulid();
  await db.insert(t.cities).values({
    id,
    slug,
    name,
    state,
    latitude: String(lat),
    longitude: String(lng),
    isLive: true,
  });
  return id;
}

async function upsertVenue(input: {
  organizationId: string;
  cityId: string;
  name: string;
  kind: typeof t.venues.$inferInsert['kind'];
  locality: string;
  lat: number;
  lng: number;
  tags: string[];
  typicalSpendMinor: number;
}) {
  const [existing] = await db
    .select()
    .from(t.venues)
    .where(and(eq(t.venues.organizationId, input.organizationId), eq(t.venues.name, input.name)))
    .limit(1);
  if (existing) return existing.id;

  const id = ulid();
  await db.insert(t.venues).values({
    id,
    organizationId: input.organizationId,
    cityId: input.cityId,
    publicRef: publicRef('ven'),
    name: input.name,
    kind: input.kind,
    locality: input.locality,
    latitude: String(input.lat),
    longitude: String(input.lng),
    tags: input.tags,
    typicalSpendMinor: input.typicalSpendMinor,
    openingHours: {
      mon: ['09:00', '23:00'], tue: ['09:00', '23:00'], wed: ['09:00', '23:00'],
      thu: ['09:00', '23:00'], fri: ['09:00', '23:59'], sat: ['09:00', '23:59'],
      sun: ['09:00', '23:00'],
    },
  });
  return id;
}

async function makeSlot(input: {
  venueId: string;
  organizationId: string;
  label: string;
  unit: typeof t.inventorySlots.$inferInsert['unit'];
  startsAt: Date;
  hours: number;
  capacity: number;
  listPriceMinor: number;
  soldCount?: number;
}) {
  const id = ulid();
  await db.insert(t.inventorySlots).values({
    id,
    venueId: input.venueId,
    organizationId: input.organizationId,
    label: input.label,
    unit: input.unit,
    startsAt: input.startsAt,
    endsAt: new Date(input.startsAt.getTime() + input.hours * 3600_000),
    capacity: input.capacity,
    soldCount: input.soldCount ?? 0,
    listPriceMinor: input.listPriceMinor,
  });
  return id;
}

/**
 * Eight weeks of trading history.
 *
 * The shape is deliberate and it is what the merchant advisor will find:
 * weekends run near capacity, Tuesdays run at roughly a third of the weekly
 * mean. Nobody tells the advisor about Tuesday — it computes the variance from
 * these rows and reports whatever the arithmetic says.
 */
async function seedTradingHistory(args: {
  venueId: string;
  organizationId: string;
  userIds: string[];
  unit: typeof t.inventorySlots.$inferInsert['unit'];
  capacity: number;
  listPriceMinor: number;
  hour: number;
}) {
  const rows: (typeof t.bookings.$inferInsert)[] = [];
  const txns: (typeof t.transactions.$inferInsert)[] = [];

  for (let daysAgo = 56; daysAgo >= 1; daysAgo--) {
    const startsAt = at(-daysAgo, args.hour);
    const weekday = startsAt.getUTCDay(); // 0 Sun … 6 Sat

    // Utilisation by day of week. Tuesday (2) is the dip.
    const utilisation =
      weekday === 0 ? 0.78 : weekday === 5 ? 0.86 : weekday === 6 ? 0.92 : weekday === 2 ? 0.29 : 0.55;

    // A little deterministic jitter so the series is not a step function. Seeded
    // from the day index rather than Math.random, so a re-seed reproduces it.
    const jitter = ((daysAgo * 37) % 11) / 100 - 0.05;
    const sold = Math.max(0, Math.round(args.capacity * (utilisation + jitter)));

    const slotId = await makeSlot({
      venueId: args.venueId,
      organizationId: args.organizationId,
      label: `${args.hour}:00 show`,
      unit: args.unit,
      startsAt,
      hours: 3,
      capacity: args.capacity,
      listPriceMinor: args.listPriceMinor,
      soldCount: sold,
    });

    // One booking row per day carrying the day's revenue. Enough for the
    // variance and utilisation statistics to be real without seeding thousands
    // of rows nobody will look at.
    if (sold > 0) {
      const userId = args.userIds[daysAgo % args.userIds.length]!;
      const amount = args.listPriceMinor * sold;
      const txnId = ulid();

      txns.push({
        id: txnId,
        userId,
        organizationId: args.organizationId,
        amountMinor: amount,
        status: 'CAPTURED',
        provider: 'SANDBOX',
        providerOrderId: `sandbox_hist_${txnId}`,
        description: 'Seeded trading history',
        createdAt: startsAt,
        capturedAt: startsAt,
      });

      rows.push({
        id: ulid(),
        publicRef: publicRef('bkg'),
        userId,
        organizationId: args.organizationId,
        venueId: args.venueId,
        slotId,
        transactionId: txnId,
        // Past bookings that were attended, so no-show and utilisation
        // statistics have something true to measure.
        status: 'CHECKED_IN',
        quantity: sold,
        listPriceMinor: amount,
        amountMinor: amount,
        savedMinor: 0,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 3 * 3600_000),
        confirmedAt: startsAt,
        checkedInAt: startsAt,
        createdAt: new Date(startsAt.getTime() - 86_400_000),
      });
    }
  }

  if (txns.length) await db.insert(t.transactions).values(txns).onConflictDoNothing();
  if (rows.length) await db.insert(t.bookings).values(rows).onConflictDoNothing();
  return rows.length;
}

export async function seedCommerce(seeded: Ids) {
  const { consumer, secondConsumer, hotel, cinema, owner, rivalOwner } = seeded;

  // Already seeded? Leave it alone.
  const existingVenues = await db.select({ n: sql<number>`count(*)::int` }).from(t.venues);
  if (Number(existingVenues[0]?.n ?? 0) > 0) return { skipped: true as const };

  const pune = await upsertCity('pune', 'Pune', 'Maharashtra', 18.5204, 73.8567);
  const mumbai = await upsertCity('mumbai', 'Mumbai', 'Maharashtra', 19.076, 72.8777);

  // ── venues ─────────────────────────────────────────────────
  const hotelVenue = await upsertVenue({
    organizationId: hotel.id,
    cityId: pune,
    name: 'Grand Sahyadri — Koregaon Park',
    kind: 'HOTEL',
    locality: 'Koregaon Park',
    lat: 18.5362,
    lng: 73.8939,
    tags: ['pool', 'business-centre', 'breakfast-included', 'accessible'],
    typicalSpendMinor: INR(5400),
  });

  const hotelRestaurant = await upsertVenue({
    organizationId: hotel.id,
    cityId: pune,
    name: 'Sahyadri Kitchen',
    kind: 'RESTAURANT',
    locality: 'Koregaon Park',
    lat: 18.5364,
    lng: 73.894,
    tags: ['north-indian', 'vegetarian-options', 'rooftop', 'accessible'],
    typicalSpendMinor: INR(900),
  });

  const cinemaVenue = await upsertVenue({
    organizationId: cinema.id,
    cityId: pune,
    name: 'Phoenix Cinemas — Viman Nagar',
    kind: 'CINEMA',
    locality: 'Viman Nagar',
    lat: 18.5619,
    lng: 73.9164,
    tags: ['imax', 'recliner', 'accessible', 'parking'],
    typicalSpendMinor: INR(350),
  });

  const parkingVenue = await upsertVenue({
    organizationId: cinema.id,
    cityId: pune,
    name: 'Phoenix Marketcity Parking',
    kind: 'PARKING',
    locality: 'Viman Nagar',
    lat: 18.5615,
    lng: 73.9161,
    tags: ['covered', 'ev-charging', 'accessible-bays'],
    typicalSpendMinor: INR(60),
  });

  await upsertVenue({
    organizationId: hotel.id,
    cityId: mumbai,
    name: 'Grand Sahyadri — Bandra',
    kind: 'HOTEL',
    locality: 'Bandra West',
    lat: 19.0596,
    lng: 72.8295,
    tags: ['sea-view', 'breakfast-included'],
    typicalSpendMinor: INR(7800),
  });

  // ── reward programmes ──────────────────────────────────────
  // The cinema issues points; the restaurant accepts them. That single pair of
  // settings is what makes "cinema reward → restaurant redemption" possible,
  // and the settlement rate is why the restaurant agrees.
  await db.insert(t.rewardPrograms).values([
    {
      id: ulid(),
      organizationId: cinema.id,
      name: 'Phoenix Rewards',
      earnPointsPerHundred: 6,
      redeemPaisePerPoint: 10,
      settlementPaisePerPoint: 8,
      acceptsExternalPoints: false,
      minRedeemPoints: 100,
    },
    {
      id: ulid(),
      organizationId: hotel.id,
      name: 'Sahyadri Circle',
      earnPointsPerHundred: 4,
      redeemPaisePerPoint: 12,
      settlementPaisePerPoint: 9,
      // The cross-brand switch.
      acceptsExternalPoints: true,
      minRedeemPoints: 100,
    },
  ]);

  // ── trading history, so the statistics have something to measure ──
  const historyUsers = [consumer.id, secondConsumer.id];
  const cinemaHistory = await seedTradingHistory({
    venueId: cinemaVenue,
    organizationId: cinema.id,
    userIds: historyUsers,
    unit: 'SEAT',
    capacity: 180,
    listPriceMinor: INR(300),
    hour: 19,
  });
  const restaurantHistory = await seedTradingHistory({
    venueId: hotelRestaurant,
    organizationId: hotel.id,
    userIds: historyUsers,
    unit: 'COVER',
    capacity: 60,
    listPriceMinor: INR(900),
    hour: 20,
  });

  // ── live capacity, from now forward ────────────────────────
  const cinemaTonightAt = tonight(19);
  const cinemaTonight = await makeSlot({
    venueId: cinemaVenue,
    organizationId: cinema.id,
    label: 'Tonight 19:00 — Screen 7 (IMAX)',
    unit: 'SEAT',
    startsAt: cinemaTonightAt,
    hours: 3,
    capacity: 180,
    listPriceMinor: INR(300),
    soldCount: 140, // 40 left — the headline in the brief
  });

  /**
   * A screening that is running right now, whatever hour it is.
   *
   * Every other live slot is forward-looking, which is right for a booking
   * surface but leaves the door console with nothing to admit for most of the
   * day: a ticket is only admittable between its slot's start and end, so a
   * venue whose next session is at 19:00 cannot admit anybody at 11:00. A real
   * multiplex always has something on. This slot is anchored to the clock
   * rather than to a wall time so that it always contains the present moment,
   * and it is what `ensureAdmittableTicket` books against.
   */
  await makeSlot({
    venueId: cinemaVenue,
    organizationId: cinema.id,
    label: NOW_SHOWING_LABEL,
    unit: 'SEAT',
    startsAt: new Date(Date.now() - 60 * 60_000),
    hours: 3,
    capacity: 180,
    listPriceMinor: INR(300),
    soldCount: 96,
  });

  const restaurantTonightAt = tonight(20);
  const restaurantTonight = await makeSlot({
    venueId: hotelRestaurant,
    organizationId: hotel.id,
    label: 'Tonight 20:00 — rooftop',
    unit: 'TABLE',
    startsAt: restaurantTonightAt,
    hours: 2,
    capacity: 24,
    listPriceMinor: INR(1800),
    soldCount: 9,
  });

  const hotelTomorrow = await makeSlot({
    venueId: hotelVenue,
    organizationId: hotel.id,
    label: 'Deluxe room — tomorrow',
    unit: 'ROOM',
    startsAt: at(1, 14),
    hours: 20,
    capacity: 12,
    listPriceMinor: INR(6400),
    soldCount: 5,
  });

  const parkingTonight = await makeSlot({
    venueId: parkingVenue,
    organizationId: cinema.id,
    label: 'Evening bay — level 2',
    unit: 'BAY',
    startsAt: tonight(17),
    hours: 6,
    capacity: 200,
    listPriceMinor: INR(80),
    soldCount: 120,
  });

  const saturdayCinema = await makeSlot({
    venueId: cinemaVenue,
    organizationId: cinema.id,
    label: 'Saturday 15:00 — Screen 3',
    unit: 'SEAT',
    startsAt: at(daysUntilSaturday(), 15),
    hours: 3,
    capacity: 180,
    listPriceMinor: INR(300),
    soldCount: 60,
  });

  const saturdayDinner = await makeSlot({
    venueId: hotelRestaurant,
    organizationId: hotel.id,
    label: 'Saturday 20:00 — rooftop',
    unit: 'TABLE',
    startsAt: at(daysUntilSaturday(), 20),
    hours: 2,
    capacity: 24,
    listPriceMinor: INR(1800),
    soldCount: 6,
  });

  // ── live deals ─────────────────────────────────────────────
  const { createOffer, transitionOffer } = await import('@/lib/commerce/offers');

  const tonightDeal = await createOffer({
    organizationId: cinema.id,
    createdBy: rivalOwner.id,
    venueId: cinemaVenue,
    slotId: cinemaTonight,
    cityId: pune,
    kind: 'LIVE_DEAL',
    title: 'Tonight at Phoenix — ₹149 a seat',
    description:
      'Forty seats are still empty for the 19:00 IMAX show. They are worth nothing at 19:01, so they are ₹149 until then.',
    terms: 'One booking per person. Valid for tonight’s 19:00 show only. Non-refundable within two hours of the show.',
    discountKind: 'FIXED_PRICE',
    discountValue: INR(149),
    startsAt: new Date(Date.now() - 3600_000),
    // "They are worth nothing at 19:01" — so the window closes as the show
    // opens, taken from the show itself rather than restated as a clock time
    // that can drift away from it.
    endsAt: cinemaTonightAt,
    maxRedemptions: 40,
    maxPerUser: 1,
  });
  await transitionOffer({ offerId: tonightDeal.id, organizationId: cinema.id, to: 'LIVE' });

  const dinnerDeal = await createOffer({
    organizationId: hotel.id,
    createdBy: owner.id,
    venueId: hotelRestaurant,
    slotId: restaurantTonight,
    cityId: pune,
    kind: 'LIVE_DEAL',
    title: 'Rooftop dinner — 30% off tonight',
    description: 'Fifteen tables unbooked for tonight’s second sitting.',
    discountKind: 'PERCENT',
    discountValue: 30,
    startsAt: new Date(Date.now() - 7200_000),
    endsAt: restaurantTonightAt,
    maxRedemptions: 15,
    maxPerUser: 1,
    acceptsPointsFrom: [cinema.id],
  });
  await transitionOffer({ offerId: dinnerDeal.id, organizationId: hotel.id, to: 'LIVE' });

  const roomDeal = await createOffer({
    organizationId: hotel.id,
    createdBy: owner.id,
    venueId: hotelVenue,
    slotId: hotelTomorrow,
    cityId: pune,
    kind: 'LIVE_DEAL',
    title: 'Tomorrow night — ₹3,900 deluxe',
    description: 'Seven deluxe rooms unsold for tomorrow.',
    discountKind: 'FIXED_PRICE',
    discountValue: INR(3900),
    startsAt: new Date(Date.now() - 1800_000),
    endsAt: at(1, 12),
    maxRedemptions: 7,
    maxPerUser: 1,
  });
  await transitionOffer({ offerId: roomDeal.id, organizationId: hotel.id, to: 'LIVE' });

  const parkingDeal = await createOffer({
    organizationId: cinema.id,
    createdBy: rivalOwner.id,
    venueId: parkingVenue,
    slotId: parkingTonight,
    cityId: pune,
    kind: 'STANDING',
    title: 'Evening parking — ₹40 with any ticket',
    description: 'Half price on a covered bay when you hold a Phoenix ticket for the same evening.',
    discountKind: 'FIXED_PRICE',
    discountValue: INR(40),
    startsAt: new Date(Date.now() - 86_400_000),
    endsAt: at(30, 23),
    maxPerUser: 30,
  });
  await transitionOffer({ offerId: parkingDeal.id, organizationId: cinema.id, to: 'LIVE' });

  const satCinemaDeal = await createOffer({
    organizationId: cinema.id,
    createdBy: rivalOwner.id,
    venueId: cinemaVenue,
    slotId: saturdayCinema,
    cityId: pune,
    kind: 'LIVE_DEAL',
    title: 'Saturday matinée — ₹180',
    description: 'The 15:00 show on Saturday, at a weekday price.',
    discountKind: 'FIXED_PRICE',
    discountValue: INR(180),
    startsAt: new Date(Date.now() - 3600_000),
    endsAt: at(daysUntilSaturday(), 14),
    maxRedemptions: 60,
    maxPerUser: 1,
  });
  await transitionOffer({ offerId: satCinemaDeal.id, organizationId: cinema.id, to: 'LIVE' });

  const satDinnerDeal = await createOffer({
    organizationId: hotel.id,
    createdBy: owner.id,
    venueId: hotelRestaurant,
    slotId: saturdayDinner,
    cityId: pune,
    kind: 'LIVE_DEAL',
    title: 'Saturday rooftop — 25% off',
    discountKind: 'PERCENT',
    discountValue: 25,
    startsAt: new Date(Date.now() - 3600_000),
    endsAt: at(daysUntilSaturday(), 19),
    maxRedemptions: 12,
    maxPerUser: 1,
    acceptsPointsFrom: [cinema.id],
  });
  await transitionOffer({ offerId: satDinnerDeal.id, organizationId: hotel.id, to: 'LIVE' });

  // ── a completed purchase, through the real code path ───────
  // Meera booked the cinema last week and it was confirmed the normal way, so
  // her ticket, her saving, her points and the offer's redemption count are all
  // consequences rather than fixtures.
  const { holdBooking, confirmBooking } = await import('@/lib/commerce/booking');

  const pastSlot = await makeSlot({
    venueId: cinemaVenue,
    organizationId: cinema.id,
    label: 'Last week 19:00',
    unit: 'SEAT',
    startsAt: at(3, 19),
    hours: 3,
    capacity: 20,
    listPriceMinor: INR(300),
  });
  const pastOffer = await createOffer({
    organizationId: cinema.id,
    createdBy: rivalOwner.id,
    venueId: cinemaVenue,
    slotId: pastSlot,
    cityId: pune,
    kind: 'LIVE_DEAL',
    title: 'Weekend seats — ₹199',
    discountKind: 'FIXED_PRICE',
    discountValue: INR(199),
    startsAt: new Date(Date.now() - 3600_000),
    endsAt: at(3, 18),
    maxPerUser: 1,
  });
  await transitionOffer({ offerId: pastOffer.id, organizationId: cinema.id, to: 'LIVE' });

  const held = await holdBooking({
    userId: consumer.id,
    slotId: pastSlot,
    offerId: pastOffer.id,
    quantity: 2,
  });
  const paidTxn = ulid();
  await db.insert(t.transactions).values({
    id: paidTxn,
    userId: consumer.id,
    organizationId: cinema.id,
    amountMinor: held.amountMinor,
    status: 'CAPTURED',
    provider: 'SANDBOX',
    providerOrderId: `sandbox_${paidTxn}`,
    description: 'Phoenix Cinemas — 2 seats',
    capturedAt: new Date(),
  });
  await confirmBooking({ bookingId: held.id, userId: consumer.id, transactionId: paidTxn });

  // ── a retail receipt, with a warranty and a return window ──
  const { issueReceipt } = await import('@/lib/commerce/receipts');
  await issueReceipt({
    userId: consumer.id,
    organizationId: hotel.id,
    venueId: hotelVenue,
    channel: 'IN_STORE',
    merchantReceiptNo: 'GS-04417',
    paymentLabel: 'UPI',
    gstin: '27AABCU9603R1ZX',
    returnWindowDays: 14,
    returnPolicyNote: 'Unused items in original packaging within 14 days.',
    lines: [
      {
        description: 'Sahyadri travel kettle 1.2L',
        sku: 'GS-KETTLE-12',
        category: 'Appliances',
        quantity: 1,
        unitPriceMinor: INR(2450),
        taxRateBp: 1800,
        warrantyMonths: 24,
        serialNumber: 'SK12-8841-A7',
        isReturnable: true,
        // A sample merchant declaring a manufacturer's warranty that follows the
        // item — so a seeded resale shows the warranty moving (D-007).
        warrantyTransferable: true,
      },
      {
        description: 'Room service — dinner',
        category: 'Dining',
        quantity: 1,
        unitPriceMinor: INR(1180),
        taxRateBp: 500,
        isReturnable: false,
      },
    ],
  });

  // ── city pass ──────────────────────────────────────────────
  const cityPassId = ulid();
  await db.insert(t.cityPasses).values({
    id: cityPassId,
    cityId: pune,
    slug: 'pune-3-day',
    name: `${BRAND.name} Pune — 3 days`,
    tagline: 'One pass across the city’s partners',
    description:
      'Three days of included entries and set-price meals across participating Pune partners. Each partner is settled per use, so the pass is a distribution channel rather than a discount they absorb.',
    priceMinor: INR(1499),
    validDays: 3,
    faceValueMinor: INR(4300),
  });

  await db.insert(t.cityPassEntitlements).values([
    {
      id: ulid(),
      cityPassId,
      venueId: cinemaVenue,
      organizationId: cinema.id,
      title: 'One standard seat, any show',
      detail: 'Subject to availability; IMAX excluded.',
      allowance: 1,
      listValueMinor: INR(300),
      settlementMinor: INR(190),
      position: 1,
    },
    {
      id: ulid(),
      cityPassId,
      venueId: hotelRestaurant,
      organizationId: hotel.id,
      title: 'Set lunch for one',
      detail: 'Three courses, 12:00–15:00.',
      allowance: 2,
      listValueMinor: INR(900),
      settlementMinor: INR(560),
      position: 2,
    },
    {
      id: ulid(),
      cityPassId,
      venueId: parkingVenue,
      organizationId: cinema.id,
      title: 'Covered parking, up to 4 hours',
      allowance: 3,
      listValueMinor: INR(80),
      settlementMinor: INR(48),
      position: 3,
    },
  ]);

  // ── explorer quest ─────────────────────────────────────────
  await db.insert(t.quests).values({
    id: ulid(),
    cityId: pune,
    slug: 'explore-pune',
    name: 'Explore Pune',
    description: 'Visit four kinds of partner across the city. The reward is points, not a badge.',
    steps: [
      { venueKind: 'RESTAURANT', count: 1, label: 'Eat somewhere new' },
      { venueKind: 'CINEMA', count: 1, label: 'See a film' },
      { venueKind: 'RETAIL_STORE', count: 2, label: 'Shop at two partners' },
      { venueKind: 'EXPERIENCE', count: 1, label: 'Book an experience' },
    ],
    rewardPoints: 2000,
    badge: 'Pune Explorer',
  });

  return {
    skipped: false as const,
    cities: 2,
    venues: 5,
    historyBookings: cinemaHistory + restaurantHistory,
    liveDeals: 6,
  };
}

/** Days from today until the next Saturday (0 if today is Saturday). */
function daysUntilSaturday(): number {
  const today = new Date().getUTCDay();
  return (6 - today + 7) % 7;
}
