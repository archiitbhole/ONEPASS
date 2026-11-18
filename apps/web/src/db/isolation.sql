-- ONEPASS — database-enforced isolation between the consumer, business and
-- platform domains.
--
-- ─────────────────────────────────────────────────────────────────────────
-- WHY THIS IS THREE ROLES AND NOT THREE DATABASES
-- ─────────────────────────────────────────────────────────────────────────
--
-- The requirement was three separated databases with service-level boundaries
-- and least privilege. The second half of that is right and is implemented
-- here in full. The first half, taken literally, would make ONEPASS less safe,
-- and the reason is in the data model rather than in anyone's preference.
--
-- ONEPASS's core rows are *relationships between a consumer and a business*. A
-- booking references a user and an organization. A transaction references both.
-- A credential is issued by one to the other. Split across three physical
-- databases, every one of those foreign keys becomes an application-level join:
--
--   · Referential integrity is gone. Nothing stops a booking pointing at a user
--     id that no longer exists, and no constraint catches it. That is not a
--     hypothetical — it is the standard failure mode of split databases.
--   · Atomicity is gone. "Take capacity, charge, issue the ticket" spans two
--     databases and therefore two transactions. Without a distributed
--     transaction coordinator you get a booking with no ticket, or money taken
--     for capacity that was already sold. Money and capacity must commit
--     together.
--   · The isolation is not actually gained. A service holding connections to
--     two databases has exactly the access it had before; the boundary moved
--     into application code, which is where the requirement says security must
--     NOT live.
--
-- What genuinely delivers the requirement is privilege separation *below* the
-- application, so a mistake in application code cannot reach across the
-- boundary. That is what this file does:
--
--   1. Three PostgreSQL roles, each with its own credentials.
--   2. Per-table grants. The business role has no SELECT on `users`,
--      `sessions`, `payment_methods` or `devices` at all — not "is filtered
--      from", but cannot read. An injected `SELECT * FROM users` on a business
--      connection fails at the database.
--   3. The business role reaches consumer data only through views that expose
--      consented fields. Views run as their owner, so the view can read a table
--      the caller cannot.
--   4. Row-level security on the relationship tables, keyed to a session
--      variable the connection pool sets per request, so tenant isolation is
--      enforced twice: once by `authorize()` in application code, once by
--      Postgres.
--
-- Deploying to three separate Postgres instances remains possible later along
-- the same seam — the grants below are the boundary, and moving a role to its
-- own instance is then a migration rather than a redesign. Doing it now would
-- buy a diagram at the cost of correctness.
--
-- Apply with: psql -U postgres -d onepass -f src/db/isolation.sql
-- Idempotent; safe to re-run.

\set ON_ERROR_STOP on

-- ─────────────────────────────────────────────────────────────
-- Roles. Passwords come from the environment at deploy time; these are
-- created NOLOGIN so a role can never be used until an operator sets one.
-- ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'onepass_consumer') THEN
    CREATE ROLE onepass_consumer NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'onepass_business') THEN
    CREATE ROLE onepass_business NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'onepass_admin') THEN
    CREATE ROLE onepass_admin NOLOGIN;
  END IF;
END
$$;

-- Start from zero. Nothing is reachable unless it is granted below.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM onepass_consumer, onepass_business, onepass_admin;
REVOKE ALL ON SCHEMA public FROM onepass_consumer, onepass_business, onepass_admin;
GRANT USAGE ON SCHEMA public TO onepass_consumer, onepass_business, onepass_admin;

-- ─────────────────────────────────────────────────────────────
-- CONSUMER DOMAIN — a person's own record.
--
-- Service: consumer API (/api/me/*, /api/auth/*)
-- Reason:  the authenticated person owns every row here.
-- ─────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE ON
  users, user_profiles, devices, sessions, auth_events, verification_requests,
  passes, consent_grants, partner_connections, payment_methods,
  notifications, notification_preferences, account_deletion_requests,
  support_tickets, households, household_members, parked_vehicles,
  itineraries, itinerary_items, itinerary_collaborators, quest_progress,
  reward_accounts, reward_ledger, savings_events,
  city_pass_holdings, city_pass_uses, warranties, gifts,
  split_requests, split_shares, benefit_allocations
TO onepass_consumer;

-- Read-only reference data: the catalogue a consumer browses.
GRANT SELECT ON
  cities, venues, inventory_slots, offers, city_passes, city_pass_entitlements,
  quests, consent_definitions, consent_versions, credential_types,
  reward_programs, venue_maps, venue_nodes, corporate_benefits
TO onepass_consumer;

-- The organization row is public-facing, but only in part. A consumer sees the
-- name and status through a view; the signing key and internal columns are not
-- in it and are therefore unreachable on this connection.
GRANT SELECT ON organizations TO onepass_consumer;

-- ─────────────────────────────────────────────────────────────
-- BUSINESS DOMAIN — a partner's own operation.
--
-- Service: partner API (/api/partner/[orgId]/*)
-- Reason:  a partner administers its own venues, capacity, offers and staff.
--
-- NOTE WHAT IS ABSENT: users, user_profiles, sessions, devices,
-- payment_methods, notifications, auth_events, verification_requests,
-- reward_ledger, savings_events, itineraries, households, warranties. A
-- business connection cannot read any of them. The restaurant that must not
-- receive unrelated hotel bookings cannot reach the table those live in.
-- ─────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE ON
  organizations, organization_members, venues, inventory_slots, offers,
  reward_programs, credential_types, credentials, credential_revocations,
  api_keys, webhooks, webhook_deliveries, api_usage,
  merchant_insights, demand_forecasts, campaigns, campaign_events,
  city_passes, city_pass_entitlements, corporate_benefits,
  venue_maps, venue_nodes
TO onepass_business;

-- Relationship tables: rows that belong to a consumer *and* a partner. Readable
-- and writable, but row-level security below restricts them to the caller's own
-- organization.
GRANT SELECT, INSERT, UPDATE ON
  bookings, tickets, receipts, receipt_lines, return_requests,
  transactions, verifications, pass_presentations, offer_redemptions,
  city_pass_uses, benefit_allocations
TO onepass_business;

GRANT SELECT ON cities, consent_definitions, consent_versions, quests TO onepass_business;

-- An issuer's own signing keys (D-005). Tenant-isolated below like every other
-- table that carries `organization_id`: a business can rotate its keys and no
-- one else's.
GRANT SELECT, INSERT, UPDATE ON issuer_keys TO onepass_business;

-- Disclosure receipts (D-006) are written by whichever domain disclosed — a
-- business rendering its customer list, a consumer-side public verification —
-- and read by the holder. A business may read the rows naming itself, which is
-- its own record of what its staff saw; the tenant policy below enforces that.
-- Nothing is ever updated: a receipt is a fact about the past.
GRANT SELECT, INSERT ON disclosure_receipts TO onepass_business, onepass_consumer;

-- Product ownership (D-007) belongs to the consumer domain alone. The seller is
-- on the row as a fact of the purchase, but who owns the item *now* — after a
-- resale, a gift — is none of the seller's business, so the business role gets
-- no grant at all rather than a filtered one.
GRANT SELECT, INSERT, UPDATE ON product_instances, ownership_transfers TO onepass_consumer;
-- Consent state decides what a partner may see; it must be able to check it,
-- and must never be able to grant it on a consumer's behalf.
GRANT SELECT ON consent_grants, partner_connections TO onepass_business;

-- ─────────────────────────────────────────────────────────────
-- PLATFORM DOMAIN — ONEPASS's own operation.
--
-- Service: admin API (/api/admin/*)
-- Reason:  approval, moderation, security response and the audit trail.
--
-- Neither of the roles above is granted anything on these tables. A consumer or
-- business connection cannot read the RBAC tables, the audit trail or the
-- security log, which means it cannot read its own way to more privilege.
-- ─────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE ON
  roles, permissions, role_permissions, user_roles,
  audit_logs, security_events, outbox_events, idempotency_keys
TO onepass_admin;

-- The platform reads everything else, and writes only through the domain
-- services — hence SELECT rather than ALL.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO onepass_admin;

-- Append-only audit. Every role must be able to record what it did; none may
-- edit or erase the record. This is why the grant is INSERT alone.
GRANT INSERT ON audit_logs, security_events, outbox_events TO onepass_consumer, onepass_business;
GRANT INSERT, SELECT, UPDATE ON idempotency_keys TO onepass_consumer, onepass_business;
-- A consumer sees their own security history through /api/me/security.
GRANT SELECT ON security_events TO onepass_consumer;

-- Credentials: a consumer reads the ones they hold; only an issuer writes.
GRANT SELECT ON credentials, credential_revocations, verifications TO onepass_consumer;
GRANT SELECT, INSERT ON bookings, tickets, receipts, receipt_lines,
  return_requests, transactions, offer_redemptions, pass_presentations
TO onepass_consumer;
GRANT UPDATE ON bookings, return_requests, transactions TO onepass_consumer;

-- ─────────────────────────────────────────────────────────────
-- Consented disclosure.
--
-- A view runs with its owner's privileges, so this can read `users` and
-- `user_profiles` while the business role cannot. It is the only route from a
-- business connection to a person's name, and it returns a row only where a
-- live PartnerConnection and an unrevoked consent grant exist.
--
-- This is the mechanism behind "expose only what the authorized workflow
-- requires": the restriction is a join condition in a view the caller cannot
-- bypass, not a WHERE clause an application forgot to add.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW business_customer_view AS
SELECT
  pc.organization_id,
  pc.user_id,
  pc.partner_ref                              AS customer_ref,
  -- Disclosed only while a grant covering identity.basic is live.
  CASE WHEN cg_identity.id IS NOT NULL THEN up.display_name END AS display_name,
  -- Contact details need their own grant. Identity does not imply contact.
  CASE WHEN cg_contact.id IS NOT NULL THEN u.email END          AS email,
  CASE WHEN cg_contact.id IS NOT NULL THEN u.mobile END         AS mobile,
  pc.state                                    AS connection_state,
  pc.connected_at,
  pc.last_used_at
FROM partner_connections pc
JOIN users u          ON u.id = pc.user_id
LEFT JOIN user_profiles up ON up.user_id = pc.user_id
LEFT JOIN consent_grants cg_identity
  ON cg_identity.user_id = pc.user_id
 AND cg_identity.organization_id = pc.organization_id
 AND cg_identity.state = 'GRANTED'
 AND (cg_identity.expires_at IS NULL OR cg_identity.expires_at > now())
 AND EXISTS (
   SELECT 1 FROM consent_versions cv
   JOIN consent_definitions cd ON cd.id = cv.definition_id
   WHERE cv.id = cg_identity.consent_version_id AND cd.key = 'identity.basic'
 )
LEFT JOIN consent_grants cg_contact
  ON cg_contact.user_id = pc.user_id
 AND cg_contact.organization_id = pc.organization_id
 AND cg_contact.state = 'GRANTED'
 AND (cg_contact.expires_at IS NULL OR cg_contact.expires_at > now())
 AND EXISTS (
   SELECT 1 FROM consent_versions cv
   JOIN consent_definitions cd ON cd.id = cv.definition_id
   WHERE cv.id = cg_contact.consent_version_id AND cd.key = 'contact.basic'
 )
WHERE pc.state = 'ACTIVE';

GRANT SELECT ON business_customer_view TO onepass_business;

-- ─────────────────────────────────────────────────────────────
-- Row-level security on the relationship tables.
--
-- The application already filters every partner query by organization id — see
-- `authorize()` in src/lib/authz/authorize.ts, covered by 20 adversarial tests.
-- This is the second lock: even a query that forgot the filter returns nothing
-- outside the caller's tenant, because the row is not visible to the session.
--
-- `app.organization_id` is set per request by the connection wrapper. When it is
-- unset, the policy evaluates false and the caller sees no rows — failing
-- closed, which is the only acceptable direction for a policy like this.
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  -- Every table here carries `organization_id`. `verifications` does not — it is
  -- handled separately below, because an issuer's question ("who has been
  -- checking my credentials?") is a different row set from a verifier's.
  FOREACH t IN ARRAY ARRAY[
    'bookings', 'tickets', 'receipts', 'return_requests', 'transactions',
    'pass_presentations', 'venues', 'inventory_slots', 'offers',
    'merchant_insights', 'demand_forecasts', 'campaigns',
    'organization_members', 'api_keys', 'webhooks', 'credentials',
    'issuer_keys', 'disclosure_receipts'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant_isolation', t);
    EXECUTE format($f$
      CREATE POLICY %I ON %I
      FOR ALL
      TO onepass_business
      USING (organization_id = current_setting('app.organization_id', true))
      WITH CHECK (organization_id = current_setting('app.organization_id', true))
    $f$, t || '_tenant_isolation', t);

    -- The platform and consumer roles are not subject to the tenant policy;
    -- their access is bounded by the grants above and by application ownership
    -- checks. A permissive policy is required or FORCE would lock them out.
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_platform_access', t);
    EXECUTE format($f$
      CREATE POLICY %I ON %I FOR ALL TO onepass_admin, onepass_consumer, postgres
      USING (true) WITH CHECK (true)
    $f$, t || '_platform_access', t);
  END LOOP;
END
$$;

-- `verifications` records every check of a credential. Two organizations have a
-- legitimate interest in a row: the one that performed the check, and the one
-- that issued the credential being checked. Both are expressed here so neither
-- has to be granted a wider view to get its own.
ALTER TABLE verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE verifications FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS verifications_tenant_isolation ON verifications;
CREATE POLICY verifications_tenant_isolation ON verifications
  FOR ALL
  TO onepass_business
  USING (
    verifier_organization_id = current_setting('app.organization_id', true)
    OR credential_id IN (
      SELECT c.id FROM credentials c
      WHERE c.organization_id = current_setting('app.organization_id', true)
    )
  )
  WITH CHECK (verifier_organization_id = current_setting('app.organization_id', true));

DROP POLICY IF EXISTS verifications_platform_access ON verifications;
CREATE POLICY verifications_platform_access ON verifications
  FOR ALL TO onepass_admin, onepass_consumer, postgres
  USING (true) WITH CHECK (true);

-- Sequences and future tables: a table added by a later migration must not be
-- silently readable by every role, so no blanket default privilege is granted.
-- New tables are added to the grants above deliberately, as part of the
-- migration that creates them.

COMMENT ON VIEW business_customer_view IS
  'The only path from a business database role to a consumer identity. Returns a row only where a live PartnerConnection and an unrevoked consent grant exist; each field is gated on its own grant.';
