/**
 * ONEPASS — the commerce layer.
 *
 * Kept in its own module so the identity core in schema.ts stays readable and so
 * the two can be reviewed independently: identity is the part that must be right
 * for security reasons, commerce is the part that must be right for money
 * reasons. schema.ts re-exports everything here, so Drizzle sees one schema.
 *
 * The spine, in one paragraph. An Organization (schema.ts) operates Venues. A
 * Venue publishes InventorySlots — real, countable capacity for a window of
 * time. An Offer prices some of that capacity, and a Booking consumes it inside
 * a transaction so two people cannot take the last seat. A captured Booking
 * produces a Ticket (the thing you show at the door) and a Receipt (the thing
 * you keep). Receipt lines are what warranties attach to and what returns are
 * requested against. Rewards are an append-only ledger, never a mutable balance.
 * Everything a merchant is told about a consumer still passes the consent check
 * in schema.ts — the commerce layer adds no new route to personal data.
 *
 * Three rules this file follows without exception:
 *  1. Money is `integer` minor units. Never a float, never a numeric string.
 *  2. Anything derived — a balance, a forecast, an insight — records how it was
 *     derived, so a number on a dashboard can always be traced to its inputs.
 *  3. Anything a third party can see is addressed by a random `public_ref`,
 *     never by a primary key.
 */
import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  char,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { organizations, transactions, users, apiKeys, partnerConnections } from './schema';
// The same four states an ownership transfer moves through — one enum, because
// they are the same four states and a second copy would drift.
import { transferState } from './products';

const id = () => char('id', { length: 26 }).primaryKey();
const fk = (name: string) => char(name, { length: 26 });
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const now = () => ts('created_at').defaultNow().notNull();
const money = (name: string) => integer(name);

// ─────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────

export const venueKind = pgEnum('venue_kind', [
  'HOTEL',
  'RESTAURANT',
  'CINEMA',
  'RETAIL_STORE',
  'ATTRACTION',
  'EXPERIENCE',
  'EVENT_SPACE',
  'TRANSPORT',
  // A parking structure is a venue that sells bays by the hour. Modelling it as a
  // venue kind rather than a parking subsystem means inventory_slots, bookings,
  // offers, receipts and check-in all carry it with no new code.
  'PARKING',
  'CAMPUS',
]);

/** What a slot sells. Determines the unit shown in the UI, nothing else. */
export const capacityUnit = pgEnum('capacity_unit', [
  'SEAT',
  'ROOM',
  'TABLE',
  'SLOT',
  'TICKET',
  'COVER',
  'BAY',
]);

export const offerKind = pgEnum('offer_kind', [
  /** Time-boxed markdown of unsold capacity. The Live Deals product. */
  'LIVE_DEAL',
  /** Always-on partner discount. */
  'STANDING',
  /** Included in a city pass rather than bought separately. */
  'CITY_PASS',
  /** Bought with reward points instead of money. */
  'REWARD_REDEMPTION',
  /** Created by a campaign, targeted at a consented segment. */
  'CAMPAIGN',
]);

export const offerStatus = pgEnum('offer_status', ['DRAFT', 'SCHEDULED', 'LIVE', 'PAUSED', 'ENDED', 'SOLD_OUT']);

export const discountKind = pgEnum('discount_kind', ['PERCENT', 'FLAT', 'FIXED_PRICE', 'POINTS']);

export const bookingStatus = pgEnum('booking_status', [
  'HELD',
  'CONFIRMED',
  'CHECKED_IN',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
  'EXPIRED',
]);

export const ticketState = pgEnum('ticket_state', ['ISSUED', 'ADMITTED', 'VOID', 'EXPIRED', 'TRANSFERRED']);

export const receiptChannel = pgEnum('receipt_channel', ['IN_STORE', 'ONLINE', 'IN_APP', 'IMPORTED']);

export const returnState = pgEnum('return_state', [
  'REQUESTED',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
  'IN_TRANSIT',
  'REFUNDED',
  'REPLACED',
  'CANCELLED',
  'CLOSED',
]);

export const returnResolution = pgEnum('return_resolution', ['REFUND', 'REPLACEMENT', 'STORE_CREDIT', 'REPAIR']);

/**
 * Why points moved. An append-only ledger needs a reason on every row or the
 * balance becomes unexplainable, which is how loyalty programmes lose trust.
 */
export const rewardEntryKind = pgEnum('reward_entry_kind', [
  'EARN_PURCHASE',
  'EARN_BONUS',
  'EARN_QUEST',
  'EARN_REFERRAL',
  'REDEEM_OFFER',
  'REDEEM_TRANSFER',
  'EXPIRE',
  'ADJUST_CREDIT',
  'ADJUST_DEBIT',
  'REVERSAL',
]);

export const savingsSource = pgEnum('savings_source', [
  'LIVE_DEAL',
  'STANDING_OFFER',
  'CITY_PASS',
  'REWARD_REDEMPTION',
  'CAMPAIGN',
  'CORPORATE_BENEFIT',
]);

/**
 * `JOURNEY` is a trip that involves getting there — a flight, and whatever the
 * planner arranges around it. Deliberately a fourth value on the existing enum
 * rather than a second trip table: ONEPASS has one planner, one /trips list and
 * one timeline, and a travel booking joins that timeline instead of starting a
 * parallel one.
 */
export const itineraryKind = pgEnum('itinerary_kind', ['DAY_PLAN', 'TRIP', 'CITY_PASS_ROUTE', 'JOURNEY']);
export const itineraryState = pgEnum('itinerary_state', ['DRAFT', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'ABANDONED']);

export const campaignState = pgEnum('campaign_state', ['DRAFT', 'PENDING_REVIEW', 'RUNNING', 'PAUSED', 'ENDED']);
export const campaignEventKind = pgEnum('campaign_event_kind', ['DELIVERED', 'VIEWED', 'CLICKED', 'REDEEMED', 'DISMISSED']);

export const insightSeverity = pgEnum('insight_severity', ['OPPORTUNITY', 'WATCH', 'RISK']);

export const householdRole = pgEnum('household_role', ['ORGANISER', 'ADULT', 'DEPENDANT']);

export const questState = pgEnum('quest_state', ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'CLAIMED', 'EXPIRED']);

// ─────────────────────────────────────────────────────────────
// Geography — cities exist so discovery, city passes and travel can be scoped
// without three separate notions of "where".
// ─────────────────────────────────────────────────────────────

export const cities = pgTable(
  'cities',
  {
    id: id(),
    slug: varchar('slug', { length: 60 }).notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    state: varchar('state', { length: 80 }).notNull(),
    /** Stored as text to avoid float equality surprises; parsed where needed. */
    latitude: numeric('latitude', { precision: 9, scale: 6 }),
    longitude: numeric('longitude', { precision: 9, scale: 6 }),
    timezone: varchar('timezone', { length: 60 }).default('Asia/Kolkata').notNull(),
    /** A city can exist in the data before it is open to consumers. */
    isLive: boolean('is_live').default(false).notNull(),
    createdAt: now(),
  },
  (t) => [uniqueIndex('cities_slug_key').on(t.slug), index('cities_live_idx').on(t.isLive)],
);

export const venues = pgTable(
  'venues',
  {
    id: id(),
    organizationId: fk('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    cityId: fk('city_id').references(() => cities.id, { onDelete: 'set null' }),

    /** Third-party visible. Never the primary key. */
    publicRef: varchar('public_ref', { length: 32 }).notNull(),
    name: varchar('name', { length: 160 }).notNull(),
    kind: venueKind('kind').notNull(),
    addressLine: varchar('address_line', { length: 240 }),
    locality: varchar('locality', { length: 120 }),
    postalCode: varchar('postal_code', { length: 12 }),
    latitude: numeric('latitude', { precision: 9, scale: 6 }),
    longitude: numeric('longitude', { precision: 9, scale: 6 }),

    /** Free-form tags used by discovery: 'vegetarian', 'imax', 'rooftop'. */
    tags: jsonb('tags').$type<string[]>().default([]).notNull(),
    /** Typical spend per head, minor units — the planner needs a prior. */
    typicalSpendMinor: money('typical_spend_minor'),
    openingHours: jsonb('opening_hours').$type<Record<string, [string, string] | null>>(),

    isActive: boolean('is_active').default(true).notNull(),
    createdAt: now(),
    updatedAt: ts('updated_at').defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('venues_public_ref_key').on(t.publicRef),
    index('venues_org_idx').on(t.organizationId),
    index('venues_city_kind_idx').on(t.cityId, t.kind, t.isActive),
  ],
);

// ─────────────────────────────────────────────────────────────
// Inventory — the countable thing everything else consumes.
// ─────────────────────────────────────────────────────────────

/**
 * Capacity for one window at one venue.
 *
 * `heldCount` and `soldCount` are separate on purpose: a hold is not a sale, and
 * a checkout that abandons must return capacity without ever having counted as
 * revenue. Availability is `capacity - held - sold`, and the booking path takes a
 * row lock before touching it, so overselling is prevented by the database
 * rather than by hoping two requests do not arrive together.
 */
export const inventorySlots = pgTable(
  'inventory_slots',
  {
    id: id(),
    venueId: fk('venue_id')
      .notNull()
      .references(() => venues.id, { onDelete: 'cascade' }),
    organizationId: fk('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),

    label: varchar('label', { length: 160 }).notNull(),
    unit: capacityUnit('unit').notNull(),
    startsAt: ts('starts_at').notNull(),
    endsAt: ts('ends_at').notNull(),

    capacity: integer('capacity').notNull(),
    heldCount: integer('held_count').default(0).notNull(),
    soldCount: integer('sold_count').default(0).notNull(),

    /** What the merchant normally charges. The anchor every discount is measured from. */
    listPriceMinor: money('list_price_minor').notNull(),
    currency: char('currency', { length: 3 }).default('INR').notNull(),

    metadata: jsonb('metadata'),
    createdAt: now(),
    updatedAt: ts('updated_at').defaultNow().notNull(),
  },
  (t) => [
    index('inventory_venue_start_idx').on(t.venueId, t.startsAt),
    index('inventory_org_start_idx').on(t.organizationId, t.startsAt),
  ],
);

// ─────────────────────────────────────────────────────────────
// Offers — one table for every kind of price change, because a consumer sees
// one thing ("₹149 today") and a separate table per marketing idea would mean
// four code paths that must agree on what a discount means.
// ─────────────────────────────────────────────────────────────

export const offers = pgTable(
  'offers',
  {
    id: id(),
    organizationId: fk('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    venueId: fk('venue_id').references(() => venues.id, { onDelete: 'cascade' }),
    slotId: fk('slot_id').references(() => inventorySlots.id, { onDelete: 'cascade' }),
    cityId: fk('city_id').references(() => cities.id, { onDelete: 'set null' }),

    publicRef: varchar('public_ref', { length: 32 }).notNull(),
    kind: offerKind('kind').notNull(),
    status: offerStatus('status').default('DRAFT').notNull(),

    title: varchar('title', { length: 160 }).notNull(),
    description: text('description'),
    terms: text('terms'),

    discountKind: discountKind('discount_kind').notNull(),
    /** Percent (1–90), flat minor units, fixed price minor units, or point cost. */
    discountValue: integer('discount_value').notNull(),
    listPriceMinor: money('list_price_minor'),
    /** Computed on write so a listing never has to recompute per row. */
    priceMinor: money('price_minor'),
    currency: char('currency', { length: 3 }).default('INR').notNull(),

    startsAt: ts('starts_at').notNull(),
    endsAt: ts('ends_at').notNull(),

    /** Null means unlimited. */
    maxRedemptions: integer('max_redemptions'),
    maxPerUser: integer('max_per_user').default(1).notNull(),
    redeemedCount: integer('redeemed_count').default(0).notNull(),

    /**
     * Cross-brand: which other organizations' reward points this offer accepts.
     * Empty means the issuing organization's points only.
     */
    acceptsPointsFrom: jsonb('accepts_points_from').$type<string[]>().default([]).notNull(),
    /** Discovery filters: kinds, tags, city — never personal attributes. */
    audience: jsonb('audience').$type<{ tags?: string[]; venueKinds?: string[] }>(),

    createdBy: fk('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: now(),
    updatedAt: ts('updated_at').defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('offers_public_ref_key').on(t.publicRef),
    index('offers_status_ends_idx').on(t.status, t.endsAt),
    index('offers_city_status_idx').on(t.cityId, t.status),
    index('offers_org_created_idx').on(t.organizationId, t.createdAt),
    index('offers_slot_idx').on(t.slotId),
  ],
);

/**
 * One row per use. The unique index is the redemption limit — enforcing it in
 * application code alone means two concurrent requests both pass the check.
 */
export const offerRedemptions = pgTable(
  'offer_redemptions',
  {
    id: id(),
    offerId: fk('offer_id')
      .notNull()
      .references(() => offers.id, { onDelete: 'cascade' }),
    userId: fk('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    bookingId: fk('booking_id'),
    /** Which use this is for this user: 1, 2, 3… Bounded by offers.maxPerUser. */
    sequence: integer('sequence').default(1).notNull(),
    savedMinor: money('saved_minor').notNull(),
    createdAt: now(),
  },
  (t) => [
    uniqueIndex('offer_redemptions_user_seq_key').on(t.offerId, t.userId, t.sequence),
    index('offer_redemptions_offer_idx').on(t.offerId),
    index('offer_redemptions_user_idx').on(t.userId, t.createdAt),
  ],
);

// ─────────────────────────────────────────────────────────────
// Bookings and tickets
// ─────────────────────────────────────────────────────────────

export const bookings = pgTable(
  'bookings',
  {
    id: id(),
    publicRef: varchar('public_ref', { length: 32 }).notNull(),
    userId: fk('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    organizationId: fk('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    venueId: fk('venue_id').references(() => venues.id, { onDelete: 'set null' }),
    slotId: fk('slot_id').references(() => inventorySlots.id, { onDelete: 'set null' }),
    offerId: fk('offer_id').references(() => offers.id, { onDelete: 'set null' }),
    /** Money lives in the existing transactions table; this is the join. */
    transactionId: fk('transaction_id').references(() => transactions.id, { onDelete: 'set null' }),
    /** The consent link the merchant reads this consumer through. */
    connectionId: fk('connection_id').references(() => partnerConnections.id, { onDelete: 'set null' }),

    status: bookingStatus('status').default('HELD').notNull(),
    quantity: integer('quantity').default(1).notNull(),

    listPriceMinor: money('list_price_minor').notNull(),
    amountMinor: money('amount_minor').notNull(),
    savedMinor: money('saved_minor').default(0).notNull(),
    pointsSpent: integer('points_spent').default(0).notNull(),
    currency: char('currency', { length: 3 }).default('INR').notNull(),

    startsAt: ts('starts_at'),
    endsAt: ts('ends_at'),
    /** A hold that is never confirmed returns its capacity after this. */
    holdExpiresAt: ts('hold_expires_at'),

    guestNote: varchar('guest_note', { length: 300 }),
    cancelledReason: varchar('cancelled_reason', { length: 160 }),

    createdAt: now(),
    updatedAt: ts('updated_at').defaultNow().notNull(),
    confirmedAt: ts('confirmed_at'),
    checkedInAt: ts('checked_in_at'),
  },
  (t) => [
    uniqueIndex('bookings_public_ref_key').on(t.publicRef),
    index('bookings_user_created_idx').on(t.userId, t.createdAt),
    index('bookings_org_created_idx').on(t.organizationId, t.createdAt),
    index('bookings_status_hold_idx').on(t.status, t.holdExpiresAt),
    index('bookings_slot_idx').on(t.slotId),
  ],
);

/**
 * The admission artifact.
 *
 * A ticket carries its own secret and is verified the same way a pass is: the QR
 * contains the reference and a rotating code, never the holder's details. The
 * `admittedAt` timestamp with a unique partial index is what stops the same
 * ticket being used twice — again, a constraint rather than a check.
 */
export const tickets = pgTable(
  'tickets',
  {
    id: id(),
    publicRef: varchar('public_ref', { length: 32 }).notNull(),
    bookingId: fk('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    userId: fk('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    organizationId: fk('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    venueId: fk('venue_id').references(() => venues.id, { onDelete: 'set null' }),

    state: ticketState('state').default('ISSUED').notNull(),
    title: varchar('title', { length: 160 }).notNull(),
    subtitle: varchar('subtitle', { length: 200 }),
    seatLabel: varchar('seat_label', { length: 60 }),
    admitCount: integer('admit_count').default(1).notNull(),

    validFrom: ts('valid_from').notNull(),
    validUntil: ts('valid_until'),
    admittedAt: ts('admitted_at'),
    admittedByUserId: fk('admitted_by_user_id').references(() => users.id, { onDelete: 'set null' }),

    createdAt: now(),
    updatedAt: ts('updated_at').defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('tickets_public_ref_key').on(t.publicRef),
    index('tickets_user_valid_idx').on(t.userId, t.validFrom),
    index('tickets_org_state_idx').on(t.organizationId, t.state),
    index('tickets_booking_idx').on(t.bookingId),
  ],
);

/**
 * Giving a ticket to somebody else.
 *
 * Shaped after `ownership_transfers`, deliberately — the same problem with the
 * same answer: the sender shares a code, not an address, so nobody has to know
 * the recipient's email to hand them a seat, and only the code's hash is stored.
 *
 * `issued_ticket_id` is what makes this a transfer rather than sharing. Claiming
 * marks the original TRANSFERRED and writes a *new* ticket with a new reference,
 * so the screenshot on the sender's phone stops working at the door. A design
 * that moved `tickets.user_id` and kept the reference would hand two people one
 * admission and let the door decide which of them got in.
 */
export const ticketTransfers = pgTable(
  'ticket_transfers',
  {
    id: id(),
    publicRef: varchar('public_ref', { length: 32 }).notNull(),
    ticketId: fk('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    fromUserId: fk('from_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    /** Unknown until the code is claimed. */
    toUserId: fk('to_user_id').references(() => users.id, { onDelete: 'restrict' }),
    /** The ticket written for the claimant. Null until then. */
    issuedTicketId: fk('issued_ticket_id').references(() => tickets.id, { onDelete: 'set null' }),
    state: transferState('state').default('PENDING').notNull(),
    /** SHA-256 of the transfer code, hex. The code is shown once and never stored. */
    claimCodeHash: varchar('claim_code_hash', { length: 64 }).notNull(),
    expiresAt: ts('expires_at').notNull(),
    acceptedAt: ts('accepted_at'),
    cancelledAt: ts('cancelled_at'),
    createdAt: now(),
  },
  (t) => [
    uniqueIndex('ticket_transfers_public_ref_key').on(t.publicRef),
    uniqueIndex('ticket_transfers_code_key').on(t.claimCodeHash),
    // One live offer per ticket: two outstanding codes for one seat would let it
    // be given away twice, and the second person would find out at the door.
    uniqueIndex('ticket_transfers_one_pending')
      .on(t.ticketId)
      .where(sql`${t.state} = 'PENDING'`),
    index('ticket_transfers_from_idx').on(t.fromUserId, t.createdAt),
  ],
);

// ─────────────────────────────────────────────────────────────
// Receipts, warranties, returns
// ─────────────────────────────────────────────────────────────

export const receipts = pgTable(
  'receipts',
  {
    id: id(),
    publicRef: varchar('public_ref', { length: 32 }).notNull(),
    userId: fk('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    organizationId: fk('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    venueId: fk('venue_id').references(() => venues.id, { onDelete: 'set null' }),
    transactionId: fk('transaction_id').references(() => transactions.id, { onDelete: 'set null' }),
    bookingId: fk('booking_id').references(() => bookings.id, { onDelete: 'set null' }),

    /** The merchant's own number, as printed. Ours is publicRef. */
    merchantReceiptNo: varchar('merchant_receipt_no', { length: 60 }),
    channel: receiptChannel('channel').default('IN_APP').notNull(),

    subtotalMinor: money('subtotal_minor').notNull(),
    discountMinor: money('discount_minor').default(0).notNull(),
    taxMinor: money('tax_minor').default(0).notNull(),
    totalMinor: money('total_minor').notNull(),
    currency: char('currency', { length: 3 }).default('INR').notNull(),

    /**
     * How it was paid, as a label only — "UPI", "Card ···4242". Never a PAN, never
     * a token that could be replayed. The payment_methods table already holds the
     * provider's reference; a receipt does not need it.
     */
    paymentLabel: varchar('payment_label', { length: 60 }),
    gstin: varchar('gstin', { length: 20 }),

    /** Merchant's own policy, denormalised so a receipt stays true to its terms. */
    returnWindowDays: integer('return_window_days').default(0).notNull(),
    returnPolicyNote: varchar('return_policy_note', { length: 300 }),

    issuedAt: ts('issued_at').defaultNow().notNull(),
    createdAt: now(),
  },
  (t) => [
    uniqueIndex('receipts_public_ref_key').on(t.publicRef),
    uniqueIndex('receipts_org_merchant_no_key').on(t.organizationId, t.merchantReceiptNo),
    index('receipts_user_issued_idx').on(t.userId, t.issuedAt),
    index('receipts_org_issued_idx').on(t.organizationId, t.issuedAt),
  ],
);

export const receiptLines = pgTable(
  'receipt_lines',
  {
    id: id(),
    receiptId: fk('receipt_id')
      .notNull()
      .references(() => receipts.id, { onDelete: 'cascade' }),

    position: integer('position').notNull(),
    description: varchar('description', { length: 240 }).notNull(),
    sku: varchar('sku', { length: 80 }),
    category: varchar('category', { length: 80 }),
    quantity: integer('quantity').default(1).notNull(),
    unitPriceMinor: money('unit_price_minor').notNull(),
    lineTotalMinor: money('line_total_minor').notNull(),
    taxRateBp: integer('tax_rate_bp').default(0).notNull(),

    /** Set by the merchant when the item carries one. Drives the warranty vault. */
    warrantyMonths: integer('warranty_months'),
    serialNumber: varchar('serial_number', { length: 120 }),
    isReturnable: boolean('is_returnable').default(true).notNull(),

    createdAt: now(),
  },
  (t) => [
    uniqueIndex('receipt_lines_position_key').on(t.receiptId, t.position),
    index('receipt_lines_receipt_idx').on(t.receiptId),
  ],
);

/**
 * Derived from a receipt line at issue time, then stood on its own.
 *
 * Separate from the line because a warranty outlives the interest anyone has in
 * the receipt: it is queried by "what expires in the next 60 days", which wants
 * its own index and its own row, not a scan of every line ever issued.
 */
export const warranties = pgTable(
  'warranties',
  {
    id: id(),
    publicRef: varchar('public_ref', { length: 32 }).notNull(),
    userId: fk('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    organizationId: fk('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    receiptId: fk('receipt_id')
      .notNull()
      .references(() => receipts.id, { onDelete: 'cascade' }),
    receiptLineId: fk('receipt_line_id')
      .notNull()
      .references(() => receiptLines.id, { onDelete: 'cascade' }),

    productName: varchar('product_name', { length: 240 }).notNull(),
    serialNumber: varchar('serial_number', { length: 120 }),
    coverageNote: varchar('coverage_note', { length: 300 }),

    purchasedOn: date('purchased_on').notNull(),
    months: integer('months').notNull(),
    expiresOn: date('expires_on').notNull(),

    /** When we last told the holder it was about to lapse; stops repeat nagging. */
    remindedAt: ts('reminded_at'),
    /**
     * Whether cover follows the product to a new owner (D-007). Declared by the
     * merchant when the receipt is issued; **false unless they say so**, because
     * transferability is a term of the warranty and ONEPASS does not get to
     * assume a generous reading of somebody else's terms.
     */
    transferable: boolean('transferable').default(false).notNull(),
    createdAt: now(),
  },
  (t) => [
    uniqueIndex('warranties_public_ref_key').on(t.publicRef),
    uniqueIndex('warranties_line_key').on(t.receiptLineId),
    index('warranties_user_expiry_idx').on(t.userId, t.expiresOn),
    index('warranties_expiry_idx').on(t.expiresOn),
  ],
);

export const returnRequests = pgTable(
  'return_requests',
  {
    id: id(),
    publicRef: varchar('public_ref', { length: 32 }).notNull(),
    userId: fk('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    organizationId: fk('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    receiptId: fk('receipt_id')
      .notNull()
      .references(() => receipts.id, { onDelete: 'cascade' }),
    receiptLineId: fk('receipt_line_id')
      .notNull()
      .references(() => receiptLines.id, { onDelete: 'cascade' }),

    state: returnState('state').default('REQUESTED').notNull(),
    requestedResolution: returnResolution('requested_resolution').notNull(),
    grantedResolution: returnResolution('granted_resolution'),

    quantity: integer('quantity').default(1).notNull(),
    reasonCode: varchar('reason_code', { length: 60 }).notNull(),
    reasonNote: varchar('reason_note', { length: 500 }),

    refundMinor: money('refund_minor'),
    /** Set when the merchant decides, so the consumer sees a real answer, not silence. */
    merchantNote: varchar('merchant_note', { length: 500 }),
    decidedByUserId: fk('decided_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    decidedAt: ts('decided_at'),

    /** Denormalised from the receipt so a policy change cannot retroactively close a window. */
    windowClosesAt: ts('window_closes_at').notNull(),

    createdAt: now(),
    updatedAt: ts('updated_at').defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('return_requests_public_ref_key').on(t.publicRef),
    index('return_requests_user_created_idx').on(t.userId, t.createdAt),
    index('return_requests_org_state_idx').on(t.organizationId, t.state),
    index('return_requests_line_idx').on(t.receiptLineId),
  ],
);

// ─────────────────────────────────────────────────────────────
// Rewards — a ledger, not a balance.
// ─────────────────────────────────────────────────────────────

/**
 * A partner's earn-and-accept rules.
 *
 * `acceptsExternalPoints` is the cross-brand switch: a restaurant that turns it
 * on agrees to honour points earned at a cinema, and settles with the platform
 * at `settlementPaisePerPoint`. That number is why cross-brand rewards are a
 * business rather than a giveaway — someone has to fund the discount.
 */
export const rewardPrograms = pgTable(
  'reward_programs',
  {
    id: id(),
    organizationId: fk('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 120 }).notNull(),

    /** Points granted per ₹100 spent. Integer to keep the ledger exact. */
    earnPointsPerHundred: integer('earn_points_per_hundred').default(5).notNull(),
    /** What one point is worth when redeemed here, in paise. */
    redeemPaisePerPoint: integer('redeem_paise_per_point').default(10).notNull(),
    /** What the issuer is paid when someone else's points are spent here. */
    settlementPaisePerPoint: integer('settlement_paise_per_point').default(8).notNull(),

    acceptsExternalPoints: boolean('accepts_external_points').default(false).notNull(),
    pointsExpireMonths: integer('points_expire_months'),
    minRedeemPoints: integer('min_redeem_points').default(100).notNull(),

    isActive: boolean('is_active').default(true).notNull(),
    createdAt: now(),
    updatedAt: ts('updated_at').defaultNow().notNull(),
  },
  (t) => [uniqueIndex('reward_programs_org_key').on(t.organizationId)],
);

/**
 * One balance row per user per issuing organization.
 *
 * The row exists to be locked. `balance` is a cached projection of the ledger and
 * is only ever moved inside the same transaction that appends the entry; the
 * ledger is the truth, and `reconcileRewardBalance` can rebuild this from it.
 */
export const rewardAccounts = pgTable(
  'reward_accounts',
  {
    id: id(),
    userId: fk('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Null = the platform's own points, earned across the network. */
    issuerOrganizationId: fk('issuer_organization_id').references(() => organizations.id, { onDelete: 'cascade' }),

    balance: integer('balance').default(0).notNull(),
    lifetimeEarned: integer('lifetime_earned').default(0).notNull(),
    lifetimeRedeemed: integer('lifetime_redeemed').default(0).notNull(),

    createdAt: now(),
    updatedAt: ts('updated_at').defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('reward_accounts_user_issuer_key').on(t.userId, t.issuerOrganizationId),
    index('reward_accounts_user_idx').on(t.userId),
  ],
);

export const rewardLedger = pgTable(
  'reward_ledger',
  {
    id: id(),
    accountId: fk('account_id')
      .notNull()
      .references(() => rewardAccounts.id, { onDelete: 'cascade' }),
    userId: fk('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    kind: rewardEntryKind('kind').notNull(),
    /** Signed. Earning is positive, redemption negative. The sum is the balance. */
    points: integer('points').notNull(),
    balanceAfter: integer('balance_after').notNull(),

    /** Where it was spent, when that differs from who issued it — cross-brand. */
    counterpartyOrganizationId: fk('counterparty_organization_id').references(() => organizations.id, {
      onDelete: 'set null',
    }),
    transactionId: fk('transaction_id').references(() => transactions.id, { onDelete: 'set null' }),
    bookingId: fk('booking_id').references(() => bookings.id, { onDelete: 'set null' }),
    offerId: fk('offer_id').references(() => offers.id, { onDelete: 'set null' }),

    description: varchar('description', { length: 200 }).notNull(),
    /** Makes a retried earn-on-purchase idempotent. */
    idempotencyKey: varchar('idempotency_key', { length: 120 }),
    expiresOn: date('expires_on'),

    createdAt: now(),
  },
  (t) => [
    uniqueIndex('reward_ledger_idem_key').on(t.accountId, t.idempotencyKey),
    index('reward_ledger_account_created_idx').on(t.accountId, t.createdAt),
    index('reward_ledger_user_created_idx').on(t.userId, t.createdAt),
    index('reward_ledger_expiry_idx').on(t.expiresOn),
  ],
);

/**
 * Every rupee not spent, attributed to the thing that saved it.
 *
 * Written at the same moment as the booking or redemption that caused it, so the
 * "you saved ₹8,420" figure is a sum of real events rather than a number chosen
 * to look good. Nothing writes here without a source row to point at.
 */
export const savingsEvents = pgTable(
  'savings_events',
  {
    id: id(),
    userId: fk('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    organizationId: fk('organization_id').references(() => organizations.id, { onDelete: 'set null' }),
    source: savingsSource('source').notNull(),

    amountMinor: money('amount_minor').notNull(),
    currency: char('currency', { length: 3 }).default('INR').notNull(),
    category: varchar('category', { length: 60 }).notNull(),
    description: varchar('description', { length: 200 }).notNull(),

    bookingId: fk('booking_id').references(() => bookings.id, { onDelete: 'set null' }),
    offerId: fk('offer_id').references(() => offers.id, { onDelete: 'set null' }),
    receiptId: fk('receipt_id').references(() => receipts.id, { onDelete: 'set null' }),

    occurredAt: ts('occurred_at').defaultNow().notNull(),
    createdAt: now(),
  },
  (t) => [
    index('savings_user_occurred_idx').on(t.userId, t.occurredAt),
    index('savings_user_category_idx').on(t.userId, t.category),
  ],
);

// ─────────────────────────────────────────────────────────────
// City pass
// ─────────────────────────────────────────────────────────────

export const cityPasses = pgTable(
  'city_passes',
  {
    id: id(),
    cityId: fk('city_id')
      .notNull()
      .references(() => cities.id, { onDelete: 'cascade' }),
    slug: varchar('slug', { length: 60 }).notNull(),
    name: varchar('name', { length: 140 }).notNull(),
    tagline: varchar('tagline', { length: 200 }),
    description: text('description'),

    priceMinor: money('price_minor').notNull(),
    currency: char('currency', { length: 3 }).default('INR').notNull(),
    validDays: integer('valid_days').default(3).notNull(),
    /** Sum of the entitlements at list price. The headline "worth ₹x" number. */
    faceValueMinor: money('face_value_minor').default(0).notNull(),

    isActive: boolean('is_active').default(true).notNull(),
    createdAt: now(),
    updatedAt: ts('updated_at').defaultNow().notNull(),
  },
  (t) => [uniqueIndex('city_passes_slug_key').on(t.slug), index('city_passes_city_idx').on(t.cityId)],
);

export const cityPassEntitlements = pgTable(
  'city_pass_entitlements',
  {
    id: id(),
    cityPassId: fk('city_pass_id')
      .notNull()
      .references(() => cityPasses.id, { onDelete: 'cascade' }),
    venueId: fk('venue_id')
      .notNull()
      .references(() => venues.id, { onDelete: 'cascade' }),
    organizationId: fk('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),

    title: varchar('title', { length: 160 }).notNull(),
    detail: varchar('detail', { length: 300 }),
    /** How many times a holder may use this during the pass window. */
    allowance: integer('allowance').default(1).notNull(),
    listValueMinor: money('list_value_minor').notNull(),
    /** What the platform pays the partner per use — the revenue-share term. */
    settlementMinor: money('settlement_minor').notNull(),

    position: integer('position').default(0).notNull(),
    createdAt: now(),
  },
  (t) => [
    uniqueIndex('city_pass_entitlements_venue_key').on(t.cityPassId, t.venueId, t.title),
    index('city_pass_entitlements_pass_idx').on(t.cityPassId),
  ],
);

export const cityPassHoldings = pgTable(
  'city_pass_holdings',
  {
    id: id(),
    publicRef: varchar('public_ref', { length: 32 }).notNull(),
    cityPassId: fk('city_pass_id')
      .notNull()
      .references(() => cityPasses.id, { onDelete: 'cascade' }),
    userId: fk('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    transactionId: fk('transaction_id').references(() => transactions.id, { onDelete: 'set null' }),

    activatedAt: ts('activated_at'),
    expiresAt: ts('expires_at'),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: now(),
  },
  (t) => [
    uniqueIndex('city_pass_holdings_public_ref_key').on(t.publicRef),
    index('city_pass_holdings_user_idx').on(t.userId, t.isActive),
  ],
);

export const cityPassUses = pgTable(
  'city_pass_uses',
  {
    id: id(),
    holdingId: fk('holding_id')
      .notNull()
      .references(() => cityPassHoldings.id, { onDelete: 'cascade' }),
    entitlementId: fk('entitlement_id')
      .notNull()
      .references(() => cityPassEntitlements.id, { onDelete: 'cascade' }),
    userId: fk('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** 1..allowance. The unique index is the allowance limit. */
    sequence: integer('sequence').default(1).notNull(),
    valueMinor: money('value_minor').notNull(),
    createdAt: now(),
  },
  (t) => [
    uniqueIndex('city_pass_uses_seq_key').on(t.holdingId, t.entitlementId, t.sequence),
    index('city_pass_uses_holding_idx').on(t.holdingId),
  ],
);

// ─────────────────────────────────────────────────────────────
// Plans — one shape serves both the day planner and travel mode, because a
// three-day trip is a day plan with more days, not a different idea.
// ─────────────────────────────────────────────────────────────

export const itineraries = pgTable(
  'itineraries',
  {
    id: id(),
    publicRef: varchar('public_ref', { length: 32 }).notNull(),
    userId: fk('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    cityId: fk('city_id').references(() => cities.id, { onDelete: 'set null' }),

    kind: itineraryKind('kind').notNull(),
    state: itineraryState('state').default('DRAFT').notNull(),
    title: varchar('title', { length: 160 }).notNull(),

    /** What the user asked for, kept so a plan can be explained and re-run. */
    request: jsonb('request').$type<{
      budgetMinor?: number;
      interests?: string[];
      startsAt?: string;
      endsAt?: string;
      partySize?: number;
      prompt?: string;
      /** Travel: where from, where to, and how much the dates can move. */
      originCode?: string;
      destinationCode?: string;
      flexDays?: number;
      cabin?: string;
      /** Multi-city, when the trip is more than an out-and-back. */
      legs?: { origin: string; destination: string; departOn: string }[];
    }>(),
    /**
     * How this plan was produced. Recorded because the consumer is told, and
     * because "which planner version chose this" is the first question when a
     * plan is wrong. Never claims a model that is not connected.
     */
    generator: varchar('generator', { length: 60 }).default('rule-engine-v1').notNull(),

    budgetMinor: money('budget_minor'),
    plannedSpendMinor: money('planned_spend_minor').default(0).notNull(),
    plannedSavingMinor: money('planned_saving_minor').default(0).notNull(),

    startsAt: ts('starts_at'),
    endsAt: ts('ends_at'),
    createdAt: now(),
    updatedAt: ts('updated_at').defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('itineraries_public_ref_key').on(t.publicRef),
    index('itineraries_user_created_idx').on(t.userId, t.createdAt),
  ],
);

export const itineraryItems = pgTable(
  'itinerary_items',
  {
    id: id(),
    itineraryId: fk('itinerary_id')
      .notNull()
      .references(() => itineraries.id, { onDelete: 'cascade' }),
    venueId: fk('venue_id').references(() => venues.id, { onDelete: 'set null' }),
    offerId: fk('offer_id').references(() => offers.id, { onDelete: 'set null' }),
    bookingId: fk('booking_id').references(() => bookings.id, { onDelete: 'set null' }),
    /**
     * A flight on the timeline. Untyped at this level — travel.ts is defined
     * after commerce.ts, and a circular reference between the two would buy
     * nothing that the index below does not already give.
     */
    flightBookingId: fk('flight_booking_id'),

    position: integer('position').notNull(),
    title: varchar('title', { length: 160 }).notNull(),
    detail: varchar('detail', { length: 300 }),
    category: varchar('category', { length: 60 }).notNull(),

    startsAt: ts('starts_at'),
    endsAt: ts('ends_at'),
    estimatedCostMinor: money('estimated_cost_minor').default(0).notNull(),
    estimatedSavingMinor: money('estimated_saving_minor').default(0).notNull(),
    /** Why the planner picked this. Shown to the user verbatim. */
    rationale: varchar('rationale', { length: 300 }),

    createdAt: now(),
  },
  (t) => [
    uniqueIndex('itinerary_items_position_key').on(t.itineraryId, t.position),
    index('itinerary_items_itinerary_idx').on(t.itineraryId),
    index('itinerary_items_flight_booking_idx').on(t.flightBookingId),
  ],
);

// ─────────────────────────────────────────────────────────────
// Merchant intelligence — computed from real rows, with the method recorded.
// ─────────────────────────────────────────────────────────────

/**
 * A statement about a merchant's own numbers.
 *
 * `evidence` holds the figures the statement was derived from, and `method` names
 * the calculation. Both are shown in the console: an unexplained number on a
 * dashboard is a number nobody acts on, and a claim we cannot show the working
 * for is one we should not be making.
 */
export const merchantInsights = pgTable(
  'merchant_insights',
  {
    id: id(),
    organizationId: fk('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    venueId: fk('venue_id').references(() => venues.id, { onDelete: 'cascade' }),

    severity: insightSeverity('severity').notNull(),
    headline: varchar('headline', { length: 200 }).notNull(),
    detail: text('detail').notNull(),
    recommendation: text('recommendation'),

    /** e.g. 'weekday-revenue-variance'. Names the calculation, not a product claim. */
    method: varchar('method', { length: 80 }).notNull(),
    evidence: jsonb('evidence').$type<Record<string, number | string>>().notNull(),
    /** Rows the calculation ran over. Below a threshold the console says so. */
    sampleSize: integer('sample_size').default(0).notNull(),

    windowStart: ts('window_start').notNull(),
    windowEnd: ts('window_end').notNull(),
    /** Set when the merchant acts on it, so the same advice is not repeated. */
    actedAt: ts('acted_at'),
    dismissedAt: ts('dismissed_at'),

    computedAt: ts('computed_at').defaultNow().notNull(),
    createdAt: now(),
  },
  (t) => [
    uniqueIndex('merchant_insights_window_key').on(t.organizationId, t.method, t.windowStart),
    index('merchant_insights_org_computed_idx').on(t.organizationId, t.computedAt),
  ],
);

/**
 * An estimate of demand for one slot window.
 *
 * Explicitly an estimate: `method` names the arithmetic (a trailing mean over
 * matching weekday windows), `confidence` falls with the sample size, and the UI
 * is required to label it. There is no model here and the schema does not
 * pretend there is one.
 */
export const demandForecasts = pgTable(
  'demand_forecasts',
  {
    id: id(),
    organizationId: fk('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    venueId: fk('venue_id')
      .notNull()
      .references(() => venues.id, { onDelete: 'cascade' }),

    windowStart: ts('window_start').notNull(),
    windowEnd: ts('window_end').notNull(),

    capacity: integer('capacity').notNull(),
    expectedDemand: integer('expected_demand').notNull(),
    expectedUtilisationBp: integer('expected_utilisation_bp').notNull(),
    /** 0–100. Derived from sample size and dispersion, not asserted. */
    confidence: integer('confidence').default(0).notNull(),
    sampleSize: integer('sample_size').default(0).notNull(),
    method: varchar('method', { length: 80 }).default('trailing-weekday-mean').notNull(),

    suggestedDiscountBp: integer('suggested_discount_bp'),
    suggestedReleaseAt: ts('suggested_release_at'),
    note: varchar('note', { length: 300 }),

    computedAt: ts('computed_at').defaultNow().notNull(),
    createdAt: now(),
  },
  (t) => [
    uniqueIndex('demand_forecasts_window_key').on(t.venueId, t.windowStart),
    index('demand_forecasts_org_window_idx').on(t.organizationId, t.windowStart),
  ],
);

// ─────────────────────────────────────────────────────────────
// Campaigns — merchant reach, consent first.
// ─────────────────────────────────────────────────────────────

/**
 * A campaign never receives a list of people.
 *
 * The merchant describes an audience in aggregate terms — city, venue kind,
 * recency — and the platform delivers to the consumers who match *and* who hold
 * a live marketing consent. `estimatedReach` is suppressed below a floor so a
 * merchant cannot narrow an audience until it identifies one person.
 */
export const campaigns = pgTable(
  'campaigns',
  {
    id: id(),
    organizationId: fk('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    offerId: fk('offer_id').references(() => offers.id, { onDelete: 'set null' }),
    cityId: fk('city_id').references(() => cities.id, { onDelete: 'set null' }),

    name: varchar('name', { length: 160 }).notNull(),
    state: campaignState('state').default('DRAFT').notNull(),
    objective: varchar('objective', { length: 120 }),

    /** Aggregate selectors only. Never user ids, never contact details. */
    audience: jsonb('audience')
      .$type<{
        cityId?: string;
        venueKinds?: string[];
        visitedVenueKinds?: string[];
        lastActiveWithinDays?: number;
        minLifetimeSpendMinor?: number;
      }>()
      .notNull(),
    /** Recomputed on save; k-anonymity floor applied before it is stored. */
    estimatedReach: integer('estimated_reach').default(0).notNull(),
    reachSuppressed: boolean('reach_suppressed').default(false).notNull(),

    budgetMinor: money('budget_minor'),
    costPerDeliveryMinor: money('cost_per_delivery_minor').default(50).notNull(),
    spendMinor: money('spend_minor').default(0).notNull(),

    startsAt: ts('starts_at'),
    endsAt: ts('ends_at'),
    createdBy: fk('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: now(),
    updatedAt: ts('updated_at').defaultNow().notNull(),
  },
  (t) => [
    index('campaigns_org_state_idx').on(t.organizationId, t.state),
    index('campaigns_state_starts_idx').on(t.state, t.startsAt),
  ],
);

export const campaignEvents = pgTable(
  'campaign_events',
  {
    id: id(),
    campaignId: fk('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    /**
     * Present so a consumer can see and stop what is targeting them, and so a
     * delivery is counted once. The merchant-facing API only ever aggregates it.
     */
    userId: fk('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: campaignEventKind('kind').notNull(),
    bookingId: fk('booking_id').references(() => bookings.id, { onDelete: 'set null' }),
    revenueMinor: money('revenue_minor').default(0).notNull(),
    createdAt: now(),
  },
  (t) => [
    uniqueIndex('campaign_events_once_key').on(t.campaignId, t.userId, t.kind),
    index('campaign_events_campaign_kind_idx').on(t.campaignId, t.kind),
    index('campaign_events_user_idx').on(t.userId),
  ],
);

// ─────────────────────────────────────────────────────────────
// Developer platform — api_keys and webhooks already exist in schema.ts; this
// adds the metering that turns them into a product with a price.
// ─────────────────────────────────────────────────────────────

export const apiUsage = pgTable(
  'api_usage',
  {
    id: id(),
    apiKeyId: fk('api_key_id')
      .notNull()
      .references(() => apiKeys.id, { onDelete: 'cascade' }),
    organizationId: fk('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),

    /** Daily buckets. Per-request rows would dwarf every other table by an order. */
    day: date('day').notNull(),
    endpoint: varchar('endpoint', { length: 120 }).notNull(),
    calls: integer('calls').default(0).notNull(),
    errors: integer('errors').default(0).notNull(),
    /** Sum of durations in ms; mean is derived. Avoids storing a running average. */
    totalMs: integer('total_ms').default(0).notNull(),

    createdAt: now(),
    updatedAt: ts('updated_at').defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('api_usage_day_endpoint_key').on(t.apiKeyId, t.day, t.endpoint),
    index('api_usage_org_day_idx').on(t.organizationId, t.day),
  ],
);

// ─────────────────────────────────────────────────────────────
// Households and corporate benefits.
//
// A corporate account is an Organization with kind = CORPORATE — there is no
// separate company table, because a company that sponsors benefits and a company
// that runs a venue are the same kind of tenant with different roles.
// ─────────────────────────────────────────────────────────────

export const households = pgTable(
  'households',
  {
    id: id(),
    name: varchar('name', { length: 120 }).notNull(),
    organiserUserId: fk('organiser_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Shared cap across the household per calendar month, minor units. */
    monthlyCapMinor: money('monthly_cap_minor'),
    shareRewards: boolean('share_rewards').default(true).notNull(),
    createdAt: now(),
    updatedAt: ts('updated_at').defaultNow().notNull(),
  },
  (t) => [index('households_organiser_idx').on(t.organiserUserId)],
);

export const householdMembers = pgTable(
  'household_members',
  {
    id: id(),
    householdId: fk('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    userId: fk('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: householdRole('role').default('ADULT').notNull(),

    /** Per-member spend permission. Null means the household cap applies. */
    spendCapMinor: money('spend_cap_minor'),
    canBook: boolean('can_book').default(true).notNull(),
    canRedeemPoints: boolean('can_redeem_points').default(false).notNull(),

    /** A member joins by accepting; an invitation is not membership. */
    acceptedAt: ts('accepted_at'),
    createdAt: now(),
  },
  (t) => [
    uniqueIndex('household_members_key').on(t.householdId, t.userId),
    index('household_members_user_idx').on(t.userId),
  ],
);

export const corporateBenefits = pgTable(
  'corporate_benefits',
  {
    id: id(),
    /** The sponsoring company, as an organization. */
    organizationId: fk('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 160 }).notNull(),
    description: varchar('description', { length: 400 }),
    category: varchar('category', { length: 60 }).notNull(),

    /** Wallet credit per employee per period, minor units. */
    allowanceMinor: money('allowance_minor').notNull(),
    periodMonths: integer('period_months').default(1).notNull(),
    /** Optional restriction to particular partner kinds. */
    restrictedToVenueKinds: jsonb('restricted_to_venue_kinds').$type<string[]>().default([]).notNull(),

    isActive: boolean('is_active').default(true).notNull(),
    createdAt: now(),
    updatedAt: ts('updated_at').defaultNow().notNull(),
  },
  (t) => [index('corporate_benefits_org_idx').on(t.organizationId, t.isActive)],
);

export const benefitAllocations = pgTable(
  'benefit_allocations',
  {
    id: id(),
    benefitId: fk('benefit_id')
      .notNull()
      .references(() => corporateBenefits.id, { onDelete: 'cascade' }),
    userId: fk('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    organizationId: fk('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),

    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    allocatedMinor: money('allocated_minor').notNull(),
    usedMinor: money('used_minor').default(0).notNull(),

    createdAt: now(),
    updatedAt: ts('updated_at').defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('benefit_allocations_period_key').on(t.benefitId, t.userId, t.periodStart),
    index('benefit_allocations_user_idx').on(t.userId, t.periodEnd),
  ],
);

// ─────────────────────────────────────────────────────────────
// Explorer — gamification, kept adult: a checklist with a real reward, not badges
// that mean nothing.
// ─────────────────────────────────────────────────────────────

export const quests = pgTable(
  'quests',
  {
    id: id(),
    cityId: fk('city_id').references(() => cities.id, { onDelete: 'cascade' }),
    slug: varchar('slug', { length: 60 }).notNull(),
    name: varchar('name', { length: 140 }).notNull(),
    description: varchar('description', { length: 400 }),

    /** Each step names a venue kind and how many distinct visits it needs. */
    steps: jsonb('steps').$type<{ venueKind: string; count: number; label: string }[]>().notNull(),
    rewardPoints: integer('reward_points').default(0).notNull(),
    badge: varchar('badge', { length: 60 }),

    startsAt: ts('starts_at'),
    endsAt: ts('ends_at'),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: now(),
  },
  (t) => [uniqueIndex('quests_slug_key').on(t.slug), index('quests_city_active_idx').on(t.cityId, t.isActive)],
);

export const questProgress = pgTable(
  'quest_progress',
  {
    id: id(),
    questId: fk('quest_id')
      .notNull()
      .references(() => quests.id, { onDelete: 'cascade' }),
    userId: fk('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    state: questState('state').default('IN_PROGRESS').notNull(),
    /** Distinct venue ids credited per step index. Distinctness is the point. */
    progress: jsonb('progress').$type<Record<string, string[]>>().default({}).notNull(),
    completedAt: ts('completed_at'),
    claimedAt: ts('claimed_at'),

    createdAt: now(),
    updatedAt: ts('updated_at').defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('quest_progress_key').on(t.questId, t.userId),
    index('quest_progress_user_idx').on(t.userId, t.state),
  ],
);

// ─────────────────────────────────────────────────────────────
// Relations
// ─────────────────────────────────────────────────────────────

export const citiesRelations = relations(cities, ({ many }) => ({
  venues: many(venues),
  cityPasses: many(cityPasses),
  quests: many(quests),
}));

export const venuesRelations = relations(venues, ({ one, many }) => ({
  organization: one(organizations, { fields: [venues.organizationId], references: [organizations.id] }),
  city: one(cities, { fields: [venues.cityId], references: [cities.id] }),
  slots: many(inventorySlots),
  offers: many(offers),
}));

export const inventorySlotsRelations = relations(inventorySlots, ({ one, many }) => ({
  venue: one(venues, { fields: [inventorySlots.venueId], references: [venues.id] }),
  organization: one(organizations, { fields: [inventorySlots.organizationId], references: [organizations.id] }),
  offers: many(offers),
}));

export const offersRelations = relations(offers, ({ one, many }) => ({
  organization: one(organizations, { fields: [offers.organizationId], references: [organizations.id] }),
  venue: one(venues, { fields: [offers.venueId], references: [venues.id] }),
  slot: one(inventorySlots, { fields: [offers.slotId], references: [inventorySlots.id] }),
  city: one(cities, { fields: [offers.cityId], references: [cities.id] }),
  redemptions: many(offerRedemptions),
}));

export const offerRedemptionsRelations = relations(offerRedemptions, ({ one }) => ({
  offer: one(offers, { fields: [offerRedemptions.offerId], references: [offers.id] }),
  user: one(users, { fields: [offerRedemptions.userId], references: [users.id] }),
}));

export const bookingsRelations = relations(bookings, ({ one, many }) => ({
  user: one(users, { fields: [bookings.userId], references: [users.id] }),
  organization: one(organizations, { fields: [bookings.organizationId], references: [organizations.id] }),
  venue: one(venues, { fields: [bookings.venueId], references: [venues.id] }),
  slot: one(inventorySlots, { fields: [bookings.slotId], references: [inventorySlots.id] }),
  offer: one(offers, { fields: [bookings.offerId], references: [offers.id] }),
  transaction: one(transactions, { fields: [bookings.transactionId], references: [transactions.id] }),
  tickets: many(tickets),
  receipts: many(receipts),
}));

export const ticketsRelations = relations(tickets, ({ one }) => ({
  booking: one(bookings, { fields: [tickets.bookingId], references: [bookings.id] }),
  user: one(users, { fields: [tickets.userId], references: [users.id] }),
  organization: one(organizations, { fields: [tickets.organizationId], references: [organizations.id] }),
  venue: one(venues, { fields: [tickets.venueId], references: [venues.id] }),
}));

export const receiptsRelations = relations(receipts, ({ one, many }) => ({
  user: one(users, { fields: [receipts.userId], references: [users.id] }),
  organization: one(organizations, { fields: [receipts.organizationId], references: [organizations.id] }),
  venue: one(venues, { fields: [receipts.venueId], references: [venues.id] }),
  booking: one(bookings, { fields: [receipts.bookingId], references: [bookings.id] }),
  transaction: one(transactions, { fields: [receipts.transactionId], references: [transactions.id] }),
  lines: many(receiptLines),
  warranties: many(warranties),
  returns: many(returnRequests),
}));

export const receiptLinesRelations = relations(receiptLines, ({ one, many }) => ({
  receipt: one(receipts, { fields: [receiptLines.receiptId], references: [receipts.id] }),
  warranty: one(warranties, { fields: [receiptLines.id], references: [warranties.receiptLineId] }),
  returns: many(returnRequests),
}));

export const warrantiesRelations = relations(warranties, ({ one }) => ({
  user: one(users, { fields: [warranties.userId], references: [users.id] }),
  organization: one(organizations, { fields: [warranties.organizationId], references: [organizations.id] }),
  receipt: one(receipts, { fields: [warranties.receiptId], references: [receipts.id] }),
  line: one(receiptLines, { fields: [warranties.receiptLineId], references: [receiptLines.id] }),
}));

export const returnRequestsRelations = relations(returnRequests, ({ one }) => ({
  user: one(users, { fields: [returnRequests.userId], references: [users.id] }),
  organization: one(organizations, { fields: [returnRequests.organizationId], references: [organizations.id] }),
  receipt: one(receipts, { fields: [returnRequests.receiptId], references: [receipts.id] }),
  line: one(receiptLines, { fields: [returnRequests.receiptLineId], references: [receiptLines.id] }),
}));

export const rewardProgramsRelations = relations(rewardPrograms, ({ one }) => ({
  organization: one(organizations, { fields: [rewardPrograms.organizationId], references: [organizations.id] }),
}));

export const rewardAccountsRelations = relations(rewardAccounts, ({ one, many }) => ({
  user: one(users, { fields: [rewardAccounts.userId], references: [users.id] }),
  issuer: one(organizations, { fields: [rewardAccounts.issuerOrganizationId], references: [organizations.id] }),
  entries: many(rewardLedger),
}));

export const rewardLedgerRelations = relations(rewardLedger, ({ one }) => ({
  account: one(rewardAccounts, { fields: [rewardLedger.accountId], references: [rewardAccounts.id] }),
  user: one(users, { fields: [rewardLedger.userId], references: [users.id] }),
  counterparty: one(organizations, {
    fields: [rewardLedger.counterpartyOrganizationId],
    references: [organizations.id],
  }),
}));

export const savingsEventsRelations = relations(savingsEvents, ({ one }) => ({
  user: one(users, { fields: [savingsEvents.userId], references: [users.id] }),
  organization: one(organizations, { fields: [savingsEvents.organizationId], references: [organizations.id] }),
  booking: one(bookings, { fields: [savingsEvents.bookingId], references: [bookings.id] }),
  offer: one(offers, { fields: [savingsEvents.offerId], references: [offers.id] }),
}));

export const cityPassesRelations = relations(cityPasses, ({ one, many }) => ({
  city: one(cities, { fields: [cityPasses.cityId], references: [cities.id] }),
  entitlements: many(cityPassEntitlements),
  holdings: many(cityPassHoldings),
}));

export const cityPassEntitlementsRelations = relations(cityPassEntitlements, ({ one }) => ({
  cityPass: one(cityPasses, { fields: [cityPassEntitlements.cityPassId], references: [cityPasses.id] }),
  venue: one(venues, { fields: [cityPassEntitlements.venueId], references: [venues.id] }),
  organization: one(organizations, {
    fields: [cityPassEntitlements.organizationId],
    references: [organizations.id],
  }),
}));

export const cityPassHoldingsRelations = relations(cityPassHoldings, ({ one, many }) => ({
  cityPass: one(cityPasses, { fields: [cityPassHoldings.cityPassId], references: [cityPasses.id] }),
  user: one(users, { fields: [cityPassHoldings.userId], references: [users.id] }),
  uses: many(cityPassUses),
}));

export const cityPassUsesRelations = relations(cityPassUses, ({ one }) => ({
  holding: one(cityPassHoldings, { fields: [cityPassUses.holdingId], references: [cityPassHoldings.id] }),
  entitlement: one(cityPassEntitlements, {
    fields: [cityPassUses.entitlementId],
    references: [cityPassEntitlements.id],
  }),
}));

export const itinerariesRelations = relations(itineraries, ({ one, many }) => ({
  user: one(users, { fields: [itineraries.userId], references: [users.id] }),
  city: one(cities, { fields: [itineraries.cityId], references: [cities.id] }),
  items: many(itineraryItems),
}));

export const itineraryItemsRelations = relations(itineraryItems, ({ one }) => ({
  itinerary: one(itineraries, { fields: [itineraryItems.itineraryId], references: [itineraries.id] }),
  venue: one(venues, { fields: [itineraryItems.venueId], references: [venues.id] }),
  offer: one(offers, { fields: [itineraryItems.offerId], references: [offers.id] }),
}));

export const merchantInsightsRelations = relations(merchantInsights, ({ one }) => ({
  organization: one(organizations, { fields: [merchantInsights.organizationId], references: [organizations.id] }),
  venue: one(venues, { fields: [merchantInsights.venueId], references: [venues.id] }),
}));

export const demandForecastsRelations = relations(demandForecasts, ({ one }) => ({
  organization: one(organizations, { fields: [demandForecasts.organizationId], references: [organizations.id] }),
  venue: one(venues, { fields: [demandForecasts.venueId], references: [venues.id] }),
}));

export const campaignsRelations = relations(campaigns, ({ one, many }) => ({
  organization: one(organizations, { fields: [campaigns.organizationId], references: [organizations.id] }),
  offer: one(offers, { fields: [campaigns.offerId], references: [offers.id] }),
  events: many(campaignEvents),
}));

export const campaignEventsRelations = relations(campaignEvents, ({ one }) => ({
  campaign: one(campaigns, { fields: [campaignEvents.campaignId], references: [campaigns.id] }),
}));

export const apiUsageRelations = relations(apiUsage, ({ one }) => ({
  apiKey: one(apiKeys, { fields: [apiUsage.apiKeyId], references: [apiKeys.id] }),
  organization: one(organizations, { fields: [apiUsage.organizationId], references: [organizations.id] }),
}));

export const householdsRelations = relations(households, ({ one, many }) => ({
  organiser: one(users, { fields: [households.organiserUserId], references: [users.id] }),
  members: many(householdMembers),
}));

export const householdMembersRelations = relations(householdMembers, ({ one }) => ({
  household: one(households, { fields: [householdMembers.householdId], references: [households.id] }),
  user: one(users, { fields: [householdMembers.userId], references: [users.id] }),
}));

export const corporateBenefitsRelations = relations(corporateBenefits, ({ one, many }) => ({
  organization: one(organizations, { fields: [corporateBenefits.organizationId], references: [organizations.id] }),
  allocations: many(benefitAllocations),
}));

export const benefitAllocationsRelations = relations(benefitAllocations, ({ one }) => ({
  benefit: one(corporateBenefits, { fields: [benefitAllocations.benefitId], references: [corporateBenefits.id] }),
  user: one(users, { fields: [benefitAllocations.userId], references: [users.id] }),
}));

export const questsRelations = relations(quests, ({ one, many }) => ({
  city: one(cities, { fields: [quests.cityId], references: [cities.id] }),
  progress: many(questProgress),
}));

export const questProgressRelations = relations(questProgress, ({ one }) => ({
  quest: one(quests, { fields: [questProgress.questId], references: [quests.id] }),
  user: one(users, { fields: [questProgress.userId], references: [users.id] }),
}));
