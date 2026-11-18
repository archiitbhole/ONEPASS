# Operating ONEPASS

Day-to-day procedures: the probes and what a failure of each one means, the
time-driven sweeps and the fact that nothing runs them, backup and restore,
responding to an account incident, and rotating the encryption key.

Everything below is a command you can run or a file you can read. Where
something is not set up, it says so instead of describing what a well-run
deployment would have.

Deployment-time concerns — environment variables, applying the schema, turning
on the three-role isolation, provider credentials — are in
`docs/deployment.md`.

---

## 1. Health and readiness

Three endpoints, and the difference between them matters operationally.

### `GET /api/health` — liveness

Public. Restart on this.

```
200 {"status":"ok","uptime":1284,"version":"a1b2c3d"}
```

`apps/web/src/app/api/health/route.ts` touches nothing: no database, no Redis,
no session lookup. The reason is in the file — a liveness probe that depends on
Postgres turns one slow query into a rolling restart of every otherwise healthy
instance, which is how a brief dependency wobble becomes a real outage. It also
says the minimum: no dependency versions, no runtime version, no host names. An
unauthenticated caller learning which library versions are deployed is free
reconnaissance.

`version` is `APP_VERSION`, truncated to 40 characters, or `dev` when unset.

**A failure means:** the Node process is not serving HTTP, or the environment
failed validation. `env.ts` throws on the first request that reads
configuration, and this route returns 500 with no detail — the *container log*
names the offending variables. Restarting fixes the first case and will loop
forever on the second, so read the log before assuming a restart will help.

This is the endpoint the container `HEALTHCHECK` probes.

### `GET /api/ready` — readiness

Public. Take out of the load-balancer pool on this; do **not** restart on it.

```
200 {"database":"up","redis":"up"}
503 {"database":"up","redis":"down"}
```

`apps/web/src/app/api/ready/route.ts` checks what a request actually needs:
`select 1` against Postgres, `PING` against Redis, both with a 1500 ms timeout —
a probe that can hang is not a probe, so a stuck check reads as down. The body is
a verdict and nothing else: no driver error, no host name, no connection string,
no timing.

`redis` can also be `not-configured`, which is only reachable outside
production (`env.ts` requires `REDIS_URL` in production) and does **not** hold
the instance out of rotation — running on Postgres alone is a supported local
setup.

**A failure means:** this instance cannot serve requests correctly right now,
but the process is fine. `database: down` is Postgres unreachable or slower than
1.5 s. `redis: down` means rate limits and realtime fan-out have lost their
shared state — the app degrades to per-instance behaviour, which is why the
instance is pulled rather than left serving.

**Point the load balancer here, not at `/api/health`.** They answer different
questions and confusing them is how a database blip becomes a restart storm.

### `GET /api/admin/health` and `/control/health` — the operator's view

Both require the `platform.health:read` permission. The console page carries a
little more than the API route: two extra outbox counters, and the isolation
card, which is the only place `isolationStatus()` is exposed.

Worth reading regularly:

* `outbox.unpublished` and `outbox.oldestUnpublishedAt` — an outbox that stops
  draining is silent, because every write still succeeds. Depth alone is
  ambiguous: a hundred rows a second old is a healthy burst; one row an hour old
  is a publisher that has stopped.

  **Know how the publisher starts.** `startOutboxPublisher()` in
  `apps/web/src/lib/realtime.ts` drains the outbox every 750 ms, claiming
  batches of 100 with `FOR UPDATE SKIP LOCKED` so several instances can drain
  concurrently without delivering an event twice. It is started at module scope
  of `apps/web/src/app/api/events/stream/route.ts` — and Next.js loads a route
  module lazily, on first request. An instance that has never served
  `/api/events/stream` has never started its publisher, and its interval is
  `unref()`d, so it will never hold the process open either. There is no
  standalone publisher worker in this repository; the file's own comment says
  that is what it should become at scale. If `oldestUnpublishedAt` is climbing,
  this is the first thing to check.

  **Outbound webhooks share that fate.** The same interval runs `deliverDue()`
  from `apps/web/src/lib/webhooks/dispatch.ts`, so an instance whose publisher
  never started is also an instance that never sends a partner their events. The
  symptom is different and more visible — deliveries sit in `webhook_deliveries`
  with `delivered_at` null and a `next_retry_at` in the past, and the partner
  console shows them as pending — but the cause is the same one. Whenever the
  publisher moves to a standalone worker, the delivery pass moves with it.

  **A draining outbox is not the same as a delivered event.** The publisher marks
  a row published once it has been handed to Redis; whether any instance is
  *listening* is a separate question, and one that used to fail silently. A
  process subscribes with a Redis pattern subscription, and a pattern
  subscription does not survive a reconnect — so a subscribe issued once, at the
  moment the first stream opened, was lost on the first connection blip and, if
  the socket was not yet up when it was issued, never took at all. The instance
  then ran normally in every observable way: writes committed, the outbox
  drained to zero, streams stayed open and heartbeat, and no screen ever moved.
  The subscription is now armed on the connection's `ready` event, which fires on
  first connect and on every reconnect, and at process start rather than on the
  first stream. `realtime subscribe failed` is logged at error level: it means
  that instance is delivering nothing, and it is not visible in outbox depth.
* `securityEvents.unacknowledged` and `.urgent` — whether anyone is working the
  queue (§4).
* `dependencies.redis` — `up`, `down` or `not-configured`.
* The isolation card on `/control/health` — `isolationStatus()` read from the
  running process. See `docs/deployment.md` §4.

"Today" in these numbers is UTC, deliberately: an operational number that shifts
with whoever is reading it cannot be compared between two people on a call.

---

## 2. The sweeps

`apps/web/src/db/maintenance.ts`.

Several tables carry a state that is only correct until a moment passes. An
offer past its window is still `LIVE`. A hold past its expiry still holds
capacity. A ticket past its validity is still `ISSUED`. Verification always
compares against the clock, so nothing is ever *wrong* to a consumer — but a
merchant console that lists an ended offer as live misreports, and capacity held
by an abandoned checkout is capacity nobody can buy.

### `runSweeps(now = new Date())`

Five transitions, in dependency order:

| # | Transition | Table | From → To | Condition |
|---|---|---|---|---|
| 1 | `expireStaleHolds` | `bookings` | `HELD` → `EXPIRED` | `hold_expires_at < now`. Also calls `releaseHold()`, returning the quantity to the slot |
| 2 | `activateDueOffers` | `offers` | `SCHEDULED` → `LIVE` | `starts_at <= now < ends_at` |
| 3 | `expireEndedOffers` | `offers` | `LIVE`/`SCHEDULED`/`PAUSED` → `ENDED` | `ends_at <= now` |
| 4 | `expireTickets` | `tickets` | `ISSUED` → `EXPIRED` | `valid_until <= now` |
| 5 | `sweepNoShows` | `bookings` | `CONFIRMED` → `NO_SHOW` | `ends_at < now` |

Holds go first on purpose: releasing capacity before offers are re-evaluated
means an offer is not marked sold out on the strength of capacity nobody holds.

It returns a count of each:
`{ expiredHolds, endedOffers, activatedOffers, expiredTickets, noShows }`.

**One limit to know about.** `expireStaleHolds` processes at most 500 stale
holds per call (`.limit(500)` in `apps/web/src/lib/commerce/inventory.ts`). A
backlog larger than that needs repeated runs — if a run reports
`expiredHolds: 500`, run it again until the number drops.

### There is no scheduler

Nothing in this repository runs `runSweeps()` on a schedule. No cron entry, no
worker, no queue, no `setInterval`. Not "it is configured elsewhere" — it does
not exist here, and until something calls it on a real deployment, offers stay
`LIVE` past their window and abandoned checkouts hold capacity indefinitely.

There is also no npm script that runs *only* the sweeps. `npm run db:refresh`
does call `runSweeps()`, but it calls it last, after rewriting sample rows — see
§2.1. **Do not use `db:refresh` as a production sweep.**

This is the command that runs the sweeps and nothing else:

```sh
cd apps/web
npx tsx -e "
import 'dotenv/config';
import { sql as pg } from './src/db/client';
import { runSweeps } from './src/db/maintenance';
runSweeps()
  .then((r) => console.log(JSON.stringify(r)))
  .catch((e) => { console.error(e.message); process.exitCode = 1; })
  .finally(() => pg.end());
"
```

It prints the counts as JSON and exits, which makes it usable from cron, a
Kubernetes `CronJob`, or a systemd timer. `tsx` is a dev dependency, so this runs
from the `tools` image, not the runtime image:

```sh
docker compose --profile tools run --rm tools npx tsx -e "…"
```

Every five minutes is a reasonable starting cadence — hold expiry is the
transition with the shortest useful latency, since it is capacity nobody can buy
until it runs. Turning this into a first-class `npm run db:sweep` script, and
scheduling it, is outstanding work.

`apps/web/src/db/run-insights.ts` and `run-demand.ts` are ad-hoc report scripts
run with `npx tsx`. They have no npm script and are not scheduled either.

### 2.1 `refreshSampleWindow()` — sample data only

`npm run db:refresh` (`apps/web/src/db/refresh.ts`).

The sample data turns on "tonight" meaning tonight. Seeded on Monday and shown on
Thursday, "Tonight at Phoenix — ₹149" ended three days ago and the whole story
collapses. Rather than re-seeding — which would throw away the eight weeks of
trading history the advisor and forecaster measure — this shifts the
forward-looking rows onto the current day and leaves history where it is:

* four live inventory slots and two Saturday slots, moved onto today or the next
  Saturday at their intended IST hour;
* six offers, re-dated and set back to `LIVE`;
* tickets that expired within the last 30 days, set back to `ISSUED` because the
  slot they belong to just moved forward;
* then `runSweeps()`, so anything genuinely past is still marked past.

It matches rows **by label and title** — `'Tonight 19:00 — Screen 7 (IMAX)'`,
`'Rooftop dinner — 30% off tonight'` and so on — because ids change on every
re-seed. Those strings are the seed's contract with this function.

It is idempotent and takes about a second. Run it before any walkthrough. **Never run
it on a production database**: on rows that happen to share a title it would
re-date real offers and resurrect expired tickets.

---

## 3. Backups and restore

**Nothing here is configured.** No scheduled dump, no offsite copy, no
encryption at rest for the dump, no retention policy, and no restore drill. The
commands below are correct and were run against a live PostgreSQL 16 while this
was written; scheduling and storing them is work that has not been done.

This document states no recovery-point or recovery-time figure. Nothing has been
configured or tested that could support one, and a number nobody has measured is
worse than no number.

### Taking a backup

Two artefacts, because one of them is not in the other.

```sh
# 1. The database itself. Custom format: compressed, and pg_restore can be
#    selective with it.
pg_dump -h "$PGHOST" -U "$PGUSER" -d onepass -Fc -f onepass-$(date -u +%Y%m%dT%H%M%SZ).dump

# 2. The roles. Roles are cluster-wide objects and are NOT in a database dump.
#    Restore a dump without them and every GRANT in isolation.sql fails on a
#    role that does not exist.
pg_dumpall -h "$PGHOST" -U "$PGUSER" --roles-only > onepass-roles-$(date -u +%Y%m%dT%H%M%SZ).sql
```

Against the Compose stack:

```sh
docker compose exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > onepass.dump
docker compose exec -T postgres \
  pg_dumpall -U "$POSTGRES_USER" --roles-only > onepass-roles.sql
```

Check what you have before you need it:

```sh
pg_restore -l onepass.dump | head -20      # header, format, TOC entry count
grep -c '^CREATE ROLE' onepass-roles.sql   # expect 4: postgres + the three onepass roles
```

**The dump contains everything.** Sealed ciphertext (issuer private keys, pass
secrets, webhook secrets, MFA secrets), peppered hashes, password hashes,
personal data. Encrypt it before it leaves the host and treat it with the same
care as `ENCRYPTION_KEY` — a dump plus that key is the whole platform.

**The dump is useless without the key.** `ENCRYPTION_KEY`, every id in
`ENCRYPTION_KEYS_PREVIOUS`, and `HASH_PEPPER` must survive independently of the
backup, or the restored database will have ciphertext nothing can open. Back up
the key material where you keep secrets, not next to the dump.

### Restoring

```sh
# 1. Roles first — the grants in the dump reference them.
psql -h "$PGHOST" -U "$PGUSER" -d postgres -f onepass-roles-<stamp>.sql

# 2. A clean target database.
createdb -h "$PGHOST" -U "$PGUSER" onepass_restored

# 3. The data. --no-owner if the restoring role differs from the dumping one.
pg_restore -h "$PGHOST" -U "$PGUSER" -d onepass_restored --no-owner --clean --if-exists \
  onepass-<stamp>.dump

# 4. Re-apply the isolation. Grants and policies come across in the dump, but
#    re-running is idempotent and is the cheapest way to be certain.
psql -h "$PGHOST" -U "$PGUSER" -d onepass_restored -f apps/web/src/db/isolation.sql
```

Then verify before pointing anything at it:

```sh
# Table count — expect 74. Fewer means the restore or the schema is incomplete.
psql -d onepass_restored -c \
  "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE';"

# Row-level security is still on where it should be — expect 17 rows.
psql -d onepass_restored -c \
  "select relname from pg_class where relrowsecurity order by relname;"

# The adversarial isolation suite, against the restored copy.
psql -d onepass_restored -f apps/web/src/db/tests/isolation.sql
```

A restore that has not been tried is a hypothesis. Restore into a scratch
database on a schedule you actually keep, run the three checks above, and throw
it away.

---

## 4. Incident basics

### Revoking every session for a user

`revokeAllSessions(userId, reason, exceptSessionId?)` in
`apps/web/src/lib/auth/session.ts`.

It does two things. It increments `users.session_generation`, and it stamps
`revoked_at` / `revoked_reason` on every unrevoked session row. The generation
bump is the one that matters: every session records the generation it was minted
under, and `resolveSession` returns `null` when
`row.generation !== row.user.sessionGeneration`. One `UPDATE` invalidates every
session everywhere, including ones held by an attacker on a device you cannot
reach — there is no fan-out to get half-done.

`exceptSessionId` re-mints one session at the new generation, so "sign out my
other devices" does not sign you out of the device you asked from. **In an
incident, omit it.**

Three ways to trigger it:

* **The account holder**, from the Sessions section of `/profile` — which calls
  `POST /api/me/sessions/revoke-all` (`self.session:revoke`), keeps the calling
  session, writes an `auth_events` row, emits a `SESSION_REVOKED` event, sends
  the holder a `SECURITY` notification, and writes an audit row.

  Note that the notification it sends links to `/app/security`, and **there is no
  page at that route** — the consumer session and security UI is on `/profile`.
  The same dead `linkPath` appears in five places in
  `apps/web/src/lib/auth/flows.ts` and in the seed. Worth fixing; it is
  cosmetic, and no API behaviour depends on it.
* **Directly**, when you need every session gone including the caller's:

  ```sh
  cd apps/web
  npx tsx -e "
  import 'dotenv/config';
  import { sql as pg } from './src/db/client';
  import { revokeAllSessions } from './src/lib/auth/session';
  revokeAllSessions('<userId>', 'incident <ticket-id>')
    .then(() => console.log('all sessions revoked'))
    .catch((e) => { console.error(e.message); process.exitCode = 1; })
    .finally(() => pg.end());
  "
  ```

  The reason is truncated to 80 characters and is stored on each revoked row —
  put the ticket reference in it.
* **In SQL**, if you have nothing but psql. The generation bump alone is
  sufficient to invalidate every session:

  ```sql
  update users set session_generation = session_generation + 1, updated_at = now()
   where id = '<userId>';
  update sessions set revoked_at = now(), revoked_reason = 'incident <ticket-id>'
   where user_id = '<userId>' and revoked_at is null;
  ```

  Note this writes no `auth_events`, emits no event and sends no notification —
  prefer one of the routes above unless the application is down.

### Reading the security queue

`security_events` — one row per thing worth a human's attention: a lockout, a
burst of failed sign-ins, a credential that failed its integrity check.

Columns: `id`, `user_id`, `organization_id`, `kind`, `severity`
(`INFO`…`CRITICAL`), `summary`, `metadata` (jsonb), `request_id`, `ip_hash`,
`acknowledged_at`, `acknowledged_by_user_id`, `created_at`. Indexed on
`(severity, created_at)`, `(user_id, created_at)`, `(organization_id,
created_at)` and `created_at`.

**The console is `/control/security`**, behind `platform.security:read`. The
evidence is on the card rather than behind a "view raw" link — `hashIntact:
false` *is* the finding, and an alert whose working nobody can see is an alert
nobody acts on. The metadata was stripped of anything credential-shaped when it
was written. `ip_hash` is never displayed: it is a peppered one-way hash that
exists so events can be correlated inside the database, and on a screen it
becomes a tracking identifier with a longer life than the investigation.
Acknowledging appends to the record — the event keeps its severity, summary and
evidence and gains the name of whoever looked.

In SQL:

```sql
-- The open queue, worst first.
select created_at, severity, kind, summary, user_id, organization_id
  from security_events
 where acknowledged_at is null
 order by case severity when 'CRITICAL' then 0 when 'HIGH' then 1
                        when 'MEDIUM' then 2 when 'LOW' then 3 else 4 end,
          created_at desc
 limit 100;

-- Everything recorded for one account.
select created_at, severity, kind, summary, metadata
  from security_events
 where user_id = '<userId>'
 order by created_at desc;
```

A consumer can read their own history through `GET /api/me/security`
(permission `self.security:read`) — the consumer database role has `SELECT` on
`security_events` for exactly this.

### Reading the audit trail

`audit_logs` — who did what to what, and whether it worked. Columns:
`actor_user_id`, `actor_role`, `organization_id`, `action`, `target_type`,
`target_id`, `result`, `request_id`, `ip_hash`, `user_agent`, `metadata`,
`created_at`. Indexed on `(organization_id, created_at)`,
`(actor_user_id, created_at)`, `(action, created_at)`,
`(target_type, target_id)` and `created_at`.

**It is append-only, and that is enforced by the database, not by convention.**
`isolation.sql` grants the consumer and business roles `INSERT` on `audit_logs`
and nothing else — no `SELECT`, no `UPDATE`, no `DELETE`. The CI isolation test
asserts all three denials. Only `onepass_admin` can read it.

Consoles: `/control/audit` (`platform.audit:read`) for the platform trail,
`/api/partner/[orgId]/audit` (`partner.audit:read`) for an organization's own.

```sql
-- Everything one actor did.
select created_at, action, target_type, target_id, result, request_id
  from audit_logs
 where actor_user_id = '<userId>'
 order by created_at desc
 limit 200;

-- Everything done TO one object, whoever did it.
select created_at, actor_user_id, actor_role, action, result, metadata
  from audit_logs
 where target_type = 'user' and target_id = '<userId>'
 order by created_at desc;

-- Tie an audit row to its security event and its log line.
select * from audit_logs where request_id = '<requestId>';
```

`request_id` is the join key across `audit_logs`, `security_events`,
`auth_events` and the application log. Start from it.

`ip_hash` is `HMAC-SHA256(HASH_PEPPER, lowercased-trimmed-value)`. To find other
rows from the same address, hash the address with the *current* pepper and
compare — never try to reverse it, and remember that rows written under a
previous pepper will not match (§5).

### Suspending an account

`users.status` accepts `SUSPENDED`. Setting it does not by itself terminate live
sessions — do both:

```sql
update users
   set status = 'SUSPENDED',
       session_generation = session_generation + 1,
       updated_at = now()
 where id = '<userId>';
```

Prefer `/control/users/<id>` in the Control console, which records who did it
and why in `audit_logs`.

---

## 5. Rotating the encryption key

`apps/web/src/lib/crypto.ts` builds a key ring from the environment:
`ENCRYPTION_KEY` under `ENCRYPTION_KEY_ID` is the current key, and
`ENCRYPTION_KEYS_PREVIOUS` — `id:base64` pairs, comma separated — are retired
keys that stay loadable. Each sealed value carries its key id in the ciphertext
(and binds it into the GCM AAD), so `open()` picks the right key per row and a
rotation never orphans data.

**What the code supports** is rolling the current key forward while keeping the
old ones readable. That is the whole rotation story: new writes use the new key,
old rows keep opening with the old one.

**What the code does not have** is a re-encryption pass. There is no script that
walks the sealed columns and re-seals them under the new key. `sealedKeyId()`
exists in `crypto.ts` and would be the primitive for one, but nothing calls it.
So a retired key can never be *removed* from `ENCRYPTION_KEYS_PREVIOUS` — not
until such a pass is written and run. Rotating adds a key to the ring; it does
not retire the old one from service.

### The procedure

1. Generate the new key.

   ```sh
   openssl rand -base64 32
   ```

2. Move the current pair into the previous list and install the new one. If the
   current key is id `v1` and you are moving to `v2`, the new environment is:

   ```
   ENCRYPTION_KEY=<the new key>
   ENCRYPTION_KEY_ID=v2
   ENCRYPTION_KEYS_PREVIOUS=v1:<the old key>
   ```

   Already have a previous list? Prepend, keep everything:
   `ENCRYPTION_KEYS_PREVIOUS=v1:<old>,v0:<older>`.

3. **Check the format before deploying.** `keyring()` silently skips a malformed
   entry — no colon, or a key that is not 32 bytes after base64 decoding — and
   the first symptom is `no key available for this ciphertext` on a row you
   cannot open. Verify first:

   ```sh
   node -e '
   const prev = process.env.ENCRYPTION_KEYS_PREVIOUS ?? "";
   for (const e of prev.split(",")) {
     const t = e.trim(); if (!t) continue;
     const i = t.indexOf(":");
     const len = i > 0 ? Buffer.from(t.slice(i + 1), "base64").length : -1;
     console.log(i > 0 ? t.slice(0, i) : "(no id)", len === 32 ? "OK" : `REJECTED (${len} bytes)`);
   }'
   ```

4. Deploy in **two passes**, not one. The ring is built once per process and
   cached (`keyring()` memoises it), so a running instance never sees a changed
   environment — every instance must be restarted, and during a rolling restart
   old and new instances run side by side. If the new key goes straight in as
   current, an old instance will meet a row sealed under an id it has never
   heard of and fail with `no key available for this ciphertext`.

   * **Pass one** — add the new key to `ENCRYPTION_KEYS_PREVIOUS` on every
     instance, leaving `ENCRYPTION_KEY_ID` alone. Roll. Now every instance can
     *open* `v2`, and nothing writes it yet.
   * **Pass two** — promote it: `ENCRYPTION_KEY` = the new key,
     `ENCRYPTION_KEY_ID=v2`, and move the old pair into
     `ENCRYPTION_KEYS_PREVIOUS`. Roll again. New writes are sealed under `v2`;
     old rows still open under `v1`.

5. Verify: issue a credential for a test organization and read it back. That
   exercises `seal()` on write and `open()` on the issuer private key.

### If the key is lost

There is no recovery path. Every organization's Ed25519 issuing private key,
every pass secret, every webhook secret and every MFA secret is sealed with it.
Losing it with no copy in `ENCRYPTION_KEYS_PREVIOUS` means no credential can be
signed again and no sealed value can be opened. Back the key material up
independently of the database dump (§3).

### Rotating `HASH_PEPPER`

Possible, and one-way. It is an HMAC key over IP addresses and login identifiers
in `audit_logs`, `security_events` and `auth_events`. Change it and rows written
before the change can never be correlated with rows written after — the old
hashes are not recoverable and cannot be recomputed, because the inputs were
never stored. Do it only in response to a suspected pepper disclosure, and
record the date so an investigator reading a hash gap knows why it is there.

---

## 6. Dependency advisories

`.github/workflows/security.yml` runs `npm audit --audit-level=high` on every
pull request and weekly. **That gate currently fails on the committed
lockfile.** It is left as a real gate rather than lowered to a level that passes,
because a threshold chosen to make the build green is not a security control.

As measured against the committed lockfile: **14 advisories — 1 critical, 6
high, 7 moderate.**

| Package | Severity | Advisory | Reaches production? | What it needs |
|---|---|---|---|---|
| `vitest` | critical | Arbitrary file read and execute when the Vitest UI server is listening | **No** — dev dependency, and the UI server is only started by `npm run test:e2e:ui` | Major upgrade to `vitest@5` (`isSemVerMajor`) |
| `vite`, `@vitest/mocker`, `vite-node`, `esbuild` | high / moderate | Path traversal in optimized-deps `.map` handling; `server.fs.deny` bypass; dev server accepts cross-origin requests | **No** — dev dependencies, dev server only | Same `vitest@5` upgrade |
| `postcss` (via `next`) | high | Four advisories: XSS via unescaped `</style>` in stringify output, and three arbitrary-`.map`-file-read / path-traversal issues via attacker-controlled `sourceMappingURL` | **Yes** — `postcss` is a build-time dependency of `next` | `next@16` (`isSemVerMajor`). This is the one to plan for; the others are dev-only |
| `drizzle-orm` | high | SQL injection via improperly escaped SQL identifiers | **Yes** | `drizzle-orm@0.45.2` (`isSemVerMajor`). Requires re-verifying the schema and the isolation tests after the upgrade |
| `drizzle-kit` (via `@esbuild-kit/*`, `esbuild`) | moderate | Dev server request forgery | **No** — used only for `db:push` / `db:generate` | `drizzle-kit@0.31.10` (`isSemVerMajor`) |
| `deepmerge-ts`, `@prisma/config`, `prisma` | high | Stack exhaustion when merging recursive object graphs | **No** — `prisma` is here only as a transitive optional peer of `drizzle-orm`; there is no `schema.prisma` in the repository | `npm audit fix` resolves it without a breaking change |

Regenerate the current list rather than trusting this table:

```sh
npm audit                       # the readable report
npm audit --audit-level=high    # exactly what CI gates on
```

Two of these — `drizzle-orm` and `next`/`postcss` — are the ones that reach
production, and both are major-version upgrades that need the full test suite
and the isolation suite re-run afterwards. Neither has been done.

Also outstanding: `next lint` has no ESLint configuration, so the `Lint` step in
CI emits a warning annotation instead of linting. It becomes a real gate the
moment `apps/web/eslint.config.mjs` exists.

---

## 7. A routine check

Nothing watches any of this automatically. Until something does:

| Cadence | Check | Where |
|---|---|---|
| Every 5 minutes | The sweeps ran and `expiredHolds` is below 500 | §2 — once you have scheduled them |
| Hourly | `/api/ready` is 200 on every instance | Load balancer |
| Daily | `outbox.unpublished` and `oldestUnpublishedAt` are not climbing | `/control/health` |
| Daily | `securityEvents.unacknowledged` and `.urgent` | `/control/security` |
| Weekly | `npm audit --audit-level=high` | §6, and the scheduled CI run |
| Weekly | A dump was taken, and one was restored into a scratch database and checked | §3 |
| On every deploy | `/api/health` reports the `version` you just shipped | §1 |
| On every schema change | `isolation.sql` re-applied — new tables get no grants by default | `docs/deployment.md` §4 |
