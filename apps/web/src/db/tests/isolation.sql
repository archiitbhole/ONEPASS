-- Negative tests for the database-enforced isolation in ../isolation.sql.
--
-- Every query below is one a malicious or buggy service might issue. The
-- expected result is an error or an empty set — a row coming back is the
-- failure. Run after applying isolation.sql:
--
--   psql -U postgres -d onepass -f src/db/tests/isolation.sql
--
-- `SET LOCAL` needs a transaction block, which is also how the real connection
-- wrapper sets it: one tenant per request, discarded at commit, so a pooled
-- connection can never carry one request's tenant into the next.
-- NOTE ON THESE IDS
--
-- Every identifier below is a valid ULID: Crockford base32, which excludes I, L,
-- O and U because each is too easily confused with 1, 1, 0 and V. The fixtures
-- originally spelled words with those letters — 01USERAAAA…, 01ORGAAAA… — which
-- read nicely and were ids the application considers malformed. That mattered
-- outside this file: these rows land in a development database, the platform
-- console lists them in its user directory, and opening one answered 404
-- because `isUlid()` rejected the id before any query ran. A fixture should use
-- values the system could actually produce, or it is testing a shape production
-- never sees.

\set ON_ERROR_STOP off
\pset tuples_only on
\pset format unaligned


-- ── fixtures ──────────────────────────────────────────────────────
-- Self-contained, so this file can be run against any database that has the
-- schema and the grants. Ids are fixed and prefixed so they are obviously test
-- data and can be removed with one DELETE per table.
INSERT INTO organizations (id, slug, name, kind, status, created_at, updated_at)
VALUES ('010RGAAAAAAAAAAAAAAAAAAAAA','iso-hotel-a','Hotel A','HOSPITALITY','ACTIVE',now(),now()),
       ('010RGBBBBBBBBBBBBBBBBBBBBB','iso-cinema-b','Cinema B','ENTERTAINMENT','ACTIVE',now(),now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO users (id, status, email, mobile, is_platform_staff, session_generation, created_at, updated_at)
VALUES ('01VSERAAAAAAAAAAAAAAAAAAAA','ACTIVE','iso-a@example.test','+919000000901',false,0,now(),now()),
       ('01VSERBBBBBBBBBBBBBBBBBBBB','ACTIVE','iso-b@example.test','+919000000902',false,0,now(),now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_profiles (id, user_id, display_name, locale, created_at, updated_at)
VALUES ('01PR0FAAAAAAAAAAAAAAAAAAAA','01VSERAAAAAAAAAAAAAAAAAAAA','Ananya Rao','en-IN',now(),now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO venues (id, organization_id, public_ref, name, kind, tags, is_active, created_at, updated_at)
VALUES ('01VENVEAAAAAAAAAAAAAAAAAAA','010RGAAAAAAAAAAAAAAAAAAAAA','iso_ven_a','Hotel A Pune','HOTEL','[]',true,now(),now()),
       ('01VENVEBBBBBBBBBBBBBBBBBBB','010RGBBBBBBBBBBBBBBBBBBBBB','iso_ven_b','Cinema B Pune','CINEMA','[]',true,now(),now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO bookings (id, public_ref, user_id, organization_id, status, quantity,
                      list_price_minor, amount_minor, saved_minor, points_spent, currency, created_at, updated_at)
VALUES ('01B00KAAAAAAAAAAAAAAAAAAAA','iso_bkg_a','01VSERAAAAAAAAAAAAAAAAAAAA','010RGAAAAAAAAAAAAAAAAAAAAA','CONFIRMED',1,500000,400000,100000,0,'INR',now(),now()),
       ('01B00KBBBBBBBBBBBBBBBBBBBB','iso_bkg_b','01VSERBBBBBBBBBBBBBBBBBBBB','010RGBBBBBBBBBBBBBBBBBBBBB','CONFIRMED',2,30000,14900,15100,0,'INR',now(),now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO partner_connections (id, user_id, organization_id, state, partner_ref, connected_at, created_at)
VALUES ('01C0NNAAAAAAAAAAAAAAAAAAAA','01VSERAAAAAAAAAAAAAAAAAAAA','010RGAAAAAAAAAAAAAAAAAAAAA','ACTIVE','iso_cust_a1',now(),now())
ON CONFLICT (id) DO NOTHING;

\echo ''
\echo '── 1-3. Grant-level separation: the business role cannot read these at all ──'
SET ROLE onepass_business;
SELECT 'LEAK users'           FROM users LIMIT 1;
SELECT 'LEAK sessions'        FROM sessions LIMIT 1;
SELECT 'LEAK payment_methods' FROM payment_methods LIMIT 1;
SELECT 'LEAK devices'         FROM devices LIMIT 1;
SELECT 'LEAK user_roles'      FROM user_roles LIMIT 1;
SELECT 'LEAK audit_logs'      FROM audit_logs LIMIT 1;
UPDATE audit_logs SET action = 'tampered';
DELETE FROM audit_logs;
RESET ROLE;
\echo ''
\echo '── 4. Hotel A sees only its own bookings ─────────────────────────'
BEGIN;
  SET LOCAL ROLE onepass_business;
  SET LOCAL app.organization_id = '010RGAAAAAAAAAAAAAAAAAAAAA';
  SELECT 'visible: ' || public_ref FROM bookings ORDER BY public_ref;
COMMIT;

\echo ''
\echo '── 5. Hotel A requests Cinema B''s booking by primary key ─────────'
\echo '   (id manipulation — the attack the brief names explicitly)'
BEGIN;
  SET LOCAL ROLE onepass_business;
  SET LOCAL app.organization_id = '010RGAAAAAAAAAAAAAAAAAAAAA';
  SELECT 'LEAK: ' || public_ref FROM bookings WHERE id = '01B00KBBBBBBBBBBBBBBBBBBBB';
  SELECT 'rows returned: ' || count(*)::text FROM bookings WHERE id = '01B00KBBBBBBBBBBBBBBBBBBBB';
COMMIT;

\echo ''
\echo '── 6. Cinema B sees only its own ─────────────────────────────────'
BEGIN;
  SET LOCAL ROLE onepass_business;
  SET LOCAL app.organization_id = '010RGBBBBBBBBBBBBBBBBBBBBB';
  SELECT 'visible: ' || public_ref FROM bookings ORDER BY public_ref;
COMMIT;

\echo ''
\echo '── 7. Hotel A tries to UPDATE Cinema B''s booking ─────────────────'
BEGIN;
  SET LOCAL ROLE onepass_business;
  SET LOCAL app.organization_id = '010RGAAAAAAAAAAAAAAAAAAAAA';
  UPDATE bookings SET status = 'CANCELLED' WHERE id = '01B00KBBBBBBBBBBBBBBBBBBBB';
  SELECT 'rows updated by cross-tenant UPDATE: ' || count(*)::text
    FROM bookings WHERE id = '01B00KBBBBBBBBBBBBBBBBBBBB' AND status = 'CANCELLED';
COMMIT;

\echo ''
\echo '── 8. Hotel A tries to plant a venue inside Cinema B ─────────────'
BEGIN;
  SET LOCAL ROLE onepass_business;
  SET LOCAL app.organization_id = '010RGAAAAAAAAAAAAAAAAAAAAA';
  INSERT INTO venues (id, organization_id, public_ref, name, kind, tags, is_active, created_at, updated_at)
  VALUES ('01VENVEEV17AAAAAAAAAAAAAAA','010RGBBBBBBBBBBBBBBBBBBBBB','ven_evil','Planted','CINEMA','[]',true,now(),now());
ROLLBACK;

\echo ''
\echo '── 9. A forged tenant id sees nothing ────────────────────────────'
BEGIN;
  SET LOCAL ROLE onepass_business;
  SET LOCAL app.organization_id = '010RGD0ESN0TEX1ST000000000';
  SELECT 'LEAK: ' || public_ref FROM bookings;
  SELECT 'rows for a forged tenant: ' || count(*)::text FROM bookings;
COMMIT;

\echo ''
\echo '── 10. Consented disclosure: withheld, then granted ──────────────'
-- Start from no consent. Test 11 below restores the grant so the file is
-- idempotent, which means a second run would otherwise begin already consented
-- and the "before" line would prove nothing.
DELETE FROM consent_grants WHERE id = '01CG1DENT1TY00000000000000';
BEGIN;
  SET LOCAL ROLE onepass_business;
  SELECT 'before consent → name=' || coalesce(display_name,'<withheld>')
      || ' email=' || coalesce(email,'<withheld>')
    FROM business_customer_view WHERE organization_id = '010RGAAAAAAAAAAAAAAAAAAAAA';
COMMIT;

-- Grant identity.basic only. Contact must stay withheld: one consent does not
-- imply the other, which is the property this test exists to prove.
INSERT INTO consent_definitions (id, key, label, description, fields, sensitive, created_at)
VALUES ('01CD1DENT1TY00000000000000','identity.basic','Your name','Name shown to the partner',ARRAY['display_name'],false,now())
ON CONFLICT (key) DO NOTHING;
INSERT INTO consent_versions (id, definition_id, version, body_text, effective_from, created_at)
SELECT '01CV1DENT1TY00000000000000', id, 1, 'v1', now(), now() FROM consent_definitions WHERE key='identity.basic'
ON CONFLICT (id) DO NOTHING;
INSERT INTO consent_grants (id, user_id, organization_id, consent_version_id, connection_id, state, purpose, granted_at, created_at)
VALUES ('01CG1DENT1TY00000000000000','01VSERAAAAAAAAAAAAAAAAAAAA','010RGAAAAAAAAAAAAAAAAAAAAA','01CV1DENT1TY00000000000000','01C0NNAAAAAAAAAAAAAAAAAAAA','GRANTED','Booking',now(),now())
ON CONFLICT (id) DO NOTHING;

BEGIN;
  SET LOCAL ROLE onepass_business;
  SELECT 'after identity consent → name=' || coalesce(display_name,'<withheld>')
      || ' email=' || coalesce(email,'<withheld>')
    FROM business_customer_view WHERE organization_id = '010RGAAAAAAAAAAAAAAAAAAAAA';
COMMIT;

\echo ''
\echo '── 11. A revoked consent withdraws the name again ────────────────'
UPDATE consent_grants SET state='REVOKED', revoked_at=now() WHERE id='01CG1DENT1TY00000000000000';
BEGIN;
  SET LOCAL ROLE onepass_business;
  SELECT 'after revocation → name=' || coalesce(display_name,'<withheld>')
    FROM business_customer_view WHERE organization_id = '010RGAAAAAAAAAAAAAAAAAAAAA';
COMMIT;
UPDATE consent_grants SET state='GRANTED', revoked_at=NULL WHERE id='01CG1DENT1TY00000000000000';
