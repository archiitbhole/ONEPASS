/**
 * Test fixtures. Every helper writes through the same code paths the application
 * uses, so a test that passes here is evidence about the real system rather than
 * about a parallel implementation invented for tests.
 */
import { eq } from 'drizzle-orm';
import { db, sql as pg } from '@/db/client';
import * as t from '@/db/schema';
import { ulid, publicRef } from '@/lib/ids';
import { hashPassword } from '@/lib/auth/password';
import { seal } from '@/lib/crypto';
import { generatePassSecret } from '@onepass/pass';
import { seedReferenceData } from '@/db/seed-data';
import type { Actor, Membership } from '@/lib/authz/authorize';
import type { RoleName } from '@/lib/authz/permissions';

let referenceReady = false;

export async function ensureReferenceData() {
  if (referenceReady) return;
  await seedReferenceData();
  referenceReady = true;
}

/** Wipe everything except the reference data the whole system depends on. */
export async function resetDatabase() {
  await pg`
    TRUNCATE TABLE
      verifications, credential_revocations, credentials, credential_types, issuer_keys, disclosure_receipts,
      pass_presentations, passes, consent_grants, partner_connections,
      transactions, payment_methods, notifications, notification_preferences,
      audit_logs, security_events, outbox_events, idempotency_keys,
      webhook_deliveries, webhooks, api_keys, support_tickets,
      account_deletion_requests, auth_events, verification_requests,
      sessions, devices, user_roles, organization_members, user_profiles,
      -- commerce
      ownership_transfers, product_instances,
      savings_events, reward_ledger, reward_accounts, reward_programs,
      offer_redemptions, tickets, receipt_lines, receipts, warranties,
      return_requests, bookings, offers, inventory_slots, venues,
      city_pass_uses, city_pass_holdings, city_pass_entitlements, city_passes,
      itinerary_collaborators, itinerary_items, itineraries,
      quest_progress, quests, merchant_insights, demand_forecasts,
      campaign_events, campaigns, api_usage, household_members, households,
      benefit_allocations, corporate_benefits, venue_nodes, venue_maps,
      parked_vehicles, split_shares, split_requests, gifts, cities,
      -- travel. Airports and airlines are reference data and survive, like roles
      -- and permissions: they are facts about the world, not fixtures, and
      -- truncating them would make every travel test seed them again.
      cashback_ledger, flight_tickets, flight_passengers, flight_bookings,
      flight_provider_events, flight_provider_health, flight_price_observations,
      flight_segments, flight_offers, flight_searches,
      cashback_rules, bank_offers,
      organizations, users
    RESTART IDENTITY CASCADE`;
}

let travelReferenceReady = false;

/**
 * Airports, airlines and the illustrative offers, for tests that need them.
 *
 * Separate from `ensureReferenceData` because most tests do not go near travel
 * and seeding thirty airports for each of them would be waste. The commercial
 * rows are re-seeded per call because `resetDatabase` truncates them — a bank
 * offer is a fixture, an airport is not.
 */
export async function ensureTravelReferenceData() {
  const { seedTravelCommercials, seedTravelReferenceData } = await import('@/db/seed-travel');
  if (!travelReferenceReady) {
    await seedTravelReferenceData();
    travelReferenceReady = true;
  }
  await seedTravelCommercials();
}

export async function closeDatabase() {
  await pg.end();
}

export async function makeUser(opts: { name: string; email?: string; platformStaff?: boolean } ) {
  const id = ulid();
  const email = opts.email ?? `${id.toLowerCase()}@test.invalid`;
  await db.insert(t.users).values({
    id,
    status: 'ACTIVE',
    email,
    emailVerifiedAt: new Date(),
    passwordHash: await hashPassword('correct-horse-battery-staple'),
    isPlatformStaff: opts.platformStaff ?? false,
  });
  await db.insert(t.userProfiles).values({ id: ulid(), userId: id, displayName: opts.name });
  await db.insert(t.passes).values({
    id: ulid(),
    userId: id,
    passRef: publicRef('px', 9),
    secretCipher: seal(generatePassSecret()),
  });
  return { id, email };
}

export async function makeOrg(name: string, status: 'ACTIVE' | 'SUSPENDED' = 'ACTIVE') {
  const id = ulid();
  await db.insert(t.organizations).values({
    id,
    slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${id.slice(-6).toLowerCase()}`,
    name,
    kind: 'OTHER',
    status,
  });
  return id;
}

async function roleId(name: RoleName) {
  const row = await db.query.roles.findFirst({ where: eq(t.roles.name, name) });
  if (!row) throw new Error(`role ${name} missing — call ensureReferenceData()`);
  return row.id;
}

export async function addMember(organizationId: string, userId: string, role: RoleName) {
  const membershipId = ulid();
  await db.insert(t.organizationMembers).values({
    id: membershipId,
    organizationId,
    userId,
    status: 'ACTIVE',
    joinedAt: new Date(),
  });
  await db.insert(t.userRoles).values({ id: ulid(), userId, roleId: await roleId(role), membershipId });
  return membershipId;
}

export async function addPlatformRole(userId: string, role: RoleName) {
  await db.insert(t.userRoles).values({ id: ulid(), userId, roleId: await roleId(role) });
}

/**
 * Build the Actor an authorized request would carry. Assembled from the database
 * rather than hand-written, so a test cannot accidentally grant itself a role the
 * real login path would not.
 */
export async function actorFor(userId: string, opts: { elevated?: boolean } = {}): Promise<Actor> {
  const user = await db.query.users.findFirst({ where: eq(t.users.id, userId), with: { profile: true } });
  if (!user) throw new Error('no such user');

  const rows = await db
    .select({
      roleName: t.roles.name,
      membershipId: t.userRoles.membershipId,
      memberStatus: t.organizationMembers.status,
      organizationId: t.organizationMembers.organizationId,
      organizationName: t.organizations.name,
      organizationSlug: t.organizations.slug,
      organizationStatus: t.organizations.status,
    })
    .from(t.userRoles)
    .innerJoin(t.roles, eq(t.roles.id, t.userRoles.roleId))
    .leftJoin(t.organizationMembers, eq(t.organizationMembers.id, t.userRoles.membershipId))
    .leftJoin(t.organizations, eq(t.organizations.id, t.organizationMembers.organizationId))
    .where(eq(t.userRoles.userId, userId));

  const platformRoles: RoleName[] = [];
  const memberships = new Map<string, Membership>();
  for (const r of rows) {
    const name = r.roleName as RoleName;
    if (!r.membershipId || !r.organizationId) {
      platformRoles.push(name);
      continue;
    }
    const found = memberships.get(r.membershipId);
    if (found) {
      found.roles.push(name);
      continue;
    }
    memberships.set(r.membershipId, {
      membershipId: r.membershipId,
      organizationId: r.organizationId,
      organizationName: r.organizationName ?? '',
      organizationSlug: r.organizationSlug ?? '',
      organizationStatus: (r.organizationStatus ?? 'PENDING_REVIEW') as Membership['organizationStatus'],
      status: (r.memberStatus ?? 'INVITED') as Membership['status'],
      roles: [name],
    });
  }

  return {
    userId: user.id,
    session: {
      sessionId: ulid(),
      userId: user.id,
      deviceId: null,
      elevatedAt: opts.elevated ? new Date() : null,
      expiresAt: new Date(Date.now() + 3600_000),
    },
    status: user.status,
    email: user.email,
    mobile: user.mobile,
    displayName: user.profile?.displayName ?? 'test user',
    isPlatformStaff: user.isPlatformStaff,
    platformRoles,
    memberships: [...memberships.values()],
    elevated: !!opts.elevated,
  };
}

export async function makeCredentialType(
  organizationId: string,
  overrides: Partial<typeof t.credentialTypes.$inferInsert> = {},
) {
  const id = ulid();
  await db.insert(t.credentialTypes).values({
    id,
    organizationId,
    key: overrides.key ?? 'student.id',
    name: overrides.name ?? 'Student ID',
    category: overrides.category ?? 'IDENTITY',
    claimSchema: overrides.claimSchema ?? ['programme', 'rollNumber', 'year'],
    defaultValidityDays: overrides.defaultValidityDays ?? null,
    discloseHolderName: overrides.discloseHolderName ?? true,
    ...overrides,
  });
  return id;
}

// ── commerce factories ───────────────────────────────────────

export async function makeVenue(
  organizationId: string,
  opts: { name?: string; kind?: 'HOTEL' | 'RESTAURANT' | 'CINEMA' | 'RETAIL_STORE' | 'ATTRACTION' | 'EXPERIENCE' | 'PARKING'; cityId?: string } = {},
) {
  const id = ulid();
  await db.insert(t.venues).values({
    id,
    organizationId,
    cityId: opts.cityId ?? null,
    publicRef: publicRef('ven'),
    name: opts.name ?? 'Test Venue',
    kind: opts.kind ?? 'CINEMA',
    tags: [],
    isActive: true,
  });
  return id;
}

/** A slot starting in an hour, so it is always in the future for a test. */
export async function makeSlot(
  venueId: string,
  organizationId: string,
  opts: { capacity?: number; listPriceMinor?: number; startsAt?: Date; unit?: 'SEAT' | 'ROOM' | 'TABLE' | 'BAY' } = {},
) {
  const id = ulid();
  const startsAt = opts.startsAt ?? new Date(Date.now() + 3600_000);
  await db.insert(t.inventorySlots).values({
    id,
    venueId,
    organizationId,
    label: 'Test slot',
    unit: opts.unit ?? 'SEAT',
    startsAt,
    endsAt: new Date(startsAt.getTime() + 7200_000),
    capacity: opts.capacity ?? 10,
    listPriceMinor: opts.listPriceMinor ?? 30000,
  });
  return id;
}

export async function makeTransaction(
  userId: string,
  organizationId: string,
  amountMinor: number,
  status: 'INITIATED' | 'CAPTURED' = 'CAPTURED',
) {
  const id = ulid();
  await db.insert(t.transactions).values({
    id,
    userId,
    organizationId,
    amountMinor,
    status,
    provider: 'SANDBOX',
    providerOrderId: publicRef('ord'),
  });
  return id;
}


/**
 * Empty the limiter's windows between tests.
 *
 * The limiter stays switched on in tests — it is a security control, and a
 * suite that disabled it would be testing a configuration nobody ships. What
 * this clears is the *previous* test's spend. It waits for the connection
 * because the shared client has no offline queue: a command sent while it is
 * still connecting throws rather than waiting, and a clear that silently did
 * nothing is how a suite ends up measuring the test before it.
 */
export async function clearRateLimits(): Promise<void> {
  const { redis } = await import('@/lib/redis');
  const client = redis();
  if (!client) return;
  if (client.status !== 'ready') {
    await new Promise<void>((resolve) => {
      const done = () => resolve();
      client.once('ready', done);
      setTimeout(done, 3000).unref?.();
    });
  }
  if (client.status !== 'ready') return;
  const keys = await client.keys('rl:*');
  if (keys.length) await client.del(...keys);
}
