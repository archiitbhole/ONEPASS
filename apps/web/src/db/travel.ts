/**
 * ONEPASS — the travel layer, and the data AirIndex is computed from.
 *
 * AirIndex is not a second product bolted to the side of ONEPASS. It is the
 * intelligence layer over one thing this file adds: a record of what flights
 * actually cost, observed at the moment somebody searched. Everything AirIndex
 * reports — a fare index, a route's typical price, whether an airline is dearer
 * on a Tuesday — is an aggregate over `flight_price_observations` and nothing
 * else. There is no separate store of "insights" to drift out of step with the
 * prices they came from, and no figure anywhere in the product that cannot be
 * traced back to rows in that one table.
 *
 * **What this file deliberately does not add.**
 *
 * The duplication rule in extensions.ts applies here with more force, because a
 * travel vertical is exactly the kind of feature that grows a parallel copy of
 * everything:
 *
 *  · **No payments table.** A flight is paid for through `transactions`, the
 *    same row type a cinema seat uses, with the same idempotency key and the
 *    same provider webhook. `flight_bookings.transaction_id` is the join.
 *  · **No rewards table.** Points earned on a flight are entries in
 *    `reward_ledger`. The ledger is append-only and already reconciles; a
 *    second one would only mean two balances to disagree.
 *  · **No receipts table.** A ticketed booking issues a `receipt` with
 *    `receipt_lines`, so a flight appears in /receipts beside everything else.
 *  · **No trip table.** A trip is an `itinerary` — the planner ONEPASS already
 *    has — with kind `JOURNEY` and flights attached to `itinerary_items` by
 *    `flight_booking_id`. One planner, one trip list, one timeline.
 *  · **No second offers table.** `offers` prices a merchant's own inventory.
 *    A `flight_offer` is a quote from an external airline or aggregator with an
 *    expiry measured in minutes; it is not inventory ONEPASS holds, and it is
 *    never `LIVE`, `PAUSED` or `SOLD_OUT`. The two have almost no columns in
 *    common, which is the test for whether they are the same thing.
 *
 * **Airports and airlines are reference data, not tenants.** An airline is not
 * an `organization` — it has no ONEPASS account, no members and no venues — and
 * an airport is not a `venue`, because a venue is a place that publishes
 * capacity ONEPASS can sell. They are lookup tables, seeded from public data,
 * and they exist so a route can be named in words rather than in IATA codes.
 *
 * **Three rules carried over unchanged.** Money is integer minor units. Anything
 * derived records how it was derived. Anything a third party can see is
 * addressed by a random `public_ref`.
 *
 * **And one rule specific to this layer.** A row here may record what a provider
 * said, never what ONEPASS wishes it had said. There is no seat, fare, booking
 * or ticket in these tables that did not come from a provider response, and the
 * provider that produced it is recorded on every one of them.
 */
import { relations } from 'drizzle-orm';
import {
  boolean,
  char,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { organizations, transactions, users } from './schema';
import { itineraries } from './commerce';

/** See schema.ts — bytea that survives Drizzle's JSON-aggregating joins. */
const bytea = customType<{ data: Buffer; driverData: Buffer | string }>({
  dataType: () => 'bytea',
  fromDriver(value) {
    if (Buffer.isBuffer(value)) return value;
    if (typeof value === 'string') {
      return value.startsWith('\\x') ? Buffer.from(value.slice(2), 'hex') : Buffer.from(value, 'binary');
    }
    return Buffer.from(value as Uint8Array);
  },
  toDriver: (value) => value,
});

const id = () => char('id', { length: 26 }).primaryKey();
const fk = (name: string) => char(name, { length: 26 });
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const now = () => ts('created_at').defaultNow().notNull();
const money = (name: string) => integer(name);
const iata = (name: string) => char(name, { length: 3 });

// ─────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────

/**
 * Which system the row came from.
 *
 * Recorded on offers, observations, bookings and events alike, because the first
 * question about a wrong price is always "who told us that", and the second is
 * "is it still telling us that". `SAMPLE` is the development source; env.ts
 * refuses to boot production with it enabled, so a sample fare can never be sold.
 */
export const flightSource = pgEnum('flight_source', ['AMADEUS', 'DUFFEL', 'SAMPLE']);

export const cabinClass = pgEnum('cabin_class', ['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST']);

export const tripKind = pgEnum('flight_trip_kind', ['ONE_WAY', 'RETURN', 'MULTI_CITY']);

export const passengerKind = pgEnum('passenger_kind', ['ADULT', 'CHILD', 'INFANT']);

/**
 * The booking state machine.
 *
 * Written out in full rather than reduced to "pending / done / failed", because
 * every one of these states has a different correct action attached to it and
 * collapsing them is how a customer ends up charged for a booking that was never
 * made. The failure states are first-class for the same reason: PAYMENT_AUTHORIZED
 * with BOOKING_FAILED is a refund, not a retry, and nothing can tell the
 * difference if both are simply "error".
 *
 * Forward transitions are enforced in code by `canTransition()` in
 * lib/travel/booking-state.ts, which is the single place that knows the graph.
 */
export const flightBookingState = pgEnum('flight_booking_state', [
  'OFFER_SELECTED',
  'REVALIDATING',
  'PRICE_CONFIRMED',
  'PAYMENT_PENDING',
  'PAYMENT_AUTHORIZED',
  'BOOKING_PENDING',
  'CONFIRMED',
  'TICKETED',
  // Terminal or near-terminal states, each with its own remedy.
  'REVALIDATION_FAILED',
  'PRICE_CHANGED',
  'PAYMENT_FAILED',
  'BOOKING_FAILED',
  'CANCELLED',
  'REFUNDED',
]);

export const flightTicketState = pgEnum('flight_ticket_state', [
  'ISSUED',
  'USED',
  'VOID',
  'REFUNDED',
  'EXCHANGED',
]);

/**
 * Cashback moves through states rather than appearing as a balance.
 *
 * PENDING covers the window in which the airline can still cancel the ticket;
 * APPROVED means that window closed; CREDITED means an entry exists in
 * `reward_ledger` and the money is actually in the customer's hands. REVERSED
 * and EXPIRED are the two ways it can end without being paid. A row never skips
 * CREDITED — that is what makes double-crediting detectable rather than merely
 * unlikely.
 */
export const cashbackState = pgEnum('cashback_state', [
  'PENDING',
  'APPROVED',
  'CREDITED',
  'REVERSED',
  'EXPIRED',
]);

/** What kind of instrument a bank offer applies to. */
export const instrumentKind = pgEnum('bank_instrument_kind', [
  'CREDIT_CARD',
  'DEBIT_CARD',
  'UPI',
  'NETBANKING',
  'WALLET',
  'EMI',
]);

/** How a provider call ended. Drives provider health and the status page. */
export const providerCallResult = pgEnum('provider_call_result', [
  'OK',
  'EMPTY',
  'TIMEOUT',
  'RATE_LIMITED',
  'AUTH_FAILED',
  'PROVIDER_ERROR',
  'INVALID_RESPONSE',
  'NOT_CONFIGURED',
]);

// ─────────────────────────────────────────────────────────────
// Reference data
// ─────────────────────────────────────────────────────────────

/**
 * Airports, by IATA code.
 *
 * Seeded from public aviation data. Held locally rather than looked up per
 * search because a place-name search has to answer in a few milliseconds while
 * somebody types, and because an origin the user picked must still resolve to
 * the same airport tomorrow.
 *
 * `cityCode` is the IATA *city* code, which is how a search for "all London
 * airports" or "all Delhi airports" works without a hand-maintained list.
 */
export const airports = pgTable(
  'airports',
  {
    code: iata('code').primaryKey(),
    name: varchar('name', { length: 160 }).notNull(),
    city: varchar('city', { length: 120 }).notNull(),
    cityCode: iata('city_code'),
    country: varchar('country', { length: 80 }).notNull(),
    countryCode: char('country_code', { length: 2 }).notNull(),
    timeZone: varchar('time_zone', { length: 64 }).notNull(),
    /** For "airports near me" and for great-circle distance on a route. */
    latitude: varchar('latitude', { length: 20 }),
    longitude: varchar('longitude', { length: 20 }),
    /** Domestic Indian airports carry the bulk of the traffic this serves. */
    isDomestic: boolean('is_domestic').default(false).notNull(),
    active: boolean('active').default(true).notNull(),
    createdAt: now(),
  },
  (t) => [
    index('airports_city_idx').on(t.cityCode),
    index('airports_country_idx').on(t.countryCode),
    index('airports_name_idx').on(t.name),
  ],
);

/**
 * Airlines, by IATA code.
 *
 * Deliberately thin. A rating, a punctuality figure or a "quality score" is not
 * a property of an airline — it is a statement about observations, and it lives
 * in the AirIndex queries that compute it from `flight_price_observations` and
 * `flight_segments`. Putting a score here would make it something somebody could
 * type in.
 */
export const airlines = pgTable(
  'airlines',
  {
    code: char('code', { length: 2 }).primaryKey(),
    name: varchar('name', { length: 120 }).notNull(),
    countryCode: char('country_code', { length: 2 }),
    /** Low-cost carriers price very differently; worth separating in comparisons. */
    isLowCost: boolean('is_low_cost').default(false).notNull(),
    active: boolean('active').default(true).notNull(),
    createdAt: now(),
  },
  (t) => [index('airlines_name_idx').on(t.name)],
);

// ─────────────────────────────────────────────────────────────
// Search and offers
// ─────────────────────────────────────────────────────────────

/**
 * One search somebody ran.
 *
 * Kept for three reasons that each justify it on their own: every price
 * observation points at the search that produced it, so a suspicious figure can
 * be traced to the exact query; a returning user's results can be re-shown
 * without re-charging a provider for the same query; and provider latency is
 * measured against real traffic rather than a synthetic probe.
 *
 * `userId` is nullable because the search page is usable signed out. Nothing
 * about a person is stored here beyond the link — no IP address, no device, no
 * fingerprint.
 */
export const flightSearches = pgTable(
  'flight_searches',
  {
    id: id(),
    publicRef: varchar('public_ref', { length: 32 }).notNull(),
    userId: fk('user_id').references(() => users.id, { onDelete: 'set null' }),

    tripKind: tripKind('trip_kind').notNull(),
    /**
     * The slices asked for. One for a one-way, two for a return, up to six for a
     * multi-city. Held as JSON rather than a child table because a search is
     * immutable the moment it is made and nothing ever queries a single slice.
     */
    slices: jsonb('slices')
      .$type<{ origin: string; destination: string; departOn: string }[]>()
      .notNull(),

    cabin: cabinClass('cabin').default('ECONOMY').notNull(),
    adults: smallint('adults').default(1).notNull(),
    children: smallint('children').default(0).notNull(),
    infants: smallint('infants').default(0).notNull(),

    /** ±1, ±2 or ±3 days. Zero means the dates as given. */
    flexDays: smallint('flex_days').default(0).notNull(),
    directOnly: boolean('direct_only').default(false).notNull(),
    maxPriceMinor: money('max_price_minor'),
    currency: char('currency', { length: 3 }).default('INR').notNull(),

    /** How many providers were asked, and how many answered with something. */
    providersQueried: smallint('providers_queried').default(0).notNull(),
    providersAnswered: smallint('providers_answered').default(0).notNull(),
    offerCount: integer('offer_count').default(0).notNull(),
    /** Wall-clock milliseconds for the whole fan-out, as the user experienced it. */
    elapsedMs: integer('elapsed_ms'),

    createdAt: now(),
    /** Results stop being shown after this; a stale fare is worse than none. */
    expiresAt: ts('expires_at').notNull(),
  },
  (t) => [
    uniqueIndex('flight_searches_public_ref_key').on(t.publicRef),
    index('flight_searches_user_created_idx').on(t.userId, t.createdAt),
    index('flight_searches_created_idx').on(t.createdAt),
  ],
);

/**
 * A priced, bookable quote from one provider.
 *
 * Every money column is in minor units and every one of them is what the
 * provider said, not a number ONEPASS derived. The split matters: the total a
 * customer is shown must be the sum of parts that can each be named, or "taxes
 * and fees" becomes the place inconvenient amounts are hidden. `/travel`
 * displays this breakdown in full before payment, which is the whole point of
 * storing it separately.
 *
 * `expiresAt` is the provider's own expiry. Past it the offer is not sold — it is
 * revalidated, and if the price moved the customer is told the old figure and the
 * new one and asked again.
 */
export const flightOffers = pgTable(
  'flight_offers',
  {
    id: id(),
    publicRef: varchar('public_ref', { length: 32 }).notNull(),
    searchId: fk('search_id')
      .notNull()
      .references(() => flightSearches.id, { onDelete: 'cascade' }),

    source: flightSource('source').notNull(),
    /** The provider's own identifier, which is what a booking call needs. */
    providerOfferId: varchar('provider_offer_id', { length: 200 }).notNull(),

    /** Denormalised from the segments so results can be sorted without a join. */
    originCode: iata('origin_code').notNull(),
    destinationCode: iata('destination_code').notNull(),
    departAt: ts('depart_at').notNull(),
    arriveAt: ts('arrive_at').notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    stops: smallint('stops').default(0).notNull(),
    marketingCarrier: char('marketing_carrier', { length: 2 }).notNull(),
    cabin: cabinClass('cabin').notNull(),

    /** The named parts of the price. total = base + tax + providerFee + platformFee. */
    baseMinor: money('base_minor').notNull(),
    taxMinor: money('tax_minor').default(0).notNull(),
    providerFeeMinor: money('provider_fee_minor').default(0).notNull(),
    platformFeeMinor: money('platform_fee_minor').default(0).notNull(),
    totalMinor: money('total_minor').notNull(),
    currency: char('currency', { length: 3 }).default('INR').notNull(),
    /** Per whole ticket; the total above is for the whole party. */
    perPassengerMinor: money('per_passenger_minor').notNull(),

    fareBrand: varchar('fare_brand', { length: 80 }),
    refundable: boolean('refundable'),
    changeable: boolean('changeable'),
    /** Free checked allowance, as the provider stated it. Null means unstated. */
    checkedBagKg: smallint('checked_bag_kg'),
    cabinBagKg: smallint('cabin_bag_kg'),
    seatsRemaining: smallint('seats_remaining'),

    /**
     * The provider's response for this offer, kept verbatim.
     *
     * Not for display — nothing renders out of this. It is here so a dispute
     * about what was offered is settled by what the provider actually sent, and
     * so a mapping bug can be diagnosed after the fact rather than reproduced.
     * Scrubbed of anything that identifies a person before it is written.
     */
    raw: jsonb('raw'),

    createdAt: now(),
    expiresAt: ts('expires_at').notNull(),
  },
  (t) => [
    uniqueIndex('flight_offers_public_ref_key').on(t.publicRef),
    uniqueIndex('flight_offers_provider_key').on(t.searchId, t.source, t.providerOfferId),
    index('flight_offers_search_price_idx').on(t.searchId, t.totalMinor),
    index('flight_offers_route_depart_idx').on(t.originCode, t.destinationCode, t.departAt),
  ],
);

/**
 * One leg of an offer.
 *
 * `sliceIndex` separates the outbound from the return; `position` orders the legs
 * within a slice. A two-stop return flight is four rows, and the connection time
 * a passenger actually experiences is the gap between consecutive rows rather
 * than a number somebody computed and stored.
 */
export const flightSegments = pgTable(
  'flight_segments',
  {
    id: id(),
    offerId: fk('offer_id')
      .notNull()
      .references(() => flightOffers.id, { onDelete: 'cascade' }),

    sliceIndex: smallint('slice_index').default(0).notNull(),
    position: smallint('position').default(0).notNull(),

    marketingCarrier: char('marketing_carrier', { length: 2 }).notNull(),
    /** Often the same, occasionally not — and a codeshare is worth showing. */
    operatingCarrier: char('operating_carrier', { length: 2 }),
    flightNumber: varchar('flight_number', { length: 8 }).notNull(),

    originCode: iata('origin_code').notNull(),
    destinationCode: iata('destination_code').notNull(),
    departAt: ts('depart_at').notNull(),
    arriveAt: ts('arrive_at').notNull(),
    durationMinutes: integer('duration_minutes').notNull(),

    aircraft: varchar('aircraft', { length: 60 }),
    cabin: cabinClass('cabin').notNull(),
    bookingClass: char('booking_class', { length: 2 }),
    originTerminal: varchar('origin_terminal', { length: 12 }),
    destinationTerminal: varchar('destination_terminal', { length: 12 }),

    createdAt: now(),
  },
  (t) => [
    uniqueIndex('flight_segments_offer_position_key').on(t.offerId, t.sliceIndex, t.position),
    index('flight_segments_carrier_idx').on(t.marketingCarrier, t.departAt),
  ],
);

// ─────────────────────────────────────────────────────────────
// AirIndex — the observation substrate
// ─────────────────────────────────────────────────────────────

/**
 * What a flight cost, at the moment somebody looked.
 *
 * This is the only table AirIndex reads. Every number the intelligence pages
 * publish — a fare index, a route median, an airline comparison, a "prices are
 * 12% above typical" badge — is an aggregate over these rows, computed at read
 * time, with the sample size shown beside it. Nothing is precomputed into a
 * score somebody could later adjust.
 *
 * Append-only by discipline: there is no update path in the codebase. A wrong
 * observation is a wrong record of what a provider said, which is still the
 * truth about what happened.
 *
 * One row per (offer) rather than per search, so a search returning forty fares
 * contributes forty observations. That is what makes a distribution rather than
 * a series of minima — and the minimum of a distribution is a far weaker signal
 * than its shape.
 */
export const flightPriceObservations = pgTable(
  'flight_price_observations',
  {
    id: id(),
    searchId: fk('search_id').references(() => flightSearches.id, { onDelete: 'set null' }),
    source: flightSource('source').notNull(),

    originCode: iata('origin_code').notNull(),
    destinationCode: iata('destination_code').notNull(),
    marketingCarrier: char('marketing_carrier', { length: 2 }).notNull(),
    cabin: cabinClass('cabin').notNull(),
    stops: smallint('stops').default(0).notNull(),

    /** The calendar day of departure, in India, not a timestamp. */
    departOn: date('depart_on').notNull(),
    departAt: ts('depart_at').notNull(),

    /**
     * Per passenger, so observations of a solo trip and a family of four are
     * comparable. This is the figure every AirIndex aggregate is built on.
     */
    priceMinor: money('price_minor').notNull(),
    currency: char('currency', { length: 3 }).default('INR').notNull(),

    /** Days between the observation and departure — the strongest predictor there is. */
    daysAhead: smallint('days_ahead').notNull(),
    durationMinutes: integer('duration_minutes').notNull(),

    observedAt: ts('observed_at').defaultNow().notNull(),
  },
  (t) => [
    index('flight_obs_route_observed_idx').on(t.originCode, t.destinationCode, t.observedAt),
    index('flight_obs_route_depart_idx').on(t.originCode, t.destinationCode, t.departOn),
    index('flight_obs_carrier_observed_idx').on(t.marketingCarrier, t.observedAt),
    index('flight_obs_observed_idx').on(t.observedAt),
  ],
);

/**
 * Whether a provider is actually working.
 *
 * One row per provider, updated after every call. Kept as a rolling counter
 * rather than a log because the question a status page asks — "is this healthy
 * right now" — is answered by recent aggregates, and the per-call detail is in
 * `flight_provider_events` for anyone who needs it.
 *
 * `consecutiveFailures` is what opens the circuit breaker. `disabledUntil` is
 * when it closes again.
 */
export const flightProviderHealth = pgTable(
  'flight_provider_health',
  {
    source: flightSource('source').primaryKey(),
    configured: boolean('configured').default(false).notNull(),

    lastResult: providerCallResult('last_result'),
    lastCheckedAt: ts('last_checked_at'),
    lastOkAt: ts('last_ok_at'),
    lastErrorAt: ts('last_error_at'),
    lastErrorCode: varchar('last_error_code', { length: 80 }),

    callsTotal: integer('calls_total').default(0).notNull(),
    callsOk: integer('calls_ok').default(0).notNull(),
    callsFailed: integer('calls_failed').default(0).notNull(),
    /** Exponentially weighted, so a single slow call does not define the average. */
    latencyMsEwma: integer('latency_ms_ewma'),

    consecutiveFailures: smallint('consecutive_failures').default(0).notNull(),
    disabledUntil: ts('disabled_until'),

    updatedAt: ts('updated_at').defaultNow().notNull(),
  },
  (t) => [index('flight_provider_health_updated_idx').on(t.updatedAt)],
);

/**
 * Every call made to a provider.
 *
 * The operational trail: which provider, which operation, how long, how it
 * ended. Carries no credential, no passenger name, no payment detail and no
 * request body — an error code and a correlation id are enough to diagnose a
 * problem, and anything more would make this table the thing to worry about in a
 * breach.
 */
export const flightProviderEvents = pgTable(
  'flight_provider_events',
  {
    id: id(),
    source: flightSource('source').notNull(),
    operation: varchar('operation', { length: 40 }).notNull(),
    result: providerCallResult('result').notNull(),

    searchId: fk('search_id').references(() => flightSearches.id, { onDelete: 'set null' }),
    bookingId: fk('booking_id'),

    /** The provider's own request id where it gives one; ours otherwise. */
    correlationId: varchar('correlation_id', { length: 80 }),
    httpStatus: smallint('http_status'),
    errorCode: varchar('error_code', { length: 80 }),
    /** Provider-supplied message, truncated. Never a stack trace, never a body. */
    errorDetail: varchar('error_detail', { length: 300 }),
    latencyMs: integer('latency_ms'),
    attempt: smallint('attempt').default(1).notNull(),
    resultCount: integer('result_count'),

    createdAt: now(),
  },
  (t) => [
    index('flight_provider_events_source_created_idx').on(t.source, t.createdAt),
    index('flight_provider_events_search_idx').on(t.searchId),
    index('flight_provider_events_booking_idx').on(t.bookingId),
    index('flight_provider_events_result_idx').on(t.result, t.createdAt),
  ],
);

// ─────────────────────────────────────────────────────────────
// Bank offers and cashback
// ─────────────────────────────────────────────────────────────

/**
 * A discount a bank or card network funds.
 *
 * Eligibility is expressed as data, not as code, so adding an offer is a row
 * rather than a deploy — and so the reason a customer did or did not get a
 * discount can be shown to them from the same row the engine read.
 *
 * Nothing here identifies a card. The engine matches on the issuer and
 * instrument the customer *chose at checkout*, which the payment provider
 * reports back; ONEPASS never sees a card number, and there is no column here
 * that could hold a BIN range even if somebody wanted one.
 */
export const bankOffers = pgTable(
  'bank_offers',
  {
    id: id(),
    publicRef: varchar('public_ref', { length: 32 }).notNull(),
    /** Who funds it. Null for an offer ONEPASS funds itself. */
    organizationId: fk('organization_id').references(() => organizations.id, { onDelete: 'cascade' }),

    issuer: varchar('issuer', { length: 80 }).notNull(),
    instrument: instrumentKind('instrument').notNull(),
    title: varchar('title', { length: 160 }).notNull(),
    /** Shown in full beside the discount. An offer whose terms are not shown is not offered. */
    terms: text('terms').notNull(),

    /** Basis points, so 10% is 1000 and there is no float anywhere. */
    percentOffBp: integer('percent_off_bp').default(0).notNull(),
    flatOffMinor: money('flat_off_minor').default(0).notNull(),
    maxDiscountMinor: money('max_discount_minor'),
    minSpendMinor: money('min_spend_minor').default(0).notNull(),

    /** Empty means any carrier; otherwise IATA codes this offer applies to. */
    carriers: jsonb('carriers').$type<string[]>(),
    /** Empty means anywhere; otherwise IATA airport or country codes. */
    routes: jsonb('routes').$type<string[]>(),
    cabins: jsonb('cabins').$type<string[]>(),

    /** Per customer, across the whole offer. Null means unlimited. */
    perUserLimit: smallint('per_user_limit'),
    totalLimit: integer('total_limit'),
    usedCount: integer('used_count').default(0).notNull(),

    active: boolean('active').default(true).notNull(),
    startsAt: ts('starts_at').notNull(),
    endsAt: ts('ends_at').notNull(),
    createdAt: now(),
    updatedAt: ts('updated_at').defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('bank_offers_public_ref_key').on(t.publicRef),
    index('bank_offers_active_window_idx').on(t.active, t.startsAt, t.endsAt),
    index('bank_offers_issuer_idx').on(t.issuer, t.instrument),
  ],
);

/**
 * How much cashback a booking earns, as a rule.
 *
 * Separate from `bank_offers` because the two are paid by different people at
 * different times: a bank discount reduces what the customer pays now, cashback
 * is ONEPASS crediting points later once the ticket is certain. Conflating them
 * is how a customer gets told they saved an amount that was never taken off
 * anything.
 */
export const cashbackRules = pgTable(
  'cashback_rules',
  {
    id: id(),
    publicRef: varchar('public_ref', { length: 32 }).notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    description: varchar('description', { length: 300 }).notNull(),

    percentBp: integer('percent_bp').default(0).notNull(),
    flatMinor: money('flat_minor').default(0).notNull(),
    maxCashbackMinor: money('max_cashback_minor'),
    minSpendMinor: money('min_spend_minor').default(0).notNull(),

    carriers: jsonb('carriers').$type<string[]>(),
    cabins: jsonb('cabins').$type<string[]>(),

    /** The airline's own cancellation window; cashback is not approved inside it. */
    holdDays: smallint('hold_days').default(7).notNull(),
    /** Approved cashback that is never credited expires after this. */
    expiryDays: smallint('expiry_days').default(180).notNull(),

    active: boolean('active').default(true).notNull(),
    startsAt: ts('starts_at').notNull(),
    endsAt: ts('ends_at'),
    createdAt: now(),
    updatedAt: ts('updated_at').defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('cashback_rules_public_ref_key').on(t.publicRef),
    index('cashback_rules_active_idx').on(t.active, t.startsAt),
  ],
);

// ─────────────────────────────────────────────────────────────
// Bookings
// ─────────────────────────────────────────────────────────────

/**
 * A flight booking, and the state it is in.
 *
 * Money is in `transactions`; this row holds the journey, the provider's
 * references, and the two prices that must never be confused: what the customer
 * selected, and what was confirmed a moment before they paid. When they differ
 * the customer sees both and decides — the system never quietly charges the
 * second figure because the first one was on screen.
 *
 * `idempotencyKey` is unique per user. A retried submit, a double-clicked
 * button, a webhook delivered twice and a provider that answers slowly and then
 * answers again all land on the same row, which is the only reliable defence
 * against paying twice for one seat.
 */
export const flightBookings = pgTable(
  'flight_bookings',
  {
    id: id(),
    publicRef: varchar('public_ref', { length: 32 }).notNull(),
    userId: fk('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    offerId: fk('offer_id').references(() => flightOffers.id, { onDelete: 'set null' }),
    searchId: fk('search_id').references(() => flightSearches.id, { onDelete: 'set null' }),
    /** Money. The same table a cinema seat uses. */
    transactionId: fk('transaction_id').references(() => transactions.id, { onDelete: 'set null' }),
    /** The trip this belongs to, if it was booked out of the planner. */
    itineraryId: fk('itinerary_id').references(() => itineraries.id, { onDelete: 'set null' }),

    state: flightBookingState('state').default('OFFER_SELECTED').notNull(),
    source: flightSource('source').notNull(),
    providerOfferId: varchar('provider_offer_id', { length: 200 }),
    providerBookingId: varchar('provider_booking_id', { length: 120 }),
    /** The airline's record locator. Six characters, shown to the passenger. */
    pnr: varchar('pnr', { length: 12 }),

    /** The journey, denormalised so /trips renders without touching the offer. */
    tripKind: tripKind('trip_kind').notNull(),
    originCode: iata('origin_code').notNull(),
    destinationCode: iata('destination_code').notNull(),
    departAt: ts('depart_at').notNull(),
    returnAt: ts('return_at'),
    cabin: cabinClass('cabin').notNull(),
    marketingCarrier: char('marketing_carrier', { length: 2 }).notNull(),
    passengerCount: smallint('passenger_count').default(1).notNull(),

    /**
     * The price at each stage, all server-computed, all in minor units.
     *
     * `selected` is what was on screen when the customer chose. `confirmed` is
     * what the provider said when asked again. `charged` is what the payment
     * provider actually captured. The three are stored separately because a
     * discrepancy between any two of them is a bug worth finding, and a single
     * "amount" column makes that undetectable.
     */
    selectedTotalMinor: money('selected_total_minor').notNull(),
    confirmedTotalMinor: money('confirmed_total_minor'),
    baseMinor: money('base_minor').notNull(),
    taxMinor: money('tax_minor').default(0).notNull(),
    providerFeeMinor: money('provider_fee_minor').default(0).notNull(),
    platformFeeMinor: money('platform_fee_minor').default(0).notNull(),
    seatFeeMinor: money('seat_fee_minor').default(0).notNull(),
    baggageFeeMinor: money('baggage_fee_minor').default(0).notNull(),
    bankDiscountMinor: money('bank_discount_minor').default(0).notNull(),
    pointsDiscountMinor: money('points_discount_minor').default(0).notNull(),
    pointsSpent: integer('points_spent').default(0).notNull(),
    chargedTotalMinor: money('charged_total_minor'),
    currency: char('currency', { length: 3 }).default('INR').notNull(),

    /** Which bank offer was applied, if any, and what it actually took off. */
    bankOfferId: fk('bank_offer_id').references(() => bankOffers.id, { onDelete: 'set null' }),

    /** Contact for the airline. Sealed — it reaches the provider, not a log. */
    contactEmailCipher: bytea('contact_email_cipher'),
    contactPhoneCipher: bytea('contact_phone_cipher'),

    idempotencyKey: varchar('idempotency_key', { length: 120 }).notNull(),
    /** Optimistic concurrency. The API and the payment webhook both move this row. */
    version: integer('version').default(0).notNull(),

    failureCode: varchar('failure_code', { length: 80 }),
    /** Plain words, shown to the customer. Never a provider stack trace. */
    failureDetail: varchar('failure_detail', { length: 300 }),
    cancelledReason: varchar('cancelled_reason', { length: 160 }),

    createdAt: now(),
    updatedAt: ts('updated_at').defaultNow().notNull(),
    revalidatedAt: ts('revalidated_at'),
    confirmedAt: ts('confirmed_at'),
    ticketedAt: ts('ticketed_at'),
    cancelledAt: ts('cancelled_at'),
  },
  (t) => [
    uniqueIndex('flight_bookings_public_ref_key').on(t.publicRef),
    uniqueIndex('flight_bookings_user_idem_key').on(t.userId, t.idempotencyKey),
    index('flight_bookings_user_created_idx').on(t.userId, t.createdAt),
    index('flight_bookings_state_idx').on(t.state, t.createdAt),
    index('flight_bookings_depart_idx').on(t.departAt),
    index('flight_bookings_transaction_idx').on(t.transactionId),
  ],
);

/**
 * A passenger on a booking.
 *
 * The smallest set of fields an airline will accept a booking with, and nothing
 * else. Name and date of birth are required by the carrier and are stored in
 * clear because they must be rendered back to the person who typed them, on
 * their own booking, behind their own session — encrypting them would protect
 * nothing that the row-level security policy does not already protect, while
 * making the ticket page unable to show a passenger their own name.
 *
 * A travel-document number is different. It is a government identifier, it is
 * needed only at the moment the booking is sent to the provider, and it is
 * sealed with AES-256-GCM under a key that is not in source control. It is never
 * returned by any API, never rendered beyond its last two characters, and never
 * logged.
 */
export const flightPassengers = pgTable(
  'flight_passengers',
  {
    id: id(),
    bookingId: fk('booking_id')
      .notNull()
      .references(() => flightBookings.id, { onDelete: 'cascade' }),

    position: smallint('position').notNull(),
    kind: passengerKind('kind').default('ADULT').notNull(),
    title: varchar('title', { length: 10 }),
    givenName: varchar('given_name', { length: 80 }).notNull(),
    familyName: varchar('family_name', { length: 80 }).notNull(),
    /** Required by carriers for fare eligibility; a date, not a timestamp. */
    dateOfBirth: date('date_of_birth'),

    /** Sealed. See the note above. */
    documentNumberCipher: bytea('document_number_cipher'),
    documentType: varchar('document_type', { length: 20 }),
    documentCountry: char('document_country', { length: 2 }),
    documentExpiresOn: date('document_expires_on'),
    /** For display only — "•••• 4821" on the passenger's own booking page. */
    documentLast2: char('document_last2', { length: 2 }),

    seatNumber: varchar('seat_number', { length: 8 }),
    extraBagKg: smallint('extra_bag_kg'),

    createdAt: now(),
    updatedAt: ts('updated_at').defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('flight_passengers_position_key').on(t.bookingId, t.position),
    index('flight_passengers_booking_idx').on(t.bookingId),
  ],
);

/**
 * An issued e-ticket.
 *
 * Separate from `tickets` in commerce.ts, which is a door-admission artifact with
 * a rotating TOTP code — the thing you show a scanner at a cinema. An air ticket
 * is a number issued by a carrier against a passenger and a coupon; it is not
 * scanned by ONEPASS, cannot be admitted, and has a refund and exchange lifecycle
 * that a venue ticket does not. The two share a name and nothing else.
 */
export const flightTickets = pgTable(
  'flight_tickets',
  {
    id: id(),
    publicRef: varchar('public_ref', { length: 32 }).notNull(),
    bookingId: fk('booking_id')
      .notNull()
      .references(() => flightBookings.id, { onDelete: 'cascade' }),
    passengerId: fk('passenger_id')
      .notNull()
      .references(() => flightPassengers.id, { onDelete: 'cascade' }),

    /** The carrier's 13-digit ticket number. */
    ticketNumber: varchar('ticket_number', { length: 20 }).notNull(),
    state: flightTicketState('state').default('ISSUED').notNull(),
    issuedAt: ts('issued_at').defaultNow().notNull(),
    createdAt: now(),
    updatedAt: ts('updated_at').defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('flight_tickets_public_ref_key').on(t.publicRef),
    uniqueIndex('flight_tickets_number_key').on(t.ticketNumber),
    index('flight_tickets_booking_idx').on(t.bookingId),
  ],
);

/**
 * Cashback owed, and what became of it.
 *
 * One row per booking per rule, with a unique index that makes crediting twice
 * impossible rather than unlikely: `(booking_id, rule_id)`. The `rewardLedgerId`
 * is written in the same transaction as the ledger entry, so a row that claims
 * CREDITED always has the entry to prove it.
 */
export const cashbackLedger = pgTable(
  'cashback_ledger',
  {
    id: id(),
    publicRef: varchar('public_ref', { length: 32 }).notNull(),
    userId: fk('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    bookingId: fk('booking_id')
      .notNull()
      .references(() => flightBookings.id, { onDelete: 'cascade' }),
    ruleId: fk('rule_id').references(() => cashbackRules.id, { onDelete: 'set null' }),

    state: cashbackState('state').default('PENDING').notNull(),
    amountMinor: money('amount_minor').notNull(),
    currency: char('currency', { length: 3 }).default('INR').notNull(),
    /** The spend it was computed from, so the figure can be re-derived. */
    basisMinor: money('basis_minor').notNull(),
    /** Named calculation, e.g. "3% of fare, capped at ₹750". Shown to the customer. */
    method: varchar('method', { length: 160 }).notNull(),

    /** Proof the credit happened. Written in the same transaction as the entry. */
    rewardLedgerId: fk('reward_ledger_id'),

    approveAfter: ts('approve_after').notNull(),
    expiresAt: ts('expires_at'),
    reversedReason: varchar('reversed_reason', { length: 160 }),

    createdAt: now(),
    updatedAt: ts('updated_at').defaultNow().notNull(),
    approvedAt: ts('approved_at'),
    creditedAt: ts('credited_at'),
    reversedAt: ts('reversed_at'),
  },
  (t) => [
    uniqueIndex('cashback_ledger_public_ref_key').on(t.publicRef),
    // The constraint that makes double-crediting a database error.
    uniqueIndex('cashback_ledger_booking_rule_key').on(t.bookingId, t.ruleId),
    index('cashback_ledger_user_created_idx').on(t.userId, t.createdAt),
    index('cashback_ledger_state_approve_idx').on(t.state, t.approveAfter),
  ],
);

// ─────────────────────────────────────────────────────────────
// Relations
// ─────────────────────────────────────────────────────────────

export const flightSearchRelations = relations(flightSearches, ({ many, one }) => ({
  offers: many(flightOffers),
  user: one(users, { fields: [flightSearches.userId], references: [users.id] }),
}));

export const flightOfferRelations = relations(flightOffers, ({ many, one }) => ({
  search: one(flightSearches, { fields: [flightOffers.searchId], references: [flightSearches.id] }),
  segments: many(flightSegments),
}));

export const flightSegmentRelations = relations(flightSegments, ({ one }) => ({
  offer: one(flightOffers, { fields: [flightSegments.offerId], references: [flightOffers.id] }),
}));

export const flightBookingRelations = relations(flightBookings, ({ many, one }) => ({
  user: one(users, { fields: [flightBookings.userId], references: [users.id] }),
  offer: one(flightOffers, { fields: [flightBookings.offerId], references: [flightOffers.id] }),
  transaction: one(transactions, {
    fields: [flightBookings.transactionId],
    references: [transactions.id],
  }),
  itinerary: one(itineraries, {
    fields: [flightBookings.itineraryId],
    references: [itineraries.id],
  }),
  bankOffer: one(bankOffers, { fields: [flightBookings.bankOfferId], references: [bankOffers.id] }),
  passengers: many(flightPassengers),
  tickets: many(flightTickets),
  cashback: many(cashbackLedger),
}));

export const flightPassengerRelations = relations(flightPassengers, ({ many, one }) => ({
  booking: one(flightBookings, {
    fields: [flightPassengers.bookingId],
    references: [flightBookings.id],
  }),
  tickets: many(flightTickets),
}));

export const flightTicketRelations = relations(flightTickets, ({ one }) => ({
  booking: one(flightBookings, {
    fields: [flightTickets.bookingId],
    references: [flightBookings.id],
  }),
  passenger: one(flightPassengers, {
    fields: [flightTickets.passengerId],
    references: [flightPassengers.id],
  }),
}));

export const cashbackLedgerRelations = relations(cashbackLedger, ({ one }) => ({
  user: one(users, { fields: [cashbackLedger.userId], references: [users.id] }),
  booking: one(flightBookings, {
    fields: [cashbackLedger.bookingId],
    references: [flightBookings.id],
  }),
  rule: one(cashbackRules, { fields: [cashbackLedger.ruleId], references: [cashbackRules.id] }),
}));
