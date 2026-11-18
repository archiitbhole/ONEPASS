/**
 * Seed data.
 *
 * Importable: this module defines the seeding functions and runs nothing on
 * import. `seed.ts` is the command that calls them and closes the pool — keeping
 * them apart matters because the test suite imports `seedReferenceData`, and a
 * module that seeds and disconnects as a side effect of being imported took a
 * while to diagnose the first time.
 *
 * Two halves, kept clearly apart:
 *  · Reference data — roles, permissions, consent definitions. Required in every
 *    environment, production included. Idempotent.
 *  · Sample data — example people and businesses, for local development and for
 *    walking through the product. Guarded: it refuses to run against a production
 *    environment, and every sample account is marked so it can be found and removed.
 */
import { eq } from 'drizzle-orm';
import { db } from './client';
import * as t from './schema';
import { ulid, publicRef } from '@/lib/ids';
import { hashPassword } from '@/lib/auth/password';
import { seal } from '@/lib/crypto';
import { generatePassSecret } from '@onepass/pass';
import {
  PERMISSIONS,
  ROLE_DESCRIPTIONS,
  ROLE_PERMISSIONS,
  ROLE_SCOPE,
  ROLE_NAMES,
  type RoleName,
} from '@/lib/authz/permissions';
import { BRAND } from '@/lib/brand';

const SAMPLE_PASSWORD = 'onepass-sample-password';

export async function seedReferenceData() {
  // Permissions
  const permissionIds = new Map<string, string>();
  for (const [key, description] of Object.entries(PERMISSIONS)) {
    const existing = await db.query.permissions.findFirst({ where: eq(t.permissions.key, key) });
    if (existing) {
      permissionIds.set(key, existing.id);
      continue;
    }
    const id = ulid();
    await db.insert(t.permissions).values({ id, key, description });
    permissionIds.set(key, id);
  }

  // Roles + their permission sets
  const roleIds = new Map<RoleName, string>();
  for (const name of ROLE_NAMES) {
    const existing = await db.query.roles.findFirst({ where: eq(t.roles.name, name) });
    const id = existing?.id ?? ulid();
    if (!existing) {
      await db.insert(t.roles).values({ id, name, scope: ROLE_SCOPE[name], description: ROLE_DESCRIPTIONS[name] });
    }
    roleIds.set(name, id);

    for (const permission of ROLE_PERMISSIONS[name]) {
      const permissionId = permissionIds.get(permission);
      if (!permissionId) continue;
      await db.insert(t.rolePermissions).values({ roleId: id, permissionId }).onConflictDoNothing();
    }
  }

  // Consent definitions — the scopes a partner may ask a consumer for.
  const definitions = [
    {
      key: 'identity.basic',
      label: 'Your name',
      description: 'The name shown to staff when you present your pass.',
      fields: ['displayName'],
      sensitive: false,
      body: 'You are sharing your display name with this business so their staff can greet you and match you to your booking.',
    },
    {
      key: 'contact.basic',
      label: 'Contact details',
      description: 'Your email and mobile number, so the business can reach you about a booking.',
      fields: ['email', 'mobile'],
      sensitive: true,
      body: 'You are sharing your email address and mobile number with this business. They may use them only to contact you about services you have booked.',
    },
    {
      key: 'history.transactions',
      label: 'Your history here',
      description: 'What you have previously bought from this business.',
      fields: ['transactions'],
      sensitive: false,
      body: 'You are sharing your transaction history with this business so they can recognise a returning customer and apply the right rewards.',
    },
  ];

  for (const def of definitions) {
    let row = await db.query.consentDefinitions.findFirst({ where: eq(t.consentDefinitions.key, def.key) });
    if (!row) {
      const id = ulid();
      await db.insert(t.consentDefinitions).values({
        id,
        key: def.key,
        label: def.label,
        description: def.description,
        fields: def.fields,
        sensitive: def.sensitive,
      });
      row = await db.query.consentDefinitions.findFirst({ where: eq(t.consentDefinitions.key, def.key) });
    }
    if (!row) continue;

    // Reference data is authoritative in code. A database seeded from an older
    // copy of this list (`display_name` rather than `displayName`) is brought
    // into line rather than left describing fields under a name nothing uses.
    if (row.fields.join(',') !== def.fields.join(',') || row.sensitive !== def.sensitive) {
      await db
        .update(t.consentDefinitions)
        .set({ fields: def.fields, sensitive: def.sensitive })
        .where(eq(t.consentDefinitions.id, row.id));
    }

    const versions = await db.query.consentVersions.findMany({
      where: eq(t.consentVersions.definitionId, row.id),
    });
    if (versions.length === 0) {
      await db.insert(t.consentVersions).values({
        id: ulid(),
        definitionId: row.id,
        version: 1,
        bodyText: def.body,
      });
    }
  }

  return { roleIds, permissionIds };
}

interface MakeUserInput {
  email: string;
  mobile: string;
  displayName: string;
  city?: string;
  platformStaff?: boolean;
  roles: RoleName[];
  roleIds: Map<RoleName, string>;
}

async function makeUser(input: MakeUserInput) {
  const existing = await db.query.users.findFirst({ where: eq(t.users.email, input.email) });
  if (existing) {
    // Re-hash the sample credential rather than returning the row untouched.
    //
    // The seed is idempotent by identity — one row per sample person, forever —
    // and that used to mean the password was written exactly once, at creation.
    // So changing SAMPLE_PASSWORD updated the banner the seed prints and nothing
    // else, and every sample sign-in failed with a correct-looking password on
    // screen. The seed now keeps the stored hash in step with the constant it
    // advertises. Sample accounts only, and never in production — the caller
    // already refuses to run there without an explicit override.
    await db
      .update(t.users)
      .set({ passwordHash: await hashPassword(SAMPLE_PASSWORD), updatedAt: new Date() })
      .where(eq(t.users.id, existing.id));
    return existing;
  }

  const id = ulid();
  const now = new Date();
  await db.insert(t.users).values({
    id,
    status: 'ACTIVE',
    email: input.email,
    emailVerifiedAt: now,
    mobile: input.mobile,
    mobileVerifiedAt: now,
    passwordHash: await hashPassword(SAMPLE_PASSWORD),
    isPlatformStaff: input.platformStaff ?? false,
  });

  await db.insert(t.userProfiles).values({
    id: ulid(),
    userId: id,
    displayName: input.displayName,
    city: input.city ?? 'Pune',
    countryCode: 'IN',
  });

  // Platform-scoped roles only; organization roles are attached with the membership.
  for (const role of input.roles) {
    if (ROLE_SCOPE[role] !== 'PLATFORM') continue;
    const roleId = input.roleIds.get(role);
    if (roleId) await db.insert(t.userRoles).values({ id: ulid(), userId: id, roleId });
  }

  await db.insert(t.passes).values({
    id: ulid(),
    userId: id,
    passRef: publicRef('px', 9),
    secretCipher: seal(generatePassSecret()),
  });

  const user = await db.query.users.findFirst({ where: eq(t.users.id, id) });
  return user!;
}

async function makeOrganization(opts: {
  slug: string;
  name: string;
  kind: 'HOSPITALITY' | 'RETAIL' | 'ENTERTAINMENT' | 'FINANCIAL_SERVICES' | 'OTHER';
  connectorKind: string;
  city: string;
  status?: 'ACTIVE' | 'PENDING_REVIEW';
}) {
  const existing = await db.query.organizations.findFirst({ where: eq(t.organizations.slug, opts.slug) });
  if (existing) return existing;

  const id = ulid();
  await db.insert(t.organizations).values({
    id,
    slug: opts.slug,
    name: opts.name,
    kind: opts.kind,
    status: opts.status ?? 'ACTIVE',
    city: opts.city,
    countryCode: 'IN',
    connectorKind: opts.connectorKind,
    supportEmail: `support@${opts.slug}.example`,
    reviewedAt: opts.status === 'PENDING_REVIEW' ? null : new Date(),
  });
  return (await db.query.organizations.findFirst({ where: eq(t.organizations.id, id) }))!;
}

async function addMember(
  organizationId: string,
  userId: string,
  role: RoleName,
  roleIds: Map<RoleName, string>,
) {
  const existing = await db.query.organizationMembers.findFirst({
    where: eq(t.organizationMembers.userId, userId),
  });
  const membershipId = existing?.id ?? ulid();
  if (!existing) {
    await db.insert(t.organizationMembers).values({
      id: membershipId,
      organizationId,
      userId,
      status: 'ACTIVE',
      joinedAt: new Date(),
    });
  }
  const roleId = roleIds.get(role);
  if (roleId) {
    await db
      .insert(t.userRoles)
      .values({ id: ulid(), userId, roleId, membershipId })
      .onConflictDoNothing();
  }
  return membershipId;
}

async function connect(userId: string, organizationId: string, scopes: string[]) {
  const existing = await db.query.partnerConnections.findFirst({
    where: eq(t.partnerConnections.userId, userId),
  });
  const connectionId = existing?.organizationId === organizationId ? existing.id : ulid();
  if (!existing || existing.organizationId !== organizationId) {
    await db
      .insert(t.partnerConnections)
      .values({ id: connectionId, userId, organizationId, partnerRef: publicRef('cus', 8) })
      .onConflictDoNothing();
  }

  for (const key of scopes) {
    const def = await db.query.consentDefinitions.findFirst({ where: eq(t.consentDefinitions.key, key) });
    if (!def) continue;
    const version = await db.query.consentVersions.findFirst({
      where: eq(t.consentVersions.definitionId, def.id),
    });
    if (!version) continue;
    await db.insert(t.consentGrants).values({
      id: ulid(),
      userId,
      organizationId,
      consentVersionId: version.id,
      connectionId,
      purpose: 'Sample connection created by the seed',
    });
  }
  return connectionId;
}

export async function seedSampleData(roleIds: Map<RoleName, string>) {
  const consumer = await makeUser({
    email: 'meera@example.in',
    mobile: '+919800000001',
    displayName: 'Meera Kulkarni',
    roles: ['CONSUMER'],
    roleIds,
  });
  const secondConsumer = await makeUser({
    email: 'rahul@example.in',
    mobile: '+919800000002',
    displayName: 'Rahul Nair',
    roles: ['CONSUMER'],
    roleIds,
  });

  const hotel = await makeOrganization({
    slug: 'grand-sahyadri',
    name: 'Grand Sahyadri',
    kind: 'HOSPITALITY',
    connectorKind: 'HTNG Express',
    city: 'Pune',
  });
  const cinema = await makeOrganization({
    slug: 'phoenix-cinemas',
    name: 'Phoenix Cinemas',
    kind: 'ENTERTAINMENT',
    connectorKind: 'Ticketing REST',
    city: 'Pune',
  });
  const applicant = await makeOrganization({
    slug: 'konkan-shore',
    name: 'Konkan Shore Resort',
    kind: 'HOSPITALITY',
    connectorKind: 'OpenTravel v2',
    city: 'Alibaug',
    status: 'PENDING_REVIEW',
  });

  const owner = await makeUser({
    email: 'owner@grand-sahyadri.example',
    mobile: '+919800000010',
    displayName: 'Anita Rao',
    roles: ['CONSUMER'],
    roleIds,
  });
  const staff = await makeUser({
    email: 'desk@grand-sahyadri.example',
    mobile: '+919800000011',
    displayName: 'Vikram Shinde',
    roles: ['CONSUMER'],
    roleIds,
  });
  const rivalOwner = await makeUser({
    email: 'owner@phoenix-cinemas.example',
    mobile: '+919800000012',
    displayName: 'Farah Qureshi',
    roles: ['CONSUMER'],
    roleIds,
  });

  await addMember(hotel.id, owner.id, 'PARTNER_OWNER', roleIds);
  await addMember(hotel.id, staff.id, 'PARTNER_STAFF', roleIds);
  await addMember(cinema.id, rivalOwner.id, 'PARTNER_OWNER', roleIds);

  const admin = await makeUser({
    email: 'admin@onepass.in',
    mobile: '+919800000020',
    displayName: 'Platform Admin',
    platformStaff: true,
    roles: ['CONSUMER', 'PLATFORM_ADMIN'],
    roleIds,
  });
  const support = await makeUser({
    email: 'support@onepass.in',
    mobile: '+919800000021',
    displayName: 'Platform Support',
    platformStaff: true,
    roles: ['CONSUMER', 'PLATFORM_SUPPORT'],
    roleIds,
  });
  const security = await makeUser({
    email: 'security@onepass.in',
    mobile: '+919800000022',
    displayName: 'Security Admin',
    platformStaff: true,
    roles: ['CONSUMER', 'SECURITY_ADMIN'],
    roleIds,
  });

  await connect(consumer.id, hotel.id, ['identity.basic', 'contact.basic', 'history.transactions']);
  await connect(secondConsumer.id, cinema.id, ['identity.basic']);

  // A couple of settled transactions so dashboards are not empty on first run.
  const connection = await db.query.partnerConnections.findFirst({
    where: eq(t.partnerConnections.userId, consumer.id),
  });
  for (const [amount, description] of [
    [840000, 'Deluxe room · 2 nights'],
    [124000, 'Restaurant · dinner'],
  ] as const) {
    await db
      .insert(t.transactions)
      .values({
        id: ulid(),
        userId: consumer.id,
        organizationId: hotel.id,
        connectionId: connection?.id ?? null,
        amountMinor: amount,
        currency: 'INR',
        status: 'CAPTURED',
        description,
        provider: 'SANDBOX',
        providerOrderId: `sandbox_seed_${ulid()}`,
        capturedAt: new Date(),
      })
      .onConflictDoNothing();
  }

  await db.insert(t.notifications).values({
    id: ulid(),
    userId: consumer.id,
    category: 'SECURITY',
    title: 'New sign-in',
    body: `Your ${BRAND.name} was used to sign in on a new device.`,
    linkPath: '/profile',
  });

  return { consumer, secondConsumer, owner, staff, rivalOwner, admin, support, security, hotel, cinema, applicant };
}


export { SAMPLE_PASSWORD };
