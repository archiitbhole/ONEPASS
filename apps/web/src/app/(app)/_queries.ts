/**
 * Reads the consumer screens need that no service already exposes.
 *
 * Everything here is a query, never a write, and every figure is an aggregate over
 * rows that something else wrote — savings come from `savings_events`, activity from
 * `notifications`, discovery from `venues`. Nothing in this file invents a number,
 * because a screen that shows an invented number is worse than a screen that shows
 * an empty state.
 *
 * It lives beside the pages rather than in `lib/` because it is presentation-shaped:
 * these are the exact shapes six screens need, not a general API.
 */
import { redirect } from 'next/navigation';
import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';
import { db } from '@/db/client';
import {
  cities,
  cityPassEntitlements,
  cityPassHoldings,
  cityPassUses,
  cityPasses,
  consentGrants,
  gifts,
  inventorySlots,
  notificationPreferences,
  notifications,
  offers,
  organizations,
  partnerConnections,
  questProgress,
  quests,
  receiptLines,
  receipts,
  returnRequests,
  rewardAccounts,
  savingsEvents,
  splitRequests,
  users,
  venueKind,
  venues,
  warranties,
} from '@/db/schema';
import { listSessions } from '@/lib/auth/session';
import { getActor, type Actor } from '@/lib/authz/authorize';

/**
 * The signed-in person, for a page under this layout.
 *
 * The layout has already redirected an unauthenticated request, so this is belt and
 * braces — but it is the kind of belt that means no page below can accidentally
 * render somebody's tickets to nobody.
 */
export async function currentActor(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) redirect('/sign-in');
  return actor;
}

export type VenueKind = (typeof venueKind.enumValues)[number];

/** The categories the explore filters offer, straight from the schema's own enum. */
export const VENUE_KINDS: readonly VenueKind[] = venueKind.enumValues;

export function isVenueKind(value: string): value is VenueKind {
  return (VENUE_KINDS as readonly string[]).includes(value);
}

// ── time ─────────────────────────────────────────────────────

/**
 * Midnight on the first of the current month, in India.
 *
 * The app's money is Indian and its clock is Asia/Kolkata, so "this month" has to be
 * decided in that zone; deciding it in UTC would move the boundary by five and a half
 * hours and quietly move a purchase between months.
 */
export function startOfMonthIST(now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);

  const year = Number(parts.find((p) => p.type === 'year')?.value ?? '1970');
  const month = Number(parts.find((p) => p.type === 'month')?.value ?? '1');

  // IST is UTC+5:30 with no daylight saving, so the offset is a constant.
  return new Date(Date.UTC(year, month - 1, 1, 0, 0, 0) - 5.5 * 3600_000);
}

// ── savings ──────────────────────────────────────────────────

export interface SavingsBucket {
  key: string;
  amountMinor: number;
  count: number;
}

export interface SavingsBreakdown {
  totalMinor: number;
  eventCount: number;
  thisMonthMinor: number;
  byCategory: SavingsBucket[];
  byMonth: SavingsBucket[];
  bySource: SavingsBucket[];
}

/** One row's worth of "you saved this much this month", summed from real events. */
export async function savingsThisMonth(userId: string, now: Date = new Date()): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${savingsEvents.amountMinor}), 0)::bigint` })
    .from(savingsEvents)
    .where(and(eq(savingsEvents.userId, userId), gte(savingsEvents.occurredAt, startOfMonthIST(now))));

  return Number(row?.total ?? 0);
}

/**
 * Everything the savings screen shows, in three group-bys over the same rows.
 *
 * A month with no savings is absent rather than present as a zero — the chart adds
 * the missing months itself, from the range it is drawing, so a gap is visibly a gap
 * rather than a row somebody invented.
 */
export async function savingsBreakdown(userId: string, now: Date = new Date()): Promise<SavingsBreakdown> {
  const owner = eq(savingsEvents.userId, userId);

  const [totals] = await db
    .select({
      total: sql<string>`coalesce(sum(${savingsEvents.amountMinor}), 0)::bigint`,
      n: sql<number>`count(*)::int`,
    })
    .from(savingsEvents)
    .where(owner);

  const byCategory = await db
    .select({
      key: sql<string>`coalesce(nullif(${savingsEvents.category}, ''), 'OTHER')`,
      amountMinor: sql<string>`coalesce(sum(${savingsEvents.amountMinor}), 0)::bigint`,
      n: sql<number>`count(*)::int`,
    })
    .from(savingsEvents)
    .where(owner)
    .groupBy(sql`coalesce(nullif(${savingsEvents.category}, ''), 'OTHER')`)
    .orderBy(sql`coalesce(sum(${savingsEvents.amountMinor}), 0) desc`);

  const byMonth = await db
    .select({
      key: sql<string>`to_char(date_trunc('month', ${savingsEvents.occurredAt} at time zone 'Asia/Kolkata'), 'YYYY-MM')`,
      amountMinor: sql<string>`coalesce(sum(${savingsEvents.amountMinor}), 0)::bigint`,
      n: sql<number>`count(*)::int`,
    })
    .from(savingsEvents)
    .where(owner)
    .groupBy(sql`date_trunc('month', ${savingsEvents.occurredAt} at time zone 'Asia/Kolkata')`)
    .orderBy(sql`date_trunc('month', ${savingsEvents.occurredAt} at time zone 'Asia/Kolkata') asc`);

  const bySource = await db
    .select({
      key: sql<string>`${savingsEvents.source}`,
      amountMinor: sql<string>`coalesce(sum(${savingsEvents.amountMinor}), 0)::bigint`,
      n: sql<number>`count(*)::int`,
    })
    .from(savingsEvents)
    .where(owner)
    .groupBy(savingsEvents.source)
    .orderBy(sql`coalesce(sum(${savingsEvents.amountMinor}), 0) desc`);

  const shape = (rows: { key: string; amountMinor: string; n: number }[]): SavingsBucket[] =>
    rows.map((r) => ({ key: r.key, amountMinor: Number(r.amountMinor), count: Number(r.n) }));

  return {
    totalMinor: Number(totals?.total ?? 0),
    eventCount: Number(totals?.n ?? 0),
    thisMonthMinor: await savingsThisMonth(userId, now),
    byCategory: shape(byCategory),
    byMonth: shape(byMonth),
    bySource: shape(bySource),
  };
}

// ── activity ─────────────────────────────────────────────────

/**
 * Recent activity, read from the notifications the domain already writes.
 *
 * Bookings, receipts, returns and pass rotations all call `notify()` inside the
 * transaction that caused them, so this list is a record of things that actually
 * happened rather than a feed assembled for the screen.
 */
export async function recentActivity(userId: string, limit = 6) {
  return db
    .select({
      id: notifications.id,
      category: notifications.category,
      title: notifications.title,
      body: notifications.body,
      linkPath: notifications.linkPath,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.id))
    .limit(limit);
}

// ── discovery ────────────────────────────────────────────────

export interface DiscoverArgs {
  q?: string;
  kind?: VenueKind;
  citySlug?: string;
  limit?: number;
}

/** `%` and `_` typed into a search box are characters, not wildcards. */
function likePattern(q: string): string {
  return `%${q.trim().replace(/([\\%_])/g, '\\$1')}%`;
}

/** Live cities, for the explore filter. A city that is not live is not offered. */
export async function listLiveCities() {
  return db
    .select({ id: cities.id, slug: cities.slug, name: cities.name, state: cities.state })
    .from(cities)
    .where(eq(cities.isLive, true))
    .orderBy(asc(cities.name));
}

export async function discoverVenues(args: DiscoverArgs) {
  const conditions = [eq(venues.isActive, true)];
  if (args.kind) conditions.push(eq(venues.kind, args.kind));
  if (args.citySlug) conditions.push(eq(cities.slug, args.citySlug));
  if (args.q && args.q.trim().length > 0) {
    const pattern = likePattern(args.q);
    conditions.push(or(ilike(venues.name, pattern), ilike(venues.locality, pattern))!);
  }

  return db
    .select({
      venue: venues,
      city: { name: cities.name, slug: cities.slug, state: cities.state },
      organization: { name: organizations.name },
    })
    .from(venues)
    .leftJoin(cities, eq(cities.id, venues.cityId))
    .leftJoin(organizations, eq(organizations.id, venues.organizationId))
    .where(and(...conditions))
    .orderBy(asc(venues.name))
    .limit(Math.min(args.limit ?? 36, 100));
}

/** How many offers are live right now at each of these venues. */
export async function liveOfferCounts(venueIds: string[], now = new Date()) {
  if (venueIds.length === 0) return new Map<string, number>();

  const rows = await db
    .select({ venueId: offers.venueId, n: sql<number>`count(*)::int` })
    .from(offers)
    .where(
      and(
        inArray(offers.venueId, venueIds),
        eq(offers.status, 'LIVE'),
        // `gt`/`lte` rather than a raw sql template. A template loses the
        // column's type mapper, so postgres.js receives a bare JS Date with no
        // hint that it is a timestamptz and refuses to serialise it. The typed
        // helpers carry the mapping, which is the whole reason they exist.
        gt(offers.endsAt, now),
        lte(offers.startsAt, now),
      ),
    )
    .groupBy(offers.venueId);

  return new Map(rows.filter((r) => r.venueId).map((r) => [r.venueId!, Number(r.n)]));
}

// ── one deal ─────────────────────────────────────────────────

/**
 * A single offer with the venue it applies at and the slot it prices.
 *
 * The slot is what carries the real remaining capacity, so it is read here rather
 * than estimated from the offer's own counters.
 */
export async function offerDetail(publicRef: string) {
  const [row] = await db
    .select({
      offer: offers,
      venue: venues,
      slot: inventorySlots,
      organization: { name: organizations.name, slug: organizations.slug },
      city: { name: cities.name, state: cities.state },
    })
    .from(offers)
    .leftJoin(venues, eq(venues.id, offers.venueId))
    .leftJoin(inventorySlots, eq(inventorySlots.id, offers.slotId))
    .leftJoin(organizations, eq(organizations.id, offers.organizationId))
    .leftJoin(cities, eq(cities.id, venues.cityId))
    .where(eq(offers.publicRef, publicRef))
    .limit(1);

  return row ?? null;
}

// ── wallet ───────────────────────────────────────────────────

/** Names for the organizations behind a set of reward accounts or ledger rows. */
export async function organizationNames(ids: (string | null)[]): Promise<Map<string, string>> {
  const real = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (real.length === 0) return new Map();

  const rows = await db
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .where(inArray(organizations.id, real));

  return new Map(rows.map((r) => [r.id, r.name]));
}

/**
 * Which reward account each ledger row belongs to, and who issued it.
 *
 * `reward_ledger.balanceAfter` is the balance of *that account* after the entry,
 * so a statement that prints it without saying which account it belongs to is a
 * running balance that appears to jump. This is the lookup that lets the wallet
 * name the account beside every line.
 */
export async function rewardAccountIssuers(userId: string): Promise<Map<string, string | null>> {
  const rows = await db
    .select({ id: rewardAccounts.id, issuerOrganizationId: rewardAccounts.issuerOrganizationId })
    .from(rewardAccounts)
    .where(eq(rewardAccounts.userId, userId));

  return new Map(rows.map((r) => [r.id, r.issuerOrganizationId]));
}

// ── receipts ─────────────────────────────────────────────────

/**
 * The categories that actually appear on this person's receipts.
 *
 * The filter offers these and nothing else. A dropdown listing categories nobody
 * has ever bought in is a set of options that can only return an empty page.
 */
export async function receiptCategories(userId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ category: receiptLines.category })
    .from(receiptLines)
    .innerJoin(receipts, eq(receipts.id, receiptLines.receiptId))
    .where(and(eq(receipts.userId, userId), isNotNull(receiptLines.category)))
    .orderBy(asc(receiptLines.category));

  return rows.map((r) => r.category).filter((c): c is string => Boolean(c && c.trim()));
}

/** How many warranties each of these receipts produced, for the list's badge. */
export async function warrantyCountsForReceipts(receiptIds: string[]): Promise<Map<string, number>> {
  if (receiptIds.length === 0) return new Map();

  const rows = await db
    .select({ receiptId: warranties.receiptId, n: sql<number>`count(*)::int` })
    .from(warranties)
    .where(inArray(warranties.receiptId, receiptIds))
    .groupBy(warranties.receiptId);

  return new Map(rows.map((r) => [r.receiptId, Number(r.n)]));
}

// ── returns ──────────────────────────────────────────────────

/**
 * How much of each line on a receipt is already spoken for by a return case.
 *
 * The predicate is the same one `requestReturn` enforces inside its transaction:
 * REJECTED and CANCELLED release their claim, and a CLOSED case only holds one
 * if a resolution was actually granted. Keeping the two in step matters because
 * this is what decides whether the page offers a return form at all — offering
 * one the service will refuse is worse than not offering it.
 */
export async function claimedReturnQuantities(receiptId: string): Promise<Map<string, number>> {
  const rows = await db
    .select({
      receiptLineId: returnRequests.receiptLineId,
      claimed: sql<number>`coalesce(sum(${returnRequests.quantity}), 0)::int`,
    })
    .from(returnRequests)
    .where(
      and(
        eq(returnRequests.receiptId, receiptId),
        notInArray(returnRequests.state, ['REJECTED', 'CANCELLED']),
        or(ne(returnRequests.state, 'CLOSED'), isNotNull(returnRequests.grantedResolution))!,
      ),
    )
    .groupBy(returnRequests.receiptLineId);

  return new Map(rows.map((r) => [r.receiptLineId, Number(r.claimed)]));
}

// ── profile ──────────────────────────────────────────────────

/**
 * Everything the profile screen shows, in one place.
 *
 * The user row is copied field by field rather than spread: it carries a password
 * hash and a sealed MFA secret, and a spread would be one new column away from
 * rendering a credential.
 */
export async function profileSnapshot(userId: string) {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    with: { profile: true },
  });

  const connections = await db.query.partnerConnections.findMany({
    where: eq(partnerConnections.userId, userId),
    with: { organization: true },
    orderBy: [desc(partnerConnections.connectedAt)],
    limit: 50,
  });

  const consents = await db.query.consentGrants.findMany({
    where: eq(consentGrants.userId, userId),
    with: { organization: true, version: { with: { definition: true } } },
    orderBy: [desc(consentGrants.grantedAt)],
    limit: 50,
  });

  const sessions = await listSessions(userId);

  const preferences = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId))
    .orderBy(asc(notificationPreferences.category), asc(notificationPreferences.channel));

  const [unread] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));

  return {
    account: user
      ? {
          status: user.status,
          email: user.email,
          emailVerified: Boolean(user.emailVerifiedAt),
          mobile: user.mobile,
          mobileVerified: Boolean(user.mobileVerifiedAt),
          mfaEnabled: user.mfaEnabled,
          lastLoginAt: user.lastLoginAt,
          createdAt: user.createdAt,
        }
      : null,
    profile: user?.profile ?? null,
    connections,
    consents,
    sessions,
    preferences,
    unreadNotifications: Number(unread?.n ?? 0),
  };
}

// ── gifting ─────────────────────────────────────────────────

export interface GiftableOffer {
  offerId: string;
  publicRef: string;
  title: string;
  organizationId: string;
  slotId: string;
  venueName: string | null;
  venueLocality: string | null;
  priceMinor: number;
  listPriceMinor: number | null;
  currency: string;
  startsAt: Date;
  endsAt: Date;
  remaining: number;
}

/**
 * The deals a gift can actually be bought against.
 *
 * `listLiveDeals` is the right thing for browsing but returns a view without the
 * slot or the organization, and `createGift` needs both: the slot is the capacity
 * it holds and the organization is checked against the slot's own owner. So this
 * is the same predicate — live, started, not ended, capacity left — selected for
 * what the gift form has to post.
 *
 * `gt`/`lte` rather than a raw template, for the reason spelled out in
 * db/sql-helpers.ts: a bare Date in a `sql` template reaches the driver with no
 * type mapping and fails.
 */
export async function giftableOffers(now: Date = new Date(), limit = 24): Promise<GiftableOffer[]> {
  const rows = await db
    .select({
      offer: offers,
      slot: {
        id: inventorySlots.id,
        capacity: inventorySlots.capacity,
        heldCount: inventorySlots.heldCount,
        soldCount: inventorySlots.soldCount,
        listPriceMinor: inventorySlots.listPriceMinor,
      },
      venue: { name: venues.name, locality: venues.locality },
    })
    .from(offers)
    // Inner join: an offer with no slot has no capacity to hand over, so it is
    // not something a gift can be bought against.
    .innerJoin(inventorySlots, eq(inventorySlots.id, offers.slotId))
    .leftJoin(venues, eq(venues.id, offers.venueId))
    .where(and(eq(offers.status, 'LIVE'), gt(offers.endsAt, now), lte(offers.startsAt, now)))
    .orderBy(asc(offers.endsAt))
    .limit(Math.min(limit * 2, 100));

  return rows
    .map((r) => ({
      offerId: r.offer.id,
      publicRef: r.offer.publicRef,
      title: r.offer.title,
      organizationId: r.offer.organizationId,
      slotId: r.slot.id,
      venueName: r.venue?.name ?? null,
      venueLocality: r.venue?.locality ?? null,
      priceMinor: r.offer.priceMinor ?? r.slot.listPriceMinor,
      listPriceMinor: r.offer.listPriceMinor ?? r.slot.listPriceMinor,
      currency: r.offer.currency,
      startsAt: r.offer.startsAt,
      endsAt: r.offer.endsAt,
      remaining: Math.max(0, r.slot.capacity - r.slot.heldCount - r.slot.soldCount),
    }))
    .filter((o) => o.remaining > 0)
    .slice(0, limit);
}

// ── city pass ───────────────────────────────────────────────

export interface CityPassEntitlementView {
  id: string;
  title: string;
  detail: string | null;
  allowance: number;
  listValueMinor: number;
  venueName: string | null;
  venueLocality: string | null;
  venueKind: string | null;
  venuePublicRef: string | null;
  organizationName: string | null;
}

export interface CityPassOverview {
  pass: {
    id: string;
    slug: string;
    name: string;
    tagline: string | null;
    description: string | null;
    priceMinor: number;
    currency: string;
    validDays: number;
    faceValueMinor: number;
  };
  city: { name: string; state: string | null } | null;
  entitlements: CityPassEntitlementView[];
  /** The holding this person has, or null. Nothing is invented when there is none. */
  holding: {
    id: string;
    publicRef: string;
    activatedAt: Date | null;
    expiresAt: Date | null;
    createdAt: Date;
  } | null;
  /** Entitlement id → uses recorded against this holding. Empty without a holding. */
  usedByEntitlement: Map<string, number>;
}

/**
 * Everything the city pass screen shows, with the holder's own usage if they hold one.
 *
 * The remaining allowance is `allowance − count(city_pass_uses)` per entitlement,
 * counted against this holding. There is no cached "remaining" column and this does
 * not create one: the uses table is the record, and a number derived from it cannot
 * drift away from the rows it claims to total.
 *
 * The schema allows many passes per city; the product ships one, so this reads the
 * active pass rather than taking a slug the caller might get wrong.
 */
export async function cityPassOverview(userId: string): Promise<CityPassOverview | null> {
  const [found] = await db
    .select({ pass: cityPasses, city: { name: cities.name, state: cities.state } })
    .from(cityPasses)
    .leftJoin(cities, eq(cities.id, cityPasses.cityId))
    .where(eq(cityPasses.isActive, true))
    .orderBy(asc(cityPasses.createdAt))
    .limit(1);

  if (!found) return null;

  const entitlementRows = await db
    .select({
      entitlement: cityPassEntitlements,
      venue: {
        name: venues.name,
        locality: venues.locality,
        kind: venues.kind,
        publicRef: venues.publicRef,
      },
      organization: { name: organizations.name },
    })
    .from(cityPassEntitlements)
    .leftJoin(venues, eq(venues.id, cityPassEntitlements.venueId))
    .leftJoin(organizations, eq(organizations.id, cityPassEntitlements.organizationId))
    .where(eq(cityPassEntitlements.cityPassId, found.pass.id))
    .orderBy(asc(cityPassEntitlements.position));

  const [holding] = await db
    .select({
      id: cityPassHoldings.id,
      publicRef: cityPassHoldings.publicRef,
      activatedAt: cityPassHoldings.activatedAt,
      expiresAt: cityPassHoldings.expiresAt,
      createdAt: cityPassHoldings.createdAt,
    })
    .from(cityPassHoldings)
    .where(
      and(
        eq(cityPassHoldings.userId, userId),
        eq(cityPassHoldings.cityPassId, found.pass.id),
        eq(cityPassHoldings.isActive, true),
      ),
    )
    .orderBy(desc(cityPassHoldings.createdAt))
    .limit(1);

  const usedByEntitlement = new Map<string, number>();
  if (holding) {
    const uses = await db
      .select({ entitlementId: cityPassUses.entitlementId, n: sql<number>`count(*)::int` })
      .from(cityPassUses)
      .where(eq(cityPassUses.holdingId, holding.id))
      .groupBy(cityPassUses.entitlementId);

    for (const use of uses) usedByEntitlement.set(use.entitlementId, Number(use.n));
  }

  return {
    pass: {
      id: found.pass.id,
      slug: found.pass.slug,
      name: found.pass.name,
      tagline: found.pass.tagline,
      description: found.pass.description,
      priceMinor: found.pass.priceMinor,
      currency: found.pass.currency,
      validDays: found.pass.validDays,
      faceValueMinor: found.pass.faceValueMinor,
    },
    city: found.city ?? null,
    entitlements: entitlementRows.map((r) => ({
      id: r.entitlement.id,
      title: r.entitlement.title,
      detail: r.entitlement.detail,
      allowance: r.entitlement.allowance,
      listValueMinor: r.entitlement.listValueMinor,
      venueName: r.venue?.name ?? null,
      venueLocality: r.venue?.locality ?? null,
      venueKind: r.venue?.kind ?? null,
      venuePublicRef: r.venue?.publicRef ?? null,
      organizationName: r.organization?.name ?? null,
    })),
    holding: holding ?? null,
    usedByEntitlement,
  };
}

// ── quests ──────────────────────────────────────────────────

export interface QuestStep {
  venueKind: string;
  count: number;
  label: string;
}

export interface QuestView {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  steps: QuestStep[];
  rewardPoints: number;
  badge: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  city: { name: string; state: string | null } | null;
  /** Null when this person has never been credited a step. Not a zeroed stand-in. */
  progress: {
    state: string;
    /** Step index (as written in the jsonb) → the distinct venue ids credited. */
    credited: Record<string, string[]>;
    completedAt: Date | null;
    claimedAt: Date | null;
    updatedAt: Date;
  } | null;
}

/**
 * The live quests and this person's progress against them.
 *
 * `quest_progress.progress` is the record — a map of step index to the distinct
 * venue ids credited — and nothing here recomputes it from visits. A person with
 * no row has no progress, which the screen says rather than drawing four zeroes
 * that look like a start somebody has made.
 */
export async function activeQuests(userId: string, now: Date = new Date()): Promise<QuestView[]> {
  const rows = await db
    .select({
      quest: quests,
      city: { name: cities.name, state: cities.state },
      progress: questProgress,
    })
    .from(quests)
    .leftJoin(cities, eq(cities.id, quests.cityId))
    .leftJoin(
      questProgress,
      and(eq(questProgress.questId, quests.id), eq(questProgress.userId, userId)),
    )
    .where(eq(quests.isActive, true))
    .orderBy(asc(quests.name))
    .limit(20);

  return rows
    .filter((r) => {
      // A quest that has not opened, or has closed, is not a checklist anybody
      // can act on. The window is on the row; it is not assumed to be open.
      if (r.quest.startsAt && r.quest.startsAt.getTime() > now.getTime()) return false;
      if (r.quest.endsAt && r.quest.endsAt.getTime() <= now.getTime()) return false;
      return true;
    })
    .map((r) => ({
      id: r.quest.id,
      slug: r.quest.slug,
      name: r.quest.name,
      description: r.quest.description,
      steps: r.quest.steps,
      rewardPoints: r.quest.rewardPoints,
      badge: r.quest.badge,
      startsAt: r.quest.startsAt,
      endsAt: r.quest.endsAt,
      city: r.city ?? null,
      progress: r.progress
        ? {
            state: r.progress.state,
            credited: r.progress.progress ?? {},
            completedAt: r.progress.completedAt,
            claimedAt: r.progress.claimedAt,
            updatedAt: r.progress.updatedAt,
          }
        : null,
    }));
}

/** Names for the venues a quest has credited, so a step can say where it was earned. */
export async function venueNames(ids: string[]): Promise<Map<string, string>> {
  const real = [...new Set(ids.filter((id) => Boolean(id)))];
  if (real.length === 0) return new Map();

  const rows = await db
    .select({ id: venues.id, name: venues.name })
    .from(venues)
    .where(inArray(venues.id, real));

  return new Map(rows.map((r) => [r.id, r.name]));
}

// ── splits ──────────────────────────────────────────────────

/**
 * Who organised a split.
 *
 * `getSplit` deliberately returns a view with no user ids on it, which is right
 * for a screen but leaves one question it cannot answer: whether the person
 * reading is the organiser, and so whether to draw the organiser's controls.
 * Answering it by assuming the first share is the organiser's would be a guess
 * that happens to be true today. This asks the column.
 */
export async function splitOrganiserId(publicRef: string): Promise<string | null> {
  const [row] = await db
    .select({ organiserUserId: splitRequests.organiserUserId })
    .from(splitRequests)
    .where(eq(splitRequests.publicRef, publicRef))
    .limit(1);

  return row?.organiserUserId ?? null;
}

// ── gifts ───────────────────────────────────────────────────

/**
 * The internal id of a gift this person sent, or null.
 *
 * `deliverGift` takes an id and checks no ownership of its own — it is written to
 * be called by a scheduler as well as by a person. So the screen's action has to
 * establish that the gift belongs to whoever pressed the button, and this is that
 * check: the sender's id is part of the predicate, so another sender's public
 * reference simply does not resolve.
 */
export async function sentGiftId(publicRef: string, senderUserId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: gifts.id })
    .from(gifts)
    .where(and(eq(gifts.publicRef, publicRef), eq(gifts.senderUserId, senderUserId)))
    .limit(1);

  return row?.id ?? null;
}
