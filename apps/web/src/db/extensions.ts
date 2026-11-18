/**
 * The seven tables the duplication audit authorised — and only those.
 *
 * Every other requested capability was satisfied by composing what already
 * exists: parking books an `inventory_slot`, a campus is an `organization`, a
 * student is a `credential`, the concierge is the planner, voice is an input
 * method. What survived that filter is here, and each one records why it could
 * not be a column on something that already existed.
 *
 * Note what is deliberately absent: no payment table (splits settle through
 * `transactions`), no gift wallet (a gift holds a `booking`), no second planner
 * (collaborators attach to `itineraries`), no location store (parking memory
 * points at a `venue`).
 */
import { relations } from 'drizzle-orm';
import {
  boolean,
  char,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { organizations, transactions, users } from './schema';
import { bookings, itineraries, offers, venues } from './commerce';

const id = () => char('id', { length: 26 }).primaryKey();
const fk = (name: string) => char(name, { length: 26 });
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const now = () => ts('created_at').defaultNow().notNull();
const money = (name: string) => integer(name);

// ─────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────

export const splitState = pgEnum('split_state', ['OPEN', 'SETTLED', 'PARTIAL', 'CANCELLED', 'EXPIRED']);
export const shareState = pgEnum('share_state', ['PENDING', 'PAID', 'DECLINED', 'WAIVED', 'REFUNDED']);
export const splitMethod = pgEnum('split_method', ['EQUAL', 'BY_AMOUNT', 'BY_SHARE']);

export const giftState = pgEnum('gift_state', ['PAID', 'DELIVERED', 'CLAIMED', 'EXPIRED', 'REFUNDED', 'CANCELLED']);

export const collaboratorRole = pgEnum('collaborator_role', ['ORGANISER', 'CONTRIBUTOR', 'VIEWER']);

export const nodeKind = pgEnum('node_kind', [
  'ENTRANCE',
  'EXIT',
  'SCREEN',
  'GATE',
  'DESK',
  'RESTROOM',
  'FOOD',
  'RETAIL',
  'LIFT',
  'STAIRS',
  'RAMP',
  'PARKING_BAY',
  'SEATING',
  'HELP_POINT',
  'JUNCTION',
]);

// ─────────────────────────────────────────────────────────────
// 1–2. Split commerce.
//
// A split is not a payment. It is an agreement about who owes what against one
// amount, and each share settles through the existing `transactions` table when
// its payer pays. That is why there is no money column here that is not a
// derived total: introducing one would have created a second ledger.
// ─────────────────────────────────────────────────────────────

export const splitRequests = pgTable(
  'split_requests',
  {
    id: id(),
    publicRef: varchar('public_ref', { length: 32 }).notNull(),
    /** Who started it and is answerable for the whole amount if nobody else pays. */
    organiserUserId: fk('organiser_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    organizationId: fk('organization_id').references(() => organizations.id, { onDelete: 'set null' }),
    bookingId: fk('booking_id').references(() => bookings.id, { onDelete: 'set null' }),

    title: varchar('title', { length: 160 }).notNull(),
    note: varchar('note', { length: 300 }),
    state: splitState('state').default('OPEN').notNull(),
    method: splitMethod('method').default('EQUAL').notNull(),

    totalMinor: money('total_minor').notNull(),
    /** Sum of settled shares. Recomputed on every share transition, never incremented blindly. */
    settledMinor: money('settled_minor').default(0).notNull(),
    currency: char('currency', { length: 3 }).default('INR').notNull(),

    expiresAt: ts('expires_at'),
    settledAt: ts('settled_at'),
    createdAt: now(),
    updatedAt: ts('updated_at').defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('split_requests_public_ref_key').on(t.publicRef),
    index('split_requests_organiser_idx').on(t.organiserUserId, t.createdAt),
    index('split_requests_state_idx').on(t.state, t.expiresAt),
  ],
);

export const splitShares = pgTable(
  'split_shares',
  {
    id: id(),
    splitId: fk('split_id')
      .notNull()
      .references(() => splitRequests.id, { onDelete: 'cascade' }),
    /**
     * Null until the invitee has an account. A split can be addressed to someone
     * who has not signed up yet, which is most of the point of a split.
     */
    userId: fk('user_id').references(() => users.id, { onDelete: 'set null' }),
    /**
     * How the invitation was addressed, as a one-way peppered hash. The plaintext
     * address is not kept: knowing who owes ₹1,200 is the organiser's business,
     * not a contact list ONEPASS should be accumulating.
     */
    inviteeHash: varchar('invitee_hash', { length: 64 }),
    /** Shown to the organiser so the list is readable. Supplied by the organiser. */
    displayLabel: varchar('display_label', { length: 80 }).notNull(),

    state: shareState('state').default('PENDING').notNull(),
    amountMinor: money('amount_minor').notNull(),
    /** Only used when method = BY_SHARE. Amount is derived from it on write. */
    shareUnits: integer('share_units').default(1).notNull(),

    transactionId: fk('transaction_id').references(() => transactions.id, { onDelete: 'set null' }),
    /** A share invitation is a link; this is its token, hashed. */
    claimTokenHash: varchar('claim_token_hash', { length: 64 }),

    paidAt: ts('paid_at'),
    remindedAt: ts('reminded_at'),
    createdAt: now(),
    updatedAt: ts('updated_at').defaultNow().notNull(),
  },
  (t) => [
    index('split_shares_split_idx').on(t.splitId),
    index('split_shares_user_state_idx').on(t.userId, t.state),
    uniqueIndex('split_shares_claim_token_key').on(t.claimTokenHash),
  ],
);

// ─────────────────────────────────────────────────────────────
// 3. Gifting.
//
// A gift is a booking that has been paid for and is waiting for its holder. The
// booking, the ticket and the receipt are all the existing ones; this row only
// says who it is for and how it is claimed.
// ─────────────────────────────────────────────────────────────

export const gifts = pgTable(
  'gifts',
  {
    id: id(),
    publicRef: varchar('public_ref', { length: 32 }).notNull(),
    senderUserId: fk('sender_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Set when claimed. Before that the gift belongs to nobody. */
    recipientUserId: fk('recipient_user_id').references(() => users.id, { onDelete: 'set null' }),
    /** How it was sent, hashed — same reasoning as split_shares.inviteeHash. */
    recipientHash: varchar('recipient_hash', { length: 64 }),
    recipientLabel: varchar('recipient_label', { length: 80 }).notNull(),

    organizationId: fk('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    venueId: fk('venue_id').references(() => venues.id, { onDelete: 'set null' }),
    offerId: fk('offer_id').references(() => offers.id, { onDelete: 'set null' }),
    /** The paid booking being handed over. Created at purchase, reassigned at claim. */
    bookingId: fk('booking_id').references(() => bookings.id, { onDelete: 'set null' }),
    transactionId: fk('transaction_id').references(() => transactions.id, { onDelete: 'set null' }),

    state: giftState('state').default('PAID').notNull(),
    title: varchar('title', { length: 160 }).notNull(),
    message: varchar('message', { length: 500 }),
    amountMinor: money('amount_minor').notNull(),
    currency: char('currency', { length: 3 }).default('INR').notNull(),

    claimTokenHash: varchar('claim_token_hash', { length: 64 }).notNull(),
    /** An unclaimed gift is refunded to the sender rather than kept. */
    expiresAt: ts('expires_at').notNull(),
    deliverAt: ts('deliver_at'),
    deliveredAt: ts('delivered_at'),
    claimedAt: ts('claimed_at'),

    createdAt: now(),
    updatedAt: ts('updated_at').defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('gifts_public_ref_key').on(t.publicRef),
    uniqueIndex('gifts_claim_token_key').on(t.claimTokenHash),
    index('gifts_sender_idx').on(t.senderUserId, t.createdAt),
    index('gifts_recipient_idx').on(t.recipientUserId, t.state),
    index('gifts_state_expiry_idx').on(t.state, t.expiresAt),
  ],
);

// ─────────────────────────────────────────────────────────────
// 4. Group booking rooms — collaborators on an itinerary that already exists.
//
// The alternative was a `group_plans` table with items, costs and linked
// bookings: an exact copy of `itineraries` and `itinerary_items` under another
// name. Votes live in the same row as membership because a vote without a member
// is not a thing, and a separate votes table would have been a join for no gain.
// ─────────────────────────────────────────────────────────────

export const itineraryCollaborators = pgTable(
  'itinerary_collaborators',
  {
    id: id(),
    itineraryId: fk('itinerary_id')
      .notNull()
      .references(() => itineraries.id, { onDelete: 'cascade' }),
    userId: fk('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: collaboratorRole('role').default('CONTRIBUTOR').notNull(),

    /** itineraryItemId → 'UP' | 'DOWN'. One map per person beats a row per vote. */
    votes: jsonb('votes').$type<Record<string, 'UP' | 'DOWN'>>().default({}).notNull(),
    /** What this person has agreed to put in, minor units. Settled via split_shares. */
    pledgedMinor: money('pledged_minor').default(0).notNull(),

    invitedAt: ts('invited_at').defaultNow().notNull(),
    acceptedAt: ts('accepted_at'),
    createdAt: now(),
    updatedAt: ts('updated_at').defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('itinerary_collaborators_key').on(t.itineraryId, t.userId),
    index('itinerary_collaborators_user_idx').on(t.userId),
  ],
);

// ─────────────────────────────────────────────────────────────
// 5–6. Indoor maps.
//
// A floor plan is a graph, not a picture: nodes with coordinates and a list of
// neighbours, so "find Screen 7" is a shortest path rather than a highlighted
// image. Storing it this way also means a venue can supply one without ONEPASS
// rendering anything venue-specific.
// ─────────────────────────────────────────────────────────────

export const venueMaps = pgTable(
  'venue_maps',
  {
    id: id(),
    venueId: fk('venue_id')
      .notNull()
      .references(() => venues.id, { onDelete: 'cascade' }),
    organizationId: fk('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),

    level: integer('level').default(0).notNull(),
    levelLabel: varchar('level_label', { length: 40 }).notNull(),
    /** Local plan coordinates, in metres. Not geographic — an indoor plan is flat. */
    widthM: numeric('width_m', { precision: 8, scale: 2 }).notNull(),
    heightM: numeric('height_m', { precision: 8, scale: 2 }).notNull(),

    /**
     * True when the plan was authored as sample content rather than supplied by the
     * venue. Every screen that draws a map reads this and says so — a map that
     * looks authoritative and is not is worse than no map.
     */
    isSample: boolean('is_sample').default(true).notNull(),
    source: varchar('source', { length: 120 }),

    createdAt: now(),
    updatedAt: ts('updated_at').defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('venue_maps_level_key').on(t.venueId, t.level),
    index('venue_maps_venue_idx').on(t.venueId),
  ],
);

export const venueNodes = pgTable(
  'venue_nodes',
  {
    id: id(),
    mapId: fk('map_id')
      .notNull()
      .references(() => venueMaps.id, { onDelete: 'cascade' }),
    venueId: fk('venue_id')
      .notNull()
      .references(() => venues.id, { onDelete: 'cascade' }),

    /** Stable within a venue, so a ticket can name "SCREEN_7" and be routed to it. */
    code: varchar('code', { length: 60 }).notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    kind: nodeKind('kind').notNull(),

    x: numeric('x', { precision: 8, scale: 2 }).notNull(),
    y: numeric('y', { precision: 8, scale: 2 }).notNull(),

    /** Neighbour node codes. An edge list on the node keeps the graph in one table. */
    connects: jsonb('connects').$type<string[]>().default([]).notNull(),
    /** Step-free between this node and its neighbours. Drives accessible routing. */
    stepFree: boolean('step_free').default(true).notNull(),
    detail: varchar('detail', { length: 240 }),

    createdAt: now(),
  },
  (t) => [
    uniqueIndex('venue_nodes_code_key').on(t.venueId, t.code),
    index('venue_nodes_map_idx').on(t.mapId),
    index('venue_nodes_kind_idx').on(t.venueId, t.kind),
  ],
);

// ─────────────────────────────────────────────────────────────
// 7. Parking memory.
//
// Not a column on `bookings`, because most people who need this did not book —
// they parked. Its lifecycle is hours, it is private to one person, and it is
// deleted rather than archived.
// ─────────────────────────────────────────────────────────────

export const parkedVehicles = pgTable(
  'parked_vehicles',
  {
    id: id(),
    userId: fk('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    venueId: fk('venue_id').references(() => venues.id, { onDelete: 'set null' }),
    /** Set when the bay was actually reserved through ONEPASS. */
    bookingId: fk('booking_id').references(() => bookings.id, { onDelete: 'set null' }),
    /** Set when the user pinned it against a mapped node. */
    nodeId: fk('node_id').references(() => venueNodes.id, { onDelete: 'set null' }),

    /** Free text for the common case: no map, no booking, just "P2, row F". */
    levelLabel: varchar('level_label', { length: 40 }),
    sectionLabel: varchar('section_label', { length: 40 }),
    bayLabel: varchar('bay_label', { length: 40 }),
    note: varchar('note', { length: 200 }),
    /** Last four of the plate at most — enough to tell two family cars apart. */
    vehicleLabel: varchar('vehicle_label', { length: 40 }),

    parkedAt: ts('parked_at').defaultNow().notNull(),
    /** Set on retrieval. A row with this set is history and is swept after 30 days. */
    retrievedAt: ts('retrieved_at'),
    reminderAt: ts('reminder_at'),

    createdAt: now(),
  },
  (t) => [
    index('parked_vehicles_user_idx').on(t.userId, t.parkedAt),
    index('parked_vehicles_open_idx').on(t.userId, t.retrievedAt),
  ],
);

// ─────────────────────────────────────────────────────────────
// Relations
// ─────────────────────────────────────────────────────────────

export const splitRequestsRelations = relations(splitRequests, ({ one, many }) => ({
  organiser: one(users, { fields: [splitRequests.organiserUserId], references: [users.id] }),
  organization: one(organizations, { fields: [splitRequests.organizationId], references: [organizations.id] }),
  booking: one(bookings, { fields: [splitRequests.bookingId], references: [bookings.id] }),
  shares: many(splitShares),
}));

export const splitSharesRelations = relations(splitShares, ({ one }) => ({
  split: one(splitRequests, { fields: [splitShares.splitId], references: [splitRequests.id] }),
  user: one(users, { fields: [splitShares.userId], references: [users.id] }),
  transaction: one(transactions, { fields: [splitShares.transactionId], references: [transactions.id] }),
}));

export const giftsRelations = relations(gifts, ({ one }) => ({
  sender: one(users, { fields: [gifts.senderUserId], references: [users.id] }),
  recipient: one(users, { fields: [gifts.recipientUserId], references: [users.id] }),
  organization: one(organizations, { fields: [gifts.organizationId], references: [organizations.id] }),
  venue: one(venues, { fields: [gifts.venueId], references: [venues.id] }),
  booking: one(bookings, { fields: [gifts.bookingId], references: [bookings.id] }),
  offer: one(offers, { fields: [gifts.offerId], references: [offers.id] }),
}));

export const itineraryCollaboratorsRelations = relations(itineraryCollaborators, ({ one }) => ({
  itinerary: one(itineraries, { fields: [itineraryCollaborators.itineraryId], references: [itineraries.id] }),
  user: one(users, { fields: [itineraryCollaborators.userId], references: [users.id] }),
}));

export const venueMapsRelations = relations(venueMaps, ({ one, many }) => ({
  venue: one(venues, { fields: [venueMaps.venueId], references: [venues.id] }),
  organization: one(organizations, { fields: [venueMaps.organizationId], references: [organizations.id] }),
  nodes: many(venueNodes),
}));

export const venueNodesRelations = relations(venueNodes, ({ one }) => ({
  map: one(venueMaps, { fields: [venueNodes.mapId], references: [venueMaps.id] }),
  venue: one(venues, { fields: [venueNodes.venueId], references: [venues.id] }),
}));

export const parkedVehiclesRelations = relations(parkedVehicles, ({ one }) => ({
  user: one(users, { fields: [parkedVehicles.userId], references: [users.id] }),
  venue: one(venues, { fields: [parkedVehicles.venueId], references: [venues.id] }),
  booking: one(bookings, { fields: [parkedVehicles.bookingId], references: [bookings.id] }),
  node: one(venueNodes, { fields: [parkedVehicles.nodeId], references: [venueNodes.id] }),
}));
