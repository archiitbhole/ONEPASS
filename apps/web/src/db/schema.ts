/**
 * ONEPASS — production schema.
 *
 * The model in one paragraph: a User is a person. An Organization is a partner
 * business, and it is the tenant boundary. OrganizationMember joins the two and
 * carries the role, which is where every partner-side authorization decision
 * starts. A consumer never belongs to an organization; a partner employee always
 * does. Consent is the hinge between them — a partner may read a consumer's data
 * only through a live PartnerConnection whose consent grants cover the scope being
 * requested.
 *
 * Identifiers are ULIDs (26-char Crockford base32) minted in application code:
 * sortable by creation time, so they cluster well in B-tree indexes on the
 * high-volume tables and make cursor pagination a simple `id > cursor`.
 *
 * The tables that grow without bound — audit_logs, auth_events, security_events,
 * notifications, transactions, pass_presentations — all carry a createdAt index and
 * are covered by the partitioning script in docs/scaling.md. Adopting it needs no
 * change here.
 */
import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  char,
  customType,
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

/**
 * `bytea`, for hashes and sealed ciphertext. Never for anything human-readable.
 *
 * The `fromDriver` case matters more than it looks. A direct select returns bytea
 * as a Buffer, but Drizzle's relational queries aggregate joined rows into JSON in
 * SQL, and Postgres renders bytea inside JSON as a `\x…` hex string. Without this
 * conversion a joined column arrives as text, and everything downstream that
 * expects bytes — every signature and hash comparison — fails without saying why.
 */
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

// ─────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────

export const userStatus = pgEnum('user_status', [
  'PENDING_VERIFICATION',
  'ACTIVE',
  'SUSPENDED',
  'DEACTIVATED',
  'DELETION_PENDING',
]);

export const organizationStatus = pgEnum('organization_status', [
  'PENDING_REVIEW',
  'ACTIVE',
  'SUSPENDED',
  'REJECTED',
]);

export const organizationKind = pgEnum('organization_kind', [
  'HOSPITALITY',
  'RETAIL',
  'ENTERTAINMENT',
  'FINANCIAL_SERVICES',
  // Added with the commerce layer. A company that sponsors employee benefits and
  // a city tourism body are tenants in exactly the same sense as a hotel: they
  // hold members, roles and connections. Giving them their own table would have
  // duplicated the whole membership and consent apparatus.
  'CORPORATE',
  'TRAVEL',
  'CIVIC',
  // A university is a tenant with members, roles, venues and credentials — every
  // one of which already exists. Campus mode is this enum value plus screens.
  'CAMPUS',
  'OTHER',
]);

export const membershipStatus = pgEnum('membership_status', ['INVITED', 'ACTIVE', 'SUSPENDED']);

export const roleName = pgEnum('role_name', [
  'CONSUMER',
  'PARTNER_OWNER',
  'PARTNER_ADMIN',
  'PARTNER_STAFF',
  'PLATFORM_ADMIN',
  'PLATFORM_SUPPORT',
  'SECURITY_ADMIN',
]);

export const roleScopeKind = pgEnum('role_scope_kind', ['PLATFORM', 'ORGANIZATION']);

export const authEventKind = pgEnum('auth_event_kind', [
  'LOGIN_SUCCESS',
  'LOGIN_FAILED',
  'LOGOUT',
  'SESSION_REVOKED',
  'PASSWORD_CHANGED',
  'OTP_SENT',
  'OTP_VERIFIED',
  'OTP_FAILED',
  'MFA_CHALLENGED',
  'ACCOUNT_LOCKED',
  'RECOVERY_STARTED',
  'RECOVERY_COMPLETED',
  // Re-entering the password on a live session to unlock a sensitive action.
  'STEP_UP_SUCCEEDED',
  'STEP_UP_FAILED',
]);

export const verificationPurpose = pgEnum('verification_purpose', [
  'EMAIL_VERIFY',
  'MOBILE_VERIFY',
  'LOGIN_OTP',
  'PASSWORD_RESET',
  'STEP_UP',
]);

export const verificationChannel = pgEnum('verification_channel', ['EMAIL', 'SMS']);
export const consentState = pgEnum('consent_state', ['GRANTED', 'REVOKED', 'EXPIRED']);
export const connectionState = pgEnum('connection_state', ['ACTIVE', 'SUSPENDED', 'DISCONNECTED']);
export const passStatus = pgEnum('pass_status', ['ACTIVE', 'SUSPENDED', 'REVOKED']);

export const presentationResult = pgEnum('presentation_result', [
  'ACCEPTED',
  'REJECTED_MALFORMED',
  'REJECTED_SIGNATURE',
  'REJECTED_EXPIRED',
  'REJECTED_REPLAY',
  'REJECTED_NO_CONNECTION',
  'REJECTED_PASS_INACTIVE',
]);

export const paymentProvider = pgEnum('payment_provider', ['RAZORPAY', 'STRIPE', 'SANDBOX']);
export const paymentMethodKind = pgEnum('payment_method_kind', ['CARD', 'UPI', 'NETBANKING', 'WALLET']);

export const transactionStatus = pgEnum('transaction_status', [
  'INITIATED',
  'AUTHORIZED',
  'CAPTURED',
  'FAILED',
  'REFUNDED',
  'CANCELLED',
]);

export const notificationChannel = pgEnum('notification_channel', ['IN_APP', 'EMAIL', 'PUSH', 'SMS']);
/**
 * Who may see a piece of data, from most to least exposed. Applied to events
 * first (`outbox_events.privacy_classification`), because an event is the thing
 * that leaves the transaction and reaches webhooks, streams and — later —
 * analytics. `SECRET` exists so the vocabulary is complete; nothing classified
 * as secret may ever be written to an event, and `emitEvent` refuses it.
 */
export const dataClassification = pgEnum('data_classification', [
  'PUBLIC',
  'PARTNER_VISIBLE',
  'USER_PRIVATE',
  'SENSITIVE',
  'CREDENTIAL_PRIVATE',
  'SECURITY_SENSITIVE',
  'SECRET',
]);
export const notificationCategory = pgEnum('notification_category', [
  'SECURITY',
  'TRANSACTION',
  'CONSENT',
  'PARTNER',
  'ACCOUNT',
  'PRODUCT',
]);

export const securitySeverity = pgEnum('security_severity', ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
export const ticketStatus = pgEnum('ticket_status', ['OPEN', 'PENDING', 'RESOLVED', 'CLOSED']);
export const deletionStage = pgEnum('deletion_stage', [
  'REQUESTED',
  'GRACE_PERIOD',
  'ANONYMISING',
  'COMPLETED',
  'CANCELLED',
]);

// ─────────────────────────────────────────────────────────────
// Identity
// ─────────────────────────────────────────────────────────────

export const users = pgTable(
  'users',
  {
    id: id(),
    status: userStatus('status').default('PENDING_VERIFICATION').notNull(),

    email: varchar('email', { length: 320 }),
    emailVerifiedAt: ts('email_verified_at'),
    /** E.164. Separate from email so either can be the primary factor. */
    mobile: varchar('mobile', { length: 20 }),
    mobileVerifiedAt: ts('mobile_verified_at'),

    /** Argon2id encoded hash. Never a raw password, ever. */
    passwordHash: text('password_hash'),
    /**
     * Raised on password change and on "log out everywhere". Every session records
     * the generation it was minted under, so bumping this invalidates all of them
     * in one write rather than a fan-out delete.
     */
    sessionGeneration: integer('session_generation').default(0).notNull(),

    isPlatformStaff: boolean('is_platform_staff').default(false).notNull(),
    mfaEnabled: boolean('mfa_enabled').default(false).notNull(),
    mfaSecretCipher: bytea('mfa_secret_cipher'),

    lastLoginAt: ts('last_login_at'),
    failedLogins: integer('failed_logins').default(0).notNull(),
    lockedUntil: ts('locked_until'),

    createdAt: now(),
    updatedAt: ts('updated_at').defaultNow().notNull(),
    deletedAt: ts('deleted_at'),
  },
  (t) => [
    uniqueIndex('users_email_key').on(t.email),
    uniqueIndex('users_mobile_key').on(t.mobile),
    index('users_status_created_idx').on(t.status, t.createdAt),
    index('users_created_idx').on(t.createdAt),
  ],
);

export const userProfiles = pgTable(
  'user_profiles',
  {
    id: id(),
    userId: fk('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    displayName: varchar('display_name', { length: 120 }).notNull(),
    givenName: varchar('given_name', { length: 80 }),
    familyName: varchar('family_name', { length: 80 }),
    city: varchar('city', { length: 80 }),
    region: varchar('region', { length: 80 }),
    countryCode: char('country_code', { length: 2 }),
    locale: varchar('locale', { length: 12 }).default('en-IN').notNull(),
    avatarUrl: text('avatar_url'),
    /** Only the year: enough for age-gating, minimal enough not to be an identifier. */
    birthYear: integer('birth_year'),

    createdAt: now(),
    updatedAt: ts('updated_at').defaultNow().notNull(),
  },
  (t) => [uniqueIndex('user_profiles_user_key').on(t.userId)],
);

// ─────────────────────────────────────────────────────────────
// Tenancy
// ─────────────────────────────────────────────────────────────

export const organizations = pgTable(
  'organizations',
  {
    id: id(),
    slug: varchar('slug', { length: 64 }).notNull(),
    name: varchar('name', { length: 160 }).notNull(),
    kind: organizationKind('kind').notNull(),
    status: organizationStatus('status').default('PENDING_REVIEW').notNull(),

    legalName: varchar('legal_name', { length: 200 }),
    registrationNo: varchar('registration_no', { length: 64 }),
    city: varchar('city', { length: 80 }),
    countryCode: char('country_code', { length: 2 }),
    supportEmail: varchar('support_email', { length: 320 }),
    websiteUrl: text('website_url'),

    /** HTNG Express, OpenTravel, a POS bridge. The integration layer owns the semantics. */
    connectorKind: varchar('connector_kind', { length: 64 }),

    /**
     * Ed25519 issuing key. The public half is published on the organization's
     * profile so a third party can verify a credential's signature without
     * trusting ONEPASS; the private half is sealed with the platform key and
     * never leaves the server.
     */
    signingPublicKey: bytea('signing_public_key'),
    signingPrivateCipher: bytea('signing_private_cipher'),
    signingKeyId: varchar('signing_key_id', { length: 16 }).default('v1').notNull(),

    reviewedAt: ts('reviewed_at'),
    reviewedByUserId: fk('reviewed_by_user_id'),
    reviewNote: text('review_note'),

    createdAt: now(),
    updatedAt: ts('updated_at').defaultNow().notNull(),
    deletedAt: ts('deleted_at'),
  },
  (t) => [
    uniqueIndex('organizations_slug_key').on(t.slug),
    index('organizations_status_created_idx').on(t.status, t.createdAt),
  ],
);

export const organizationMembers = pgTable(
  'organization_members',
  {
    id: id(),
    organizationId: fk('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: fk('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    status: membershipStatus('status').default('INVITED').notNull(),
    invitedByUserId: fk('invited_by_user_id'),
    joinedAt: ts('joined_at'),

    createdAt: now(),
    updatedAt: ts('updated_at').defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('org_members_org_user_key').on(t.organizationId, t.userId),
    index('org_members_user_idx').on(t.userId),
  ],
);

// ─────────────────────────────────────────────────────────────
// RBAC
// ─────────────────────────────────────────────────────────────

export const roles = pgTable(
  'roles',
  {
    id: id(),
    name: roleName('name').notNull(),
    scope: roleScopeKind('scope').notNull(),
    description: text('description').notNull(),
  },
  (t) => [uniqueIndex('roles_name_key').on(t.name)],
);

export const permissions = pgTable(
  'permissions',
  {
    id: id(),
    /** `resource:action`, e.g. `partner.customer:read`, `platform.partner:approve`. */
    key: varchar('key', { length: 80 }).notNull(),
    description: text('description').notNull(),
  },
  (t) => [uniqueIndex('permissions_key_key').on(t.key)],
);

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: fk('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionId: fk('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
  },
  (t) => [uniqueIndex('role_permissions_pk').on(t.roleId, t.permissionId)],
);

/**
 * A role held by a user, optionally inside one organization. A platform role has a
 * null membership; a partner role must have one, and that is what binds an
 * authorization decision to a tenant.
 */
export const userRoles = pgTable(
  'user_roles',
  {
    id: id(),
    userId: fk('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: fk('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    membershipId: fk('membership_id').references(() => organizationMembers.id, { onDelete: 'cascade' }),

    grantedByUserId: fk('granted_by_user_id'),
    createdAt: now(),
  },
  (t) => [
    uniqueIndex('user_roles_unique').on(t.userId, t.roleId, t.membershipId),
    index('user_roles_membership_idx').on(t.membershipId),
  ],
);

// ─────────────────────────────────────────────────────────────
// Sessions, devices, authentication
// ─────────────────────────────────────────────────────────────

export const devices = pgTable(
  'devices',
  {
    id: id(),
    userId: fk('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /**
     * A random value the client stores and returns. Not a fingerprint — ONEPASS
     * does not try to recognise devices covertly.
     */
    handle: varchar('handle', { length: 64 }).notNull(),
    label: varchar('label', { length: 120 }),
    platform: varchar('platform', { length: 40 }),
    lastSeenAt: ts('last_seen_at').defaultNow().notNull(),
    trusted: boolean('trusted').default(false).notNull(),
    revokedAt: ts('revoked_at'),

    createdAt: now(),
  },
  (t) => [
    uniqueIndex('devices_handle_key').on(t.handle),
    index('devices_user_lastseen_idx').on(t.userId, t.lastSeenAt),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    userId: fk('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /**
     * SHA-256 of the opaque session token. The token itself lives only in the
     * client's httpOnly cookie, so a database leak yields no usable sessions.
     */
    tokenHash: bytea('token_hash').notNull(),
    generation: integer('generation').default(0).notNull(),

    deviceId: fk('device_id').references(() => devices.id, { onDelete: 'set null' }),

    ipHash: bytea('ip_hash'),
    userAgent: text('user_agent'),
    /** Set by a recent re-authentication; sensitive actions require it to be fresh. */
    elevatedAt: ts('elevated_at'),

    createdAt: now(),
    lastActiveAt: ts('last_active_at').defaultNow().notNull(),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
    revokedReason: varchar('revoked_reason', { length: 80 }),
  },
  (t) => [
    uniqueIndex('sessions_token_hash_key').on(t.tokenHash),
    index('sessions_user_active_idx').on(t.userId, t.revokedAt, t.expiresAt),
    index('sessions_expires_idx').on(t.expiresAt),
  ],
);

export const authEvents = pgTable(
  'auth_events',
  {
    id: id(),
    userId: fk('user_id').references(() => users.id, { onDelete: 'set null' }),
    kind: authEventKind('kind').notNull(),

    /**
     * Never the credential. The identifier is hashed so support can correlate
     * attempts against an account that may not even exist.
     */
    identifierHash: bytea('identifier_hash'),
    ipHash: bytea('ip_hash'),
    userAgent: text('user_agent'),
    requestId: varchar('request_id', { length: 40 }),
    detail: jsonb('detail'),

    createdAt: now(),
  },
  (t) => [
    index('auth_events_user_created_idx').on(t.userId, t.createdAt),
    index('auth_events_kind_created_idx').on(t.kind, t.createdAt),
    index('auth_events_created_idx').on(t.createdAt),
  ],
);

export const verificationRequests = pgTable(
  'verification_requests',
  {
    id: id(),
    userId: fk('user_id').references(() => users.id, { onDelete: 'cascade' }),

    purpose: verificationPurpose('purpose').notNull(),
    channel: verificationChannel('channel').notNull(),
    /** The destination, normalised. Needed to deliver; not a secret. */
    destination: varchar('destination', { length: 320 }).notNull(),
    /** Argon2id hash of the one-time code. The code is never stored or logged. */
    codeHash: text('code_hash').notNull(),
    attempts: integer('attempts').default(0).notNull(),
    maxAttempts: integer('max_attempts').default(5).notNull(),

    consumedAt: ts('consumed_at'),
    expiresAt: ts('expires_at').notNull(),
    createdAt: now(),
    ipHash: bytea('ip_hash'),
  },
  (t) => [
    index('verifications_user_purpose_idx').on(t.userId, t.purpose, t.createdAt),
    index('verifications_dest_purpose_idx').on(t.destination, t.purpose, t.createdAt),
    index('verifications_expires_idx').on(t.expiresAt),
  ],
);

// ─────────────────────────────────────────────────────────────
// Consent
// ─────────────────────────────────────────────────────────────

/**
 * A named piece of data a partner can ask for. Definitions are referenced by grants
 * through a version, so re-wording a scope creates a new version and the record of
 * what somebody actually agreed to stays intact.
 */
export const consentDefinitions = pgTable(
  'consent_definitions',
  {
    id: id(),
    key: varchar('key', { length: 64 }).notNull(),
    label: varchar('label', { length: 120 }).notNull(),
    description: text('description').notNull(),
    /**
     * The user fields this scope unlocks. Partner reads are projected through this
     * list rather than trusting a caller-supplied field set.
     */
    fields: text('fields').array().notNull(),
    sensitive: boolean('sensitive').default(false).notNull(),
    createdAt: now(),
  },
  (t) => [uniqueIndex('consent_definitions_key_key').on(t.key)],
);

export const consentVersions = pgTable(
  'consent_versions',
  {
    id: id(),
    definitionId: fk('definition_id')
      .notNull()
      .references(() => consentDefinitions.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    bodyText: text('body_text').notNull(),
    effectiveFrom: ts('effective_from').defaultNow().notNull(),
    retiredAt: ts('retired_at'),
    createdAt: now(),
  },
  (t) => [uniqueIndex('consent_versions_def_version_key').on(t.definitionId, t.version)],
);

export const partnerConnections = pgTable(
  'partner_connections',
  {
    id: id(),
    userId: fk('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    organizationId: fk('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),

    state: connectionState('state').default('ACTIVE').notNull(),
    /** Opaque, stable, partner-facing handle. A partner never learns the user id. */
    partnerRef: varchar('partner_ref', { length: 40 }).notNull(),
    connectedAt: ts('connected_at').defaultNow().notNull(),
    disconnectedAt: ts('disconnected_at'),
    lastUsedAt: ts('last_used_at'),
    createdAt: now(),
  },
  (t) => [
    uniqueIndex('connections_user_org_key').on(t.userId, t.organizationId),
    uniqueIndex('connections_org_ref_key').on(t.organizationId, t.partnerRef),
    index('connections_org_state_idx').on(t.organizationId, t.state),
  ],
);

/**
 * One consumer granting one scope to one partner. Append-only in spirit: revoking
 * sets state and revokedAt, and never deletes the history.
 */
export const consentGrants = pgTable(
  'consent_grants',
  {
    id: id(),
    userId: fk('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    organizationId: fk('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    consentVersionId: fk('consent_version_id')
      .notNull()
      .references(() => consentVersions.id),
    connectionId: fk('connection_id').references(() => partnerConnections.id, { onDelete: 'set null' }),

    state: consentState('state').default('GRANTED').notNull(),
    purpose: varchar('purpose', { length: 200 }).notNull(),
    grantedAt: ts('granted_at').defaultNow().notNull(),
    expiresAt: ts('expires_at'),
    revokedAt: ts('revoked_at'),
    revokedByUserId: fk('revoked_by_user_id'),
    createdAt: now(),
  },
  (t) => [
    index('consent_grants_user_state_idx').on(t.userId, t.state),
    index('consent_grants_org_state_idx').on(t.organizationId, t.state),
    index('consent_grants_connection_idx').on(t.connectionId),
  ],
);

// ─────────────────────────────────────────────────────────────
// The pass
// ─────────────────────────────────────────────────────────────

export const passes = pgTable(
  'passes',
  {
    id: id(),
    userId: fk('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** What a merchant terminal sees and what the QR carries. Not the user id. */
    passRef: varchar('pass_ref', { length: 40 }).notNull(),
    status: passStatus('status').default('ACTIVE').notNull(),

    /**
     * AES-256-GCM ciphertext of the base32 TOTP secret, sealed with a key held in
     * the environment. The plaintext is never returned by any API.
     */
    secretCipher: bytea('secret_cipher').notNull(),
    secretKeyId: varchar('secret_key_id', { length: 16 }).default('v1').notNull(),

    issuedAt: ts('issued_at').defaultNow().notNull(),
    revokedAt: ts('revoked_at'),
    createdAt: now(),
    updatedAt: ts('updated_at').defaultNow().notNull(),
  },
  (t) => [uniqueIndex('passes_ref_key').on(t.passRef), index('passes_user_status_idx').on(t.userId, t.status)],
);

/**
 * Every presentation of a pass at a counter, accepted or not. Doubles as the replay
 * ledger: the unique index on (pass, counter, organization) is what makes a code
 * single-use per counter — enforced by Postgres, not by application luck.
 */
export const passPresentations = pgTable(
  'pass_presentations',
  {
    id: id(),
    passId: fk('pass_id')
      .notNull()
      .references(() => passes.id, { onDelete: 'cascade' }),
    organizationId: fk('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    connectionId: fk('connection_id').references(() => partnerConnections.id, { onDelete: 'set null' }),

    /**
     * Which door, when the terminal knows.
     *
     * A presentation used to record only the organization, which is enough to
     * admit someone and not enough to say where they were: a chain with branches
     * in two cities produced scans that could have happened at either. That
     * ambiguity is exactly what a travel detector needs resolved, so a terminal
     * that knows its venue now says so.
     *
     * Nullable, because a terminal is not obliged to know — an organization-wide
     * API key legitimately has no venue — and untyped as an FK only because
     * `venues` is defined in commerce.ts, which imports this module.
     */
    venueId: fk('venue_id'),

    counter: integer('counter').notNull(),
    result: presentationResult('result').notNull(),
    presentedByUserId: fk('presented_by_user_id'),
    requestId: varchar('request_id', { length: 40 }),
    ipHash: bytea('ip_hash'),
    createdAt: now(),
  },
  (t) => [
    uniqueIndex('presentations_replay_key').on(t.passId, t.counter, t.organizationId),
    index('presentations_org_created_idx').on(t.organizationId, t.createdAt),
    index('presentations_pass_created_idx').on(t.passId, t.createdAt),
  ],
);

// ─────────────────────────────────────────────────────────────
// Payments — provider tokens and safe metadata only
// ─────────────────────────────────────────────────────────────

/**
 * Deliberately thin. ONEPASS keeps what a provider hands back and nothing that
 * could authorise a payment on its own: no PAN, no CVV, no UPI PIN, no bank
 * credential. If this table leaked it would be an embarrassment, not an incident.
 */
export const paymentMethods = pgTable(
  'payment_methods',
  {
    id: id(),
    userId: fk('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    provider: paymentProvider('provider').notNull(),
    providerToken: varchar('provider_token', { length: 200 }).notNull(),
    kind: paymentMethodKind('kind').notNull(),
    /** `•••• 4242`, `meera@okhdfc` — display only. */
    maskedLabel: varchar('masked_label', { length: 64 }).notNull(),
    network: varchar('network', { length: 32 }),
    expiryMonth: integer('expiry_month'),
    expiryYear: integer('expiry_year'),
    isDefault: boolean('is_default').default(false).notNull(),

    createdAt: now(),
    removedAt: ts('removed_at'),
  },
  (t) => [
    uniqueIndex('payment_methods_provider_token_key').on(t.provider, t.providerToken),
    index('payment_methods_user_idx').on(t.userId, t.removedAt),
  ],
);

export const transactions = pgTable(
  'transactions',
  {
    id: id(),
    userId: fk('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    organizationId: fk('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    connectionId: fk('connection_id').references(() => partnerConnections.id, { onDelete: 'set null' }),
    paymentMethodId: fk('payment_method_id').references(() => paymentMethods.id, { onDelete: 'set null' }),

    /** Minor units. Money is never a float. */
    amountMinor: integer('amount_minor').notNull(),
    currency: char('currency', { length: 3 }).default('INR').notNull(),
    status: transactionStatus('status').default('INITIATED').notNull(),
    description: varchar('description', { length: 200 }),

    provider: paymentProvider('provider').notNull(),
    providerOrderId: varchar('provider_order_id', { length: 120 }),
    providerPaymentId: varchar('provider_payment_id', { length: 120 }),
    failureCode: varchar('failure_code', { length: 64 }),

    /** Supplied by the caller; makes retries safe. */
    idempotencyKey: varchar('idempotency_key', { length: 120 }),
    /** Optimistic concurrency — API and webhook both move this row. */
    version: integer('version').default(0).notNull(),

    createdAt: now(),
    updatedAt: ts('updated_at').defaultNow().notNull(),
    capturedAt: ts('captured_at'),
  },
  (t) => [
    uniqueIndex('transactions_org_idem_key').on(t.organizationId, t.idempotencyKey),
    uniqueIndex('transactions_provider_order_key').on(t.provider, t.providerOrderId),
    index('transactions_user_created_idx').on(t.userId, t.createdAt),
    index('transactions_org_created_idx').on(t.organizationId, t.createdAt),
    index('transactions_status_created_idx').on(t.status, t.createdAt),
  ],
);

// ─────────────────────────────────────────────────────────────
// Notifications
// ─────────────────────────────────────────────────────────────

export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    userId: fk('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    category: notificationCategory('category').notNull(),
    title: varchar('title', { length: 160 }).notNull(),
    body: text('body').notNull(),
    linkPath: varchar('link_path', { length: 200 }),
    data: jsonb('data'),

    readAt: ts('read_at'),
    createdAt: now(),
  },
  (t) => [
    index('notifications_user_read_idx').on(t.userId, t.readAt, t.createdAt),
    index('notifications_created_idx').on(t.createdAt),
  ],
);

export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    id: id(),
    userId: fk('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    category: notificationCategory('category').notNull(),
    channel: notificationChannel('channel').notNull(),
    enabled: boolean('enabled').default(true).notNull(),
    updatedAt: ts('updated_at').defaultNow().notNull(),
  },
  (t) => [uniqueIndex('notification_prefs_key').on(t.userId, t.category, t.channel)],
);

// ─────────────────────────────────────────────────────────────
// Audit, security, integrations
// ─────────────────────────────────────────────────────────────

/**
 * Append-only by convention and by permission: nothing in the application issues an
 * update or delete against this table, and no role holds a permission that would
 * allow it. Never contains a credential, a one-time code, or a payment secret.
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id(),
    actorUserId: fk('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    actorRole: varchar('actor_role', { length: 40 }),
    organizationId: fk('organization_id').references(() => organizations.id, { onDelete: 'set null' }),

    action: varchar('action', { length: 80 }).notNull(),
    targetType: varchar('target_type', { length: 60 }).notNull(),
    targetId: varchar('target_id', { length: 64 }),
    result: varchar('result', { length: 24 }).notNull(),
    requestId: varchar('request_id', { length: 40 }),
    ipHash: bytea('ip_hash'),
    userAgent: text('user_agent'),
    metadata: jsonb('metadata'),

    createdAt: now(),
  },
  (t) => [
    index('audit_org_created_idx').on(t.organizationId, t.createdAt),
    index('audit_actor_created_idx').on(t.actorUserId, t.createdAt),
    index('audit_action_created_idx').on(t.action, t.createdAt),
    index('audit_target_idx').on(t.targetType, t.targetId),
    index('audit_created_idx').on(t.createdAt),
  ],
);

export const securityEvents = pgTable(
  'security_events',
  {
    id: id(),
    userId: fk('user_id').references(() => users.id, { onDelete: 'set null' }),
    organizationId: fk('organization_id').references(() => organizations.id, { onDelete: 'set null' }),

    kind: varchar('kind', { length: 64 }).notNull(),
    severity: securitySeverity('severity').default('INFO').notNull(),
    summary: varchar('summary', { length: 240 }).notNull(),
    metadata: jsonb('metadata'),
    requestId: varchar('request_id', { length: 40 }),
    ipHash: bytea('ip_hash'),

    acknowledgedAt: ts('acknowledged_at'),
    acknowledgedByUserId: fk('acknowledged_by_user_id'),
    createdAt: now(),
  },
  (t) => [
    index('security_severity_created_idx').on(t.severity, t.createdAt),
    index('security_user_created_idx').on(t.userId, t.createdAt),
    index('security_org_created_idx').on(t.organizationId, t.createdAt),
    index('security_created_idx').on(t.createdAt),
  ],
);

export const apiKeys = pgTable(
  'api_keys',
  {
    id: id(),
    organizationId: fk('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),

    label: varchar('label', { length: 80 }).notNull(),
    /** The public, greppable half — safe to show in dashboards and logs. */
    prefix: varchar('prefix', { length: 24 }).notNull(),
    /** SHA-256 of the full key. Shown once at creation and never again. */
    keyHash: bytea('key_hash').notNull(),
    scopes: text('scopes').array().notNull(),

    createdByUserId: fk('created_by_user_id'),
    lastUsedAt: ts('last_used_at'),
    expiresAt: ts('expires_at'),
    revokedAt: ts('revoked_at'),
    createdAt: now(),
  },
  (t) => [
    uniqueIndex('api_keys_prefix_key').on(t.prefix),
    uniqueIndex('api_keys_hash_key').on(t.keyHash),
    index('api_keys_org_idx').on(t.organizationId, t.revokedAt),
  ],
);

export const webhooks = pgTable(
  'webhooks',
  {
    id: id(),
    organizationId: fk('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),

    url: text('url').notNull(),
    events: text('events').array().notNull(),
    /** Shared secret for the outgoing signature, sealed like the pass secret. */
    secretCipher: bytea('secret_cipher').notNull(),
    active: boolean('active').default(true).notNull(),

    createdAt: now(),
    updatedAt: ts('updated_at').defaultNow().notNull(),
  },
  (t) => [index('webhooks_org_active_idx').on(t.organizationId, t.active)],
);

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: id(),
    webhookId: fk('webhook_id')
      .notNull()
      .references(() => webhooks.id, { onDelete: 'cascade' }),

    eventType: varchar('event_type', { length: 64 }).notNull(),
    payload: jsonb('payload').notNull(),
    attempt: integer('attempt').default(0).notNull(),
    responseCode: integer('response_code'),
    error: text('error'),
    deliveredAt: ts('delivered_at'),
    nextRetryAt: ts('next_retry_at'),
    createdAt: now(),
  },
  (t) => [
    index('webhook_deliveries_hook_idx').on(t.webhookId, t.createdAt),
    index('webhook_deliveries_retry_idx').on(t.nextRetryAt),
  ],
);

/**
 * Transactional outbox. A domain write and the event describing it commit together;
 * a publisher drains this table, so an event can never announce a change that was
 * rolled back.
 */
export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: id(),
    type: varchar('type', { length: 64 }).notNull(),
    aggregateType: varchar('aggregate_type', { length: 40 }).notNull(),
    aggregateId: varchar('aggregate_id', { length: 40 }).notNull(),
    payload: jsonb('payload').notNull(),
    /** Fan-out target for the realtime layer: `user:<id>` or `org:<id>`. */
    channel: varchar('channel', { length: 64 }).notNull(),

    /*
     * The canonical envelope (D-004). Every column is nullable or defaulted so
     * rows written before it existed remain valid — they simply say they do not
     * know, which is true.
     */
    /** Version of this event type's payload shape. Bumped when a payload changes. */
    schemaVersion: smallint('schema_version').default(1).notNull(),
    /** The request that caused it (`x-request-id`). Null outside a request. */
    correlationId: varchar('correlation_id', { length: 40 }),
    /** The event this one is a reaction to, when there is one. */
    causationId: char('causation_id', { length: 26 }),
    /** `user:<id>`, `api_key:<id>`, `system:<name>` — never a name or an email. */
    actor: varchar('actor', { length: 64 }),
    /** The organization the event belongs to, when it belongs to one. */
    tenantId: char('tenant_id', { length: 26 }),
    privacyClassification: dataClassification('privacy_classification').default('USER_PRIVATE').notNull(),

    publishedAt: ts('published_at'),
    attempts: integer('attempts').default(0).notNull(),
    lastError: text('last_error'),
    createdAt: now(),
  },
  (t) => [
    index('outbox_pending_idx').on(t.publishedAt, t.createdAt),
    index('outbox_channel_idx').on(t.channel, t.createdAt),
    // "Everything this request did" and "everything this event caused" are the
    // two questions the envelope exists to answer.
    index('outbox_correlation_idx').on(t.correlationId),
    index('outbox_causation_idx').on(t.causationId),
  ],
);

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id: id(),
    scope: varchar('scope', { length: 64 }).notNull(),
    key: varchar('key', { length: 120 }).notNull(),

    requestHash: bytea('request_hash').notNull(),
    responseCode: integer('response_code'),
    responseBody: jsonb('response_body'),
    completedAt: ts('completed_at'),
    createdAt: now(),
    expiresAt: ts('expires_at').notNull(),
  },
  (t) => [
    uniqueIndex('idempotency_scope_key').on(t.scope, t.key),
    index('idempotency_expires_idx').on(t.expiresAt),
  ],
);

export const supportTickets = pgTable(
  'support_tickets',
  {
    id: id(),
    userId: fk('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    subject: varchar('subject', { length: 160 }).notNull(),
    body: text('body').notNull(),
    status: ticketStatus('status').default('OPEN').notNull(),
    assignedToUserId: fk('assigned_to_user_id'),
    resolvedAt: ts('resolved_at'),
    createdAt: now(),
    updatedAt: ts('updated_at').defaultNow().notNull(),
  },
  (t) => [
    index('tickets_status_created_idx').on(t.status, t.createdAt),
    index('tickets_user_created_idx').on(t.userId, t.createdAt),
  ],
);

/**
 * Deletion is a workflow, not a DELETE. Financial and audit records carry their own
 * retention obligations, so the account is deactivated, personal fields are
 * anonymised, and what survives is documented in docs/privacy.md.
 */
export const accountDeletionRequests = pgTable(
  'account_deletion_requests',
  {
    id: id(),
    userId: fk('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    stage: deletionStage('stage').default('REQUESTED').notNull(),
    reason: varchar('reason', { length: 240 }),
    requestedAt: ts('requested_at').defaultNow().notNull(),
    executeAfter: ts('execute_after').notNull(),
    completedAt: ts('completed_at'),
    cancelledAt: ts('cancelled_at'),
    note: text('note'),
    createdAt: now(),
  },
  (t) => [index('deletion_stage_execute_idx').on(t.stage, t.executeAfter)],
);

// ─────────────────────────────────────────────────────────────
// Relations
// ─────────────────────────────────────────────────────────────

export const usersRelations = relations(users, ({ one, many }) => ({
  profile: one(userProfiles, { fields: [users.id], references: [userProfiles.userId] }),
  roles: many(userRoles),
  memberships: many(organizationMembers),
  sessions: many(sessions),
  devices: many(devices),
  passes: many(passes),
  connections: many(partnerConnections),
  consentGrants: many(consentGrants),
  transactions: many(transactions),
  notifications: many(notifications),
}));

export const organizationsRelations = relations(organizations, ({ many }) => ({
  members: many(organizationMembers),
  connections: many(partnerConnections),
  transactions: many(transactions),
  apiKeys: many(apiKeys),
  webhooks: many(webhooks),
}));

export const organizationMembersRelations = relations(organizationMembers, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [organizationMembers.organizationId],
    references: [organizations.id],
  }),
  user: one(users, { fields: [organizationMembers.userId], references: [users.id] }),
  roles: many(userRoles),
}));

export const userRolesRelations = relations(userRoles, ({ one }) => ({
  user: one(users, { fields: [userRoles.userId], references: [users.id] }),
  role: one(roles, { fields: [userRoles.roleId], references: [roles.id] }),
  membership: one(organizationMembers, {
    fields: [userRoles.membershipId],
    references: [organizationMembers.id],
  }),
}));

export const rolesRelations = relations(roles, ({ many }) => ({ permissions: many(rolePermissions) }));

export const rolePermissionsRelations = relations(rolePermissions, ({ one }) => ({
  role: one(roles, { fields: [rolePermissions.roleId], references: [roles.id] }),
  permission: one(permissions, { fields: [rolePermissions.permissionId], references: [permissions.id] }),
}));

export const partnerConnectionsRelations = relations(partnerConnections, ({ one, many }) => ({
  user: one(users, { fields: [partnerConnections.userId], references: [users.id] }),
  organization: one(organizations, {
    fields: [partnerConnections.organizationId],
    references: [organizations.id],
  }),
  grants: many(consentGrants),
}));

export const consentGrantsRelations = relations(consentGrants, ({ one }) => ({
  user: one(users, { fields: [consentGrants.userId], references: [users.id] }),
  organization: one(organizations, {
    fields: [consentGrants.organizationId],
    references: [organizations.id],
  }),
  version: one(consentVersions, {
    fields: [consentGrants.consentVersionId],
    references: [consentVersions.id],
  }),
  connection: one(partnerConnections, {
    fields: [consentGrants.connectionId],
    references: [partnerConnections.id],
  }),
}));

export const consentVersionsRelations = relations(consentVersions, ({ one }) => ({
  definition: one(consentDefinitions, {
    fields: [consentVersions.definitionId],
    references: [consentDefinitions.id],
  }),
}));

export const passesRelations = relations(passes, ({ one, many }) => ({
  user: one(users, { fields: [passes.userId], references: [users.id] }),
  presentations: many(passPresentations),
}));

export const transactionsRelations = relations(transactions, ({ one }) => ({
  user: one(users, { fields: [transactions.userId], references: [users.id] }),
  organization: one(organizations, { fields: [transactions.organizationId], references: [organizations.id] }),
  paymentMethod: one(paymentMethods, {
    fields: [transactions.paymentMethodId],
    references: [paymentMethods.id],
  }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
  device: one(devices, { fields: [sessions.deviceId], references: [devices.id] }),
}));

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Organization = typeof organizations.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type PartnerConnection = typeof partnerConnections.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type Pass = typeof passes.$inferSelect;

/** Convenience for the seed and for tests that need every table in dependency order. */
export const ALL_TABLES = {
  users,
  userProfiles,
  organizations,
  organizationMembers,
  roles,
  permissions,
  rolePermissions,
  userRoles,
  devices,
  sessions,
  authEvents,
  verificationRequests,
  consentDefinitions,
  consentVersions,
  partnerConnections,
  consentGrants,
  passes,
  passPresentations,
  paymentMethods,
  transactions,
  notifications,
  notificationPreferences,
  auditLogs,
  securityEvents,
  apiKeys,
  webhooks,
  webhookDeliveries,
  outboxEvents,
  idempotencyKeys,
  supportTickets,
  accountDeletionRequests,
} as const;

export const _sql = sql;

// ─────────────────────────────────────────────────────────────
// Credentials — the object that outlives the relationship
//
// A student leaves; the degree stays verifiable. That asymmetry is why a
// credential is not just a row on a membership: it must remain checkable by a
// stranger years later, after the holder has gone and possibly after ONEPASS
// itself is no longer in the loop.
//
// Which is why the issuer signs. Each organization holds an Ed25519 keypair
// whose public half is published on its profile; a credential carries a hash of
// its claims plus a signature over that hash. A verifier who trusts the college
// but not us can check the signature themselves. It is also the honest answer to
// "what happens to our degrees if you go out of business".
// ─────────────────────────────────────────────────────────────

export const credentialStatus = pgEnum('credential_status', [
  'DRAFT',
  'ACTIVE',
  'SUSPENDED',
  'REVOKED',
  'EXPIRED',
]);

export const credentialCategory = pgEnum('credential_category', [
  'IDENTITY',      // student ID, employee ID
  'QUALIFICATION', // degree, certificate, course completion
  'MEMBERSHIP',    // society resident, club member
  'AUTHORIZATION', // hostel access, lab access, parking
  'EVENT',         // event pass, session access
  'EXPERIENCE',    // internship, volunteering
]);

export const revocationReason = pgEnum('revocation_reason', [
  'ISSUER_ERROR',
  'HOLDER_REQUEST',
  'RELATIONSHIP_ENDED',
  'SUPERSEDED',
  'FRAUD',
  'EXPIRED_EARLY',
]);

export const verificationOutcome = pgEnum('verification_outcome', [
  'VERIFIED',
  'PENDING',
  'EXPIRED',
  'REVOKED',
  'INVALID',
  'NOT_FOUND',
]);

/** A template an organization issues against. Defines the shape of the claims. */
export const credentialTypes = pgTable(
  'credential_types',
  {
    id: id(),
    organizationId: fk('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),

    key: varchar('key', { length: 64 }).notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    category: credentialCategory('category').notNull(),
    description: text('description'),

    /** Claim keys this type may assert. Issuance rejects anything not listed. */
    claimSchema: text('claim_schema').array().notNull(),
    /** Null means it does not expire on its own — a degree, not a gate pass. */
    defaultValidityDays: integer('default_validity_days'),
    /** Whether a scan may show the holder's name, or only that the claim holds. */
    discloseHolderName: boolean('disclose_holder_name').default(true).notNull(),

    active: boolean('active').default(true).notNull(),
    createdAt: now(),
    updatedAt: ts('updated_at').defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('credential_types_org_key').on(t.organizationId, t.key),
    index('credential_types_org_idx').on(t.organizationId, t.active),
  ],
);

export const credentials = pgTable(
  'credentials',
  {
    id: id(),
    /** Printed on the certificate and carried by the QR. Random, not sequential. */
    publicRef: varchar('public_ref', { length: 40 }).notNull(),

    credentialTypeId: fk('credential_type_id')
      .notNull()
      .references(() => credentialTypes.id),
    /** The issuer. Denormalised from the type so a verification is one join fewer. */
    organizationId: fk('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** Null while a credential is issued to someone who has not claimed it yet. */
    holderUserId: fk('holder_user_id').references(() => users.id, { onDelete: 'set null' }),
    /** How the issuer knows the holder — roll number, employee code. Never public. */
    holderExternalRef: varchar('holder_external_ref', { length: 120 }),
    holderNameSnapshot: varchar('holder_name_snapshot', { length: 160 }).notNull(),

    status: credentialStatus('status').default('ACTIVE').notNull(),
    claims: jsonb('claims').notNull(),

    /** SHA-256 over the canonical claim set. Tamper-evident on its own. */
    claimsHash: bytea('claims_hash').notNull(),
    /** Ed25519 over claimsHash, by the issuing organization's key. */
    issuerSignature: bytea('issuer_signature').notNull(),
    issuerKeyId: varchar('issuer_key_id', { length: 16 }).default('v1').notNull(),

    issuedAt: ts('issued_at').defaultNow().notNull(),
    validFrom: ts('valid_from').defaultNow().notNull(),
    validUntil: ts('valid_until'),

    issuedByUserId: fk('issued_by_user_id'),
    /** Set when this credential replaces an earlier one — a reissued lost ID. */
    supersedesId: fk('supersedes_id'),
    /** Cheap counter for the issuer dashboard; the ledger is in `verifications`. */
    verificationCount: integer('verification_count').default(0).notNull(),

    createdAt: now(),
    updatedAt: ts('updated_at').defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('credentials_public_ref_key').on(t.publicRef),
    index('credentials_org_created_idx').on(t.organizationId, t.createdAt),
    index('credentials_holder_idx').on(t.holderUserId, t.status),
    index('credentials_type_idx').on(t.credentialTypeId, t.status),
    index('credentials_expiry_idx').on(t.validUntil),
  ],
);

/**
 * Revocation is an append, never an update of the credential's history. The
 * credential row's status changes too, but this table is the record of who
 * revoked what and why — and it is what an auditor reads.
 */
export const credentialRevocations = pgTable(
  'credential_revocations',
  {
    id: id(),
    credentialId: fk('credential_id')
      .notNull()
      .references(() => credentials.id, { onDelete: 'cascade' }),
    organizationId: fk('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),

    reason: revocationReason('reason').notNull(),
    note: varchar('note', { length: 240 }),
    revokedByUserId: fk('revoked_by_user_id'),
    revokedAt: ts('revoked_at').defaultNow().notNull(),
    createdAt: now(),
  },
  (t) => [
    uniqueIndex('credential_revocations_credential_key').on(t.credentialId),
    index('credential_revocations_org_idx').on(t.organizationId, t.revokedAt),
  ],
);

export const disclosureRecipient = pgEnum('disclosure_recipient', ['ORGANIZATION_STAFF', 'API_KEY', 'PUBLIC']);
export const disclosureChannel = pgEnum('disclosure_channel', ['PARTNER_CONSOLE', 'CREDENTIAL_VERIFICATION']);
export const disclosureBasis = pgEnum('disclosure_basis', ['CONSENT', 'CREDENTIAL_PRESENTATION']);

/**
 * Every time information about a person reached a third party (D-006).
 *
 * Written by the code that discloses, in the request that discloses — never
 * reconstructed afterwards from logs, because a history assembled after the
 * fact is only as complete as whoever remembered to log. The person reads it at
 * `/disclosures`; the organization never reads another organization's rows.
 *
 * **Field names, never values.** A receipt that said "Grand Sahyadri saw
 * meera@example.in" would itself be a copy of the address in one more table.
 * It says "Grand Sahyadri saw your email address", which is what the person
 * needs to know and nothing an attacker could use.
 *
 * Repeated identical disclosures within an hour (same recipient, same person,
 * same fields) are recorded once: a receptionist refreshing a list forty times
 * is one disclosure, and forty rows would bury the one that matters.
 */
export const disclosureReceipts = pgTable(
  'disclosure_receipts',
  {
    id: id(),
    publicRef: varchar('public_ref', { length: 32 }).notNull(),
    /** Whose information it was. */
    userId: fk('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** The organization that received it; null for an anonymous public check. */
    organizationId: fk('organization_id').references(() => organizations.id, { onDelete: 'set null' }),
    recipientKind: disclosureRecipient('recipient_kind').notNull(),
    /** The staff member, for the organization's own audit. Not shown to the holder. */
    recipientUserId: fk('recipient_user_id').references(() => users.id, { onDelete: 'set null' }),
    apiKeyId: fk('api_key_id').references(() => apiKeys.id, { onDelete: 'set null' }),
    channel: disclosureChannel('channel').notNull(),
    basis: disclosureBasis('basis').notNull(),
    /** What was looked at: `credential` + its reference, or `connection` + the partner's handle. */
    subjectType: varchar('subject_type', { length: 24 }).notNull(),
    subjectRef: varchar('subject_ref', { length: 64 }).notNull(),
    /** Names of the fields that were returned. Never their values. */
    fields: varchar('fields', { length: 48 }).array().notNull(),
    /** The consent grants that permitted it, when consent was the basis. */
    consentGrantIds: char('consent_grant_ids', { length: 26 }).array(),
    purpose: varchar('purpose', { length: 240 }),
    requestId: varchar('request_id', { length: 40 }),
    createdAt: now(),
  },
  (t) => [
    uniqueIndex('disclosure_receipts_public_ref_key').on(t.publicRef),
    index('disclosure_receipts_user_idx').on(t.userId, t.createdAt),
    index('disclosure_receipts_org_idx').on(t.organizationId, t.createdAt),
  ],
);

export const consentAction = pgEnum('consent_receipt_action', ['GRANTED', 'REVOKED']);

/**
 * A consent receipt: the terms as they stood when somebody agreed, or withdrew.
 *
 * `consent_grants` already records that an agreement happened and when it ended,
 * so this is not a second copy of that. It exists because of what the grant row
 * does *not* hold: the words. A grant points at a `consent_version`, which
 * freezes the body text — but the label, the description, the field list and the
 * sensitivity flag live on `consent_definitions`, which is mutable. Edit a
 * definition and every existing grant silently starts describing itself
 * differently, including on the screen where the person reads back what they
 * agreed to.
 *
 * That is the whole point of a receipt. A record of an agreement that the other
 * party can revise afterwards is not evidence of anything. So every field below
 * is a snapshot taken at the moment of the act, including the organization's own
 * name, because a business can rename itself too.
 *
 * `public_ref` exists so a person can quote this. An internal ULID is not
 * something to put in an email to a shop or a regulator.
 *
 * Receipts are written for GRANTED and REVOKED only. A grant that lapses by
 * reaching `expires_at` has no moment to write one at — nothing sweeps the
 * table, and the consent *view* filters on the timestamp rather than the state
 * column, which is the right place for the gate to be and the wrong place to
 * hang an event off. Saying so here is better than a receipt that claims an
 * expiry was observed when nothing observed it.
 */
export const consentReceipts = pgTable(
  'consent_receipts',
  {
    id: id(),
    publicRef: varchar('public_ref', { length: 32 }).notNull(),
    userId: fk('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    organizationId: fk('organization_id').references(() => organizations.id, { onDelete: 'set null' }),
    /** The grant this is about. Kept as a join, never as the source of the words. */
    consentGrantId: fk('consent_grant_id').references(() => consentGrants.id, { onDelete: 'set null' }),
    consentVersionId: fk('consent_version_id').references(() => consentVersions.id, { onDelete: 'set null' }),

    action: consentAction('action').notNull(),

    // ── the snapshot: what this said at the time ──
    organizationName: varchar('organization_name', { length: 160 }),
    scopeKey: varchar('scope_key', { length: 64 }).notNull(),
    scopeLabel: varchar('scope_label', { length: 120 }).notNull(),
    scopeDescription: text('scope_description').notNull(),
    /** The fields this scope said it covered. Names only; never values. */
    scopeFields: varchar('scope_fields', { length: 48 }).array().notNull(),
    scopeSensitive: boolean('scope_sensitive').default(false).notNull(),
    /** The version number and the exact body text that was in force. */
    versionNumber: integer('version_number'),
    bodyText: text('body_text'),
    purpose: varchar('purpose', { length: 240 }),

    requestId: varchar('request_id', { length: 40 }),
    createdAt: now(),
  },
  (t) => [
    uniqueIndex('consent_receipts_public_ref_key').on(t.publicRef),
    index('consent_receipts_user_idx').on(t.userId, t.createdAt),
    index('consent_receipts_grant_idx').on(t.consentGrantId),
  ],
);

export const issuerKeyStatus = pgEnum('issuer_key_status', ['ACTIVE', 'RETIRED', 'REVOKED']);

/**
 * An issuer's signing keys, every version of them (D-005).
 *
 * Before this table an organization had one key, on its own row, and
 * verification checked every credential against "the organization's key". That
 * made rotation impossible: replacing the key would have failed every
 * credential the organization had ever issued, so the key could never be
 * changed — not on a schedule, not after a laptop was stolen.
 *
 * Now a credential names the key that signed it (`credentials.issuer_key_id`)
 * and verification resolves exactly that key:
 *
 *  · **ACTIVE** — signs new credentials. Exactly one per organization, which a
 *    partial unique index enforces rather than a code path remembering to.
 *  · **RETIRED** — rotated out. Still verifies what it signed; never signs
 *    again, so its private half is destroyed at retirement.
 *  · **REVOKED** — declared compromised. Everything it signed fails
 *    verification, with the date, because an attacker holding it could have
 *    signed anything.
 *
 * Public halves are published at `/api/v1/issuers/<slug>/keys` so a verifier
 * can check a signature without trusting ONEPASS at all.
 */
export const issuerKeys = pgTable(
  'issuer_keys',
  {
    id: id(),
    organizationId: fk('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** `v1`, `v2`, … — what a credential records and a verifier looks up. */
    keyId: varchar('key_id', { length: 16 }).notNull(),
    algorithm: varchar('algorithm', { length: 16 }).default('Ed25519').notNull(),
    /** SPKI DER. Public by design. */
    publicKey: bytea('public_key').notNull(),
    /** Sealed PKCS#8. Null once the key is retired or revoked — it never signs again. */
    privateKeyCipher: bytea('private_key_cipher'),
    status: issuerKeyStatus('status').default('ACTIVE').notNull(),

    activatedAt: ts('activated_at').defaultNow().notNull(),
    retiredAt: ts('retired_at'),
    revokedAt: ts('revoked_at'),
    revokedReason: varchar('revoked_reason', { length: 240 }),
    changedByUserId: fk('changed_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: now(),
  },
  (t) => [
    uniqueIndex('issuer_keys_org_key_key').on(t.organizationId, t.keyId),
    uniqueIndex('issuer_keys_one_active_key')
      .on(t.organizationId)
      .where(sql`${t.status} = 'ACTIVE'`),
  ],
);

/**
 * Every verification attempt, including the failures. Two purposes: the issuer
 * dashboard's "is anyone actually checking these?" number, which is the metric
 * that predicts renewal — and the risk layer, which reads repeated failures
 * against one credential or from one source as a signal worth surfacing.
 */
export const verifications = pgTable(
  'verifications',
  {
    id: id(),
    /** Null when the reference did not resolve — still worth recording. */
    credentialId: fk('credential_id').references(() => credentials.id, { onDelete: 'set null' }),
    presentedRef: varchar('presented_ref', { length: 64 }).notNull(),
    outcome: verificationOutcome('outcome').notNull(),

    /** Who asked. Null for an anonymous public check. */
    verifierOrganizationId: fk('verifier_organization_id').references(() => organizations.id, {
      onDelete: 'set null',
    }),
    verifierUserId: fk('verifier_user_id').references(() => users.id, { onDelete: 'set null' }),
    apiKeyId: fk('api_key_id').references(() => apiKeys.id, { onDelete: 'set null' }),

    channel: varchar('channel', { length: 24 }).notNull(),
    requestId: varchar('request_id', { length: 40 }),
    ipHash: bytea('ip_hash'),
    createdAt: now(),
  },
  (t) => [
    index('verifications_credential_idx').on(t.credentialId, t.createdAt),
    index('verifications_outcome_idx').on(t.outcome, t.createdAt),
    index('verifications_verifier_idx').on(t.verifierOrganizationId, t.createdAt),
    index('verifications_created_idx').on(t.createdAt),
  ],
);

export const credentialTypesRelations = relations(credentialTypes, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [credentialTypes.organizationId],
    references: [organizations.id],
  }),
  credentials: many(credentials),
}));

export const credentialsRelations = relations(credentials, ({ one, many }) => ({
  type: one(credentialTypes, {
    fields: [credentials.credentialTypeId],
    references: [credentialTypes.id],
  }),
  organization: one(organizations, {
    fields: [credentials.organizationId],
    references: [organizations.id],
  }),
  holder: one(users, { fields: [credentials.holderUserId], references: [users.id] }),
  revocation: one(credentialRevocations, {
    fields: [credentials.id],
    references: [credentialRevocations.credentialId],
  }),
  verifications: many(verifications),
}));

export type Credential = typeof credentials.$inferSelect;
export type CredentialType = typeof credentialTypes.$inferSelect;
export type Verification = typeof verifications.$inferSelect;

// ─────────────────────────────────────────────────────────────
// Commerce layer.
//
// Defined in ./commerce.ts and re-exported here so `import * as schema` in the
// client picks up every table and relation in one object — Drizzle's relational
// query builder needs a single namespace, and splitting the file is a
// readability decision, not a structural one.
// ─────────────────────────────────────────────────────────────
export * from './commerce';

// The seven tables the duplication audit authorised — split commerce, gifting,
// itinerary collaborators, indoor maps and parking memory. See ./extensions.ts
// for why each one could not be a column on something that already existed.
export * from './extensions';

// Travel, and the price observations AirIndex is computed from. The same
// duplication rule applies: flights pay through `transactions`, earn through
// `reward_ledger`, receipt through `receipts`, and plan through `itineraries`.
// See ./travel.ts for what that left, and why each remaining table had to exist.
export * from './travel';
export * from './products';

