# Deploying ONEPASS

What this document covers: the environment ONEPASS needs, how the secrets in it
are generated, how the schema gets applied, how the three-role database
isolation is turned on and verified, and what each payment and delivery provider
setting actually does.

What it does not do is tell you the platform is ready for something. Where a
capability is missing or unproven, it says so and names the file you can read to
check. Two things worth stating before anything else:

* **Nothing here has been load-tested, penetration-tested, or audited.** The
  test suite covers isolation, inventory concurrency and the rate limiter
  against real Postgres and Redis (see `.github/workflows/ci.yml`), which is a
  different claim from "verified in production".
* **There is no scheduler, no backup job and no alerting configured in this
  repository.** Those are deployment decisions and are listed under
  [What is not configured](#what-is-not-configured) so they are chosen rather
  than assumed. `docs/operations.md` covers the procedures.

---

## 1. What gets deployed

One Next.js 15 application (`apps/web`) with three dependencies:

| Component | Version | Why |
|---|---|---|
| Node | 22 | The runtime the image and CI both pin |
| PostgreSQL | 16 | Every row. Row-level security and the three-role isolation are Postgres features, not application code |
| Redis | 7 | Rate limits and realtime fan-out. Required in production — per-instance limits are wrong limits |

The container image is built from the `Dockerfile` at the repository root. It is
a multi-stage build ending in a `runtime` stage that carries the Next.js
standalone bundle, runs as the non-root `node` user, and contains no compiler,
no source and no dev dependencies.

```sh
docker build -t onepass:$(git rev-parse --short HEAD) .
docker run --rm -p 3000:3000 --env-file .env \
  -e APP_VERSION=$(git rev-parse --short HEAD) \
  onepass:$(git rev-parse --short HEAD)
```

`APP_VERSION` is optional and worth setting: `/api/health` returns it, so a
deploy can confirm which build is answering. Unset, it reports `dev`, which on a
production host is a good sign that the deploy pipeline forgot a step.

### This needs a long-running container, not a serverless platform

Worth stating plainly, because the obvious choice is the wrong one here and the
failure is silent.

Two things in this application assume a process that stays alive:

* **The event stream.** `/api/events/stream` holds an open server-sent-event
  connection for as long as a console is on screen. A serverless function has a
  maximum duration — typically tens of seconds — so the stream is cut and
  re-established continuously, and events published while it is down reach
  nobody.
* **The outbox publisher.** `startOutboxPublisher()` drains the outbox onto
  Redis and sends partner webhooks on a 750 ms interval. An interval belongs to
  a process. On a platform that freezes the process between requests, it stops
  running the moment a request ends: writes still commit, the outbox still fills,
  and nothing is ever delivered.

Neither failure produces an error. Pages render, the API answers, tests that
exercise the services pass — and screens simply never move while
`outbox.oldestUnpublishedAt` climbs. So:

| Platform | Suitable |
|---|---|
| Render, Railway, Fly.io, a VM, Kubernetes, ECS | **Yes** — a container that stays up |
| Vercel, Netlify Functions, Cloudflare Workers, Lambda | **No** — see above |

`render.yaml` at the repository root is a Render Blueprint that provisions the
app, a managed Postgres 16 and a managed Redis together. It targets the
`runtime` stage of this same Dockerfile.

If a serverless deployment is ever required, the publisher has to move out of
the web process into a worker that runs on a schedule, and the SSE stream has to
become a hosted pub/sub the browser connects to directly. Both are real pieces
of work, and neither is done here.

### Without Docker

Not every host builds an image. A platform that clones the repository and runs a
build command — Render, Railway, an EC2 box behind nginx — needs no container:

```sh
npm ci
npm run build          # next build, then the postbuild step below
npm start              # node apps/web/.next/standalone/apps/web/server.js
```

`npm run build` finishes by running `apps/web/scripts/postbuild.mjs`, which
copies `.next/static` and `public/` into the standalone bundle. Next does not do
this itself — it leaves it to the deployer, and the Dockerfile does it in two
`COPY` lines. Without that step the server boots, answers every route with a
200, and serves every page with **no CSS and no client JavaScript**, which reads
as a broken stylesheet rather than a missing build step. Keep the postbuild in
whatever build command you configure.

The postbuild step also **deletes any `.env` file from the bundle**. Next traces
`.env` files into the standalone output, which is convenient locally and is how
a build machine's secrets end up inside a deployable artifact — the bundle built
in development carried `DATABASE_URL` and `ENCRYPTION_KEY`, so anyone holding
the build held the keys that decrypt every sealed pass. Configuration is the
host's job: real environment variables take precedence over those files, so
removing them changes nothing about a correctly configured deployment, and it
removes the case where a host that was *not* configured boots quietly against
the build machine's database instead of refusing to start.

`apps/web/scripts/smoke-prod.sh` boots that bundle locally under
`NODE_ENV=production`, filling in the handful of values the production guard
insists on with obvious placeholders. It is a way to find out whether a build
runs before you ship it — not a deployment, and not a template for one: the
values in it are not credentials and nothing is sent with them.

The standalone server binds `0.0.0.0` and honours `PORT`, so a platform that
injects a port needs no extra configuration.

**Verified:** this exact path — `npm run build` then the standalone server under
`NODE_ENV=production` — was booted and exercised: every public route, the full
signed-in consumer surface, the partner console and the platform console all
returned 200, `/api/me/pass` minted a live rotating token, CSS and JS chunks
loaded, and a consumer request to `/control` still returned 404. The full
browser suite — 61 tests, including the real-time one, which admits a ticket in
one browser context and asserts that a door console in another updates without
being touched — was then run against that same production server and passed.
The bundle it ran from contains no `.env`: every value came from the process
environment, which is the proof that a host's configuration is what configures
it.

### The production environment guard is not advisory

`apps/web/src/lib/env.ts` validates the whole environment once at boot and
throws with the names — never the values — of everything wrong. In production it
additionally **refuses**:

* `RATE_LIMIT_DISABLED=true`
* a missing `REDIS_URL`
* a missing `HASH_PEPPER`
* an `APP_URL` that is not `https://`
* `PAYMENT_PROVIDER=SANDBOX`
* `EMAIL_PROVIDER=CONSOLE` or `SMS_PROVIDER=CONSOLE`

This is deliberate, and it is the reason the local Docker Compose stack runs the
dev target rather than the production image: the standalone server produced by
`next build` sets `NODE_ENV=production` on its first line unconditionally, so
there is no way to run the shipped image "in development mode". An instance
whose environment is incomplete fails `/api/health` with a 500 and is marked
unhealthy. That is the intended behaviour — do not work around it.

---

## 2. Environment variables

`apps/web/src/lib/env.ts` is the source of truth. `.env.example` at the
repository root is the annotated copy for the Docker stack;
`apps/web/.env.example` is the equivalent for running on the host directly. The
difference between them is host names — `postgres`/`redis` inside Compose,
`localhost` outside.

### Required in production — the app will not serve a request without these

| Variable | What it does |
|---|---|
| `DATABASE_URL` | The runtime Postgres connection |
| `APP_URL` | The public origin. Must be `https://`. Used to build links in email, SMS and credential URLs, so a wrong value produces links that go nowhere |
| `REDIS_URL` | Shared rate-limit and realtime state |
| `ENCRYPTION_KEY` | AES-256-GCM key sealing everything the server must read back |
| `HASH_PEPPER` | Keys the one-way hashes of IPs and login identifiers in the audit trail |
| `PAYMENT_PROVIDER` | Must not be `SANDBOX` |
| `EMAIL_PROVIDER`, `SMS_PROVIDER` | Must not be `CONSOLE` |

Plus whatever the chosen providers require — see §5 and §6.

### Has a default, but worth setting deliberately

| Variable | Default | Notes |
|---|---|---|
| `ENCRYPTION_KEY_ID` | `v1` | Stamped into every value sealed from now on |
| `ENCRYPTION_KEYS_PREVIOUS` | unset | Retired keys, `id:base64` comma-separated. See §4 and `docs/operations.md` |
| `DIRECT_DATABASE_URL` | falls back to `DATABASE_URL` | Unpooled connection used only by `npm run db:migrate`. Set it when `DATABASE_URL` points at a transaction-mode pooler — migrations cannot run through one |
| `DATABASE_POOL_MAX` | `10` | Per process. Multiply by instance count and keep the total under the server's `max_connections` |
| `SESSION_TTL_HOURS` | `336` (14 days) | 1–720 |
| `SESSION_ELEVATION_MINUTES` | `15` | How long a re-authentication stays fresh for a step-up action |
| `SESSION_COOKIE_NAME` | `onepass_session` | |
| `RATE_LIMIT_DISABLED` | `false` | Cannot be `true` in production |
| `EMAIL_FROM` | `ONEPASS <no-reply@onepass.in>` | Must be a domain verified with your email provider |
| `LOG_LEVEL` | `info` | `fatal`…`trace` |

### Read directly from the environment, not part of the schema

These are read via `process.env` by the files named, so they will not appear in
an env.ts validation error if they are wrong or missing.

| Variable | Read by | Notes |
|---|---|---|
| `APP_VERSION` | `src/app/api/health/route.ts`, `src/app/api/admin/health/route.ts`, the Control health page | Truncated to 40 characters; reported as `dev` when unset |
| `DATABASE_URL_CONSUMER` | `src/db/domains.ts` | See §4 |
| `DATABASE_URL_BUSINESS` | `src/db/domains.ts` | See §4 |
| `DATABASE_URL_PLATFORM` | `src/db/domains.ts` | See §4 |
| `SEED_SAMPLE_DATA` | `src/db/seed.ts` | Only the exact string `yes-i-am-sure` makes the seed write sample accounts under `NODE_ENV=production`. Do not set it on a real deployment — the sample accounts share one well-known password |

### Generating the keys

```sh
# ENCRYPTION_KEY — must be base64 for exactly 32 bytes. env.ts rejects anything else.
openssl rand -base64 32

# HASH_PEPPER — at least 16 characters. Hex is convenient and unambiguous.
openssl rand -hex 32

# Without openssl:
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Both commands are the ones `.github/workflows/ci.yml` uses to generate its own
per-run environment, so the format they produce is the format the app is tested
against.

**Neither key belongs in source control.** `.gitignore` excludes `.env` and
`.env.*` except `.env.example`; the `secrets` job in
`.github/workflows/security.yml` fails the build if a key-shaped literal is ever
assigned to `ENCRYPTION_KEY`, `ENCRYPTION_KEYS_PREVIOUS`, `HASH_PEPPER`,
`RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `RESEND_API_KEY` or
`MSG91_AUTH_KEY` in a tracked file, or if a filled-in `.env` is committed. The
`Dockerfile` bakes in no secret: its only key-shaped value is 32 random bytes
generated inside the build layer to satisfy the schema while Next collects page
data, and it never reaches the runtime stage.

Deliver them to the running container through whatever your platform uses for
secrets — a Kubernetes Secret, an ECS task-definition secret backed by Secrets
Manager or Parameter Store, a Fly secret, a systemd `EnvironmentFile` with mode
0600. The application does not care which; it only reads `process.env`.

---

## 3. The keys, and what each one protects

### `ENCRYPTION_KEY` — the AES-256-GCM key ring

`apps/web/src/lib/crypto.ts` implements `seal()` / `open()` over AES-256-GCM.
The sealed layout is `keyId(length-prefixed) | iv(12) | tag(16) | ciphertext`,
and the key id is bound into the AAD — so a ciphertext cannot be replayed under
a different key claim, and a value sealed with a retired key can still be opened
as long as that key is still loaded.

What it seals, in this codebase:

* **Each organization's Ed25519 issuing private key.** `ensureIssuerKeys()` in
  `apps/web/src/lib/credentials/service.ts` generates an Ed25519 keypair on an
  organization's first issuance, stores the public half as plain SPKI DER
  (publishing it is the point) and the private half sealed with this key.
* Pass secrets, webhook secrets and MFA secrets.

There is **no environment variable for the Ed25519 issuer keys.** They are
generated per organization, on demand, inside the database. That has a direct
consequence: `ENCRYPTION_KEY` is what stands between you and every issuer key on
the platform. Lose it with no entry in `ENCRYPTION_KEYS_PREVIOUS` and no
credential can be signed or re-signed again — there is no recovery path, by
design. Rotation is covered in `docs/operations.md`.

### `HASH_PEPPER` — the audit-trail HMAC key

`peppered()` in the same file is an HMAC-SHA256 over lowercased, trimmed input.
It is used for IP addresses and login identifiers in `audit_logs`,
`security_events` and `auth_events`, so those values stay correlatable inside
the database and unreadable outside it. Without a pepper, an attacker holding
the database recovers an IP address by brute force in seconds — the input space
is tiny.

Changing it makes existing hashes uncorrelatable with new ones. That is a
property of a keyed hash, not a bug, but it is not reversible: old rows keep
their old hashes and will never match a new one again.

There is a development fallback string in `crypto.ts` for when `HASH_PEPPER` is
unset. `env.ts` makes the variable mandatory in production precisely so that
fallback can never be what protects a real audit trail.

---

## 4. The database

### TLS is the default in production

A managed Postgres — Neon, Supabase, RDS, Aiven — is reached across the public
internet, and `postgres.js` only negotiates TLS when the connection string asks
for it. A URL copied out of a provider dashboard without `?sslmode=require`
therefore connects in the clear, and nothing warns you because it works.

So `apps/web/src/db/client.ts` inverts the default: under `NODE_ENV=production`,
a `DATABASE_URL` whose host is not local and which carries no explicit `sslmode`
or `ssl` parameter is connected with `ssl: 'require'`. An explicit parameter in
the URL always wins, in either direction, and local hosts — `localhost`,
`postgres`, `db`, `*.internal`, `*.local` — are left alone so a `docker compose`
stack or a private-network host is not refused.

`require` encrypts without verifying the chain. Managed providers commonly
present a certificate signed by their own root, and failing closed on
verification would refuse the very databases this is for. If your provider gives
you a CA bundle and you want verification, say so explicitly in the URL
(`?sslmode=verify-full`) — the explicit value is honoured.

### Applying the schema

**Use `drizzle-kit push`.** This is not the conventional answer and it is worth
being explicit about why, because the alternative silently produces a broken
database.

The Drizzle schema is spread across three files —
`apps/web/src/db/schema.ts`, `commerce.ts` and `extensions.ts`, re-exported
through `schema.ts` — and defines **74 tables**. The committed SQL migrations in
`apps/web/drizzle/` (`0000_flimsy_lenny_balinger.sql`, `0001_credentials.sql`)
create **35**. The 39 tables of the commerce and extensions layer — `bookings`,
`tickets`, `offers`, `venues`, `receipts`, `city_passes`, `warranties`,
`itineraries`, `quests` and the rest — have no migration file.

So `npm run db:migrate` (the Drizzle migrator, `src/db/migrate.ts`) applies two
migrations and leaves you a database the application cannot run on. It is not a
broken command; it is a command whose migration folder has fallen behind the
schema. `scripts/bootstrap-dev.sh` and both jobs in
`.github/workflows/ci.yml` use `drizzle-kit push`, which diffs the TypeScript
schema against the live database and applies the difference. That is the path
that is exercised on every commit, and it is the one to use:

```sh
cd apps/web
DATABASE_URL="postgresql://…" npm run db:push -- --force
```

`--force` skips the interactive confirmation, which has no answer on a
deployment runner. Without it the command waits for a keypress.

**Before running this against a database with data in it**, read what it
proposes. `drizzle-kit push` will drop a column it cannot match, and it does not
ask twice. Run it without `--force` somewhere you can read the plan, or take a
dump first (`docs/operations.md`, "Backups").

If you want real, reviewable migrations for production — and for a database with
customer data you should — the work is to regenerate the migration folder from
the current schema (`npm run db:generate` in `apps/web`) and adopt
`npm run db:migrate` as the deployment step. That has not been done here, and
this document is not going to pretend otherwise.

`npm run db:migrate:dev` in `apps/web/package.json` runs `prisma migrate dev`.
There is no `schema.prisma` anywhere in the repository — `prisma` is present
only as a transitive optional peer of `drizzle-orm`. That script does not work
and should be removed.

### Bootstrap order

`scripts/bootstrap-dev.sh` is the source of truth for the order, and CI mirrors
it deliberately so a green run means the sequence a developer runs is the
sequence that was tested:

1. **postgres** up and accepting connections
2. **redis** up and answering `PING`
3. **databases** created (`onepass`, and `onepass_test` for the suite)
4. **schema** — `npm run db:push -- --force` (drizzle-kit push, then `isolation.sql` re-applied and checked)
5. **isolation SQL** — `psql -f apps/web/src/db/isolation.sql`
6. **seed** — `npm run db:seed`
7. **sample window** — `npm run db:refresh`

Steps 6 and 7 are for a development or sample database. On a real deployment,
`npm run db:seed` still matters: it writes the reference data the platform needs
to function — roles, permissions and consent definitions — and skips the sample
accounts and sample commerce unless `SEED_SAMPLE_DATA=yes-i-am-sure`. Do not run
step 7 anywhere real; `refreshSampleWindow()` rewrites rows that exist only in the
seeded sample data.

With the Docker Compose stack, the same order is:

```sh
cp .env.example .env          # then fill it in
docker compose up -d postgres redis
docker compose --profile tools run --rm tools npm run db:push -- --force
docker compose exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" < apps/web/src/db/isolation.sql
docker compose --profile tools run --rm tools npm run db:seed
docker compose up -d app
```

The isolation step runs `psql` inside the Postgres container, so nothing needs a
Postgres client installed on the host.

### The three roles and what isolation actually means

`apps/web/src/db/isolation.sql` creates three PostgreSQL roles and is
idempotent — safe to re-run, and it must be re-run after any schema change that
adds a table, because no blanket default privilege is granted.

| Role | Serves | Connection variable |
|---|---|---|
| `onepass_consumer` | the consumer API — `/api/me/*`, `/api/auth/*` | `DATABASE_URL_CONSUMER` |
| `onepass_business` | the partner API — `/api/partner/[orgId]/*` | `DATABASE_URL_BUSINESS` |
| `onepass_admin` | the platform API — `/api/admin/*` | `DATABASE_URL_PLATFORM` |

The file's own header explains why this is three roles in one database rather
than three databases: ONEPASS's core rows are relationships between a consumer
and a business, so splitting them physically would turn every foreign key into
an application-level join, lose referential integrity and lose atomicity for
"take capacity, charge, issue the ticket" — while moving the security boundary
back into application code, which is the thing it is supposed to be below.

Four mechanisms do the work:

1. **Per-table grants.** The business role holds *no* grant on `users`,
   `user_profiles`, `sessions`, `devices`, `payment_methods`, `notifications`,
   `auth_events`, `verification_requests`, `reward_ledger`, `savings_events`,
   `itineraries`, `households` or `warranties`. `SELECT * FROM users` on a
   business connection does not return a filtered result — it returns
   `permission denied for table users`.
2. **Append-only audit.** Consumer and business roles get `INSERT` on
   `audit_logs`, `security_events` and `outbox_events` and nothing else: every
   role can record what it did, none can edit or erase the record.
3. **A consent-gated view.** `business_customer_view` is the only route from a
   business connection to a person's identity. A view runs with its owner's
   privileges, so it can read `users` and `user_profiles` while the caller
   cannot. It returns a row only where a live `partner_connections` row exists
   with `state = 'ACTIVE'`, and each field is gated on its own unrevoked,
   unexpired consent grant: `display_name` needs a grant covering
   `identity.basic`, `email` and `mobile` need `contact.basic`. Identity consent
   does not imply contact consent.
4. **Row-level security.** Sixteen relationship tables plus `verifications` get
   `ENABLE`/`FORCE ROW LEVEL SECURITY` and a policy keyed to
   `current_setting('app.organization_id', true)`. `withTenant()` in
   `src/db/domains.ts` sets that with `set_config(..., true)` —
   **transaction-local**, so the setting is discarded at commit and cannot be
   inherited by whoever picks the pooled connection up next. When it is unset
   the policy evaluates false and the caller sees nothing: it fails closed.
   `withTenant()` also rejects an organization id that is not a ULID, because a
   non-ULID means something upstream passed user input where an authorization
   result belongs.

### Turning it on

The roles are created `NOLOGIN`, so they cannot be used until an operator gives
each one a password. That is deliberate: the file can be applied safely long
before the credentials exist.

```sh
psql -U postgres -d onepass -f apps/web/src/db/isolation.sql

psql -U postgres -d onepass <<'SQL'
ALTER ROLE onepass_consumer LOGIN PASSWORD '<generated>';
ALTER ROLE onepass_business LOGIN PASSWORD '<generated>';
ALTER ROLE onepass_admin    LOGIN PASSWORD '<generated>';
SQL
```

Then set all three connection URLs in the application environment:

```
DATABASE_URL_CONSUMER=postgresql://onepass_consumer:<password>@<host>:5432/onepass
DATABASE_URL_BUSINESS=postgresql://onepass_business:<password>@<host>:5432/onepass
DATABASE_URL_PLATFORM=postgresql://onepass_admin:<password>@<host>:5432/onepass
```

Generate each password the same way as the other secrets
(`openssl rand -base64 24`) and store them wherever the rest of the environment
lives. They are not in the zod schema, so a typo in a variable *name* will not
be caught at boot — it will silently fall back to the shared connection.

### Verifying it is actually on

`isolationStatus()` in `apps/web/src/db/domains.ts` reports what is in force in
the running process, rather than what a document claims. If any of the three
URLs is unset, that domain falls back to `DATABASE_URL` and `separated` is
`false`.

Read it on **the Control console at `/control/health`**, which requires the
`platform.health:read` permission. The isolation card at the top of that page is
`isolationStatus()` called directly.

`/api/admin/health` is the JSON counterpart of the rest of that page — user,
organization and transaction counts, outbox depth, unacknowledged security
events, Redis state — but it does **not** report isolation. `isolationStatus()`
is called only from the page (`src/app/(admin)/control/health/page.tsx`), so
there is currently no API route that answers "are the three domains separated?".
The page is the only place to read it.

`separated: false` comes with the note *"Domain URLs are not set, so all three
share one connection. Row-level security still applies where the role has it,
but grant-level separation is NOT in force."* Treat that as the honest answer:
RLS on a superuser-ish shared connection is not the same control as a role with
no grant.

The adversarial proof lives in `apps/web/src/db/tests/isolation.sql`, and the
`Database isolation tests` step of `.github/workflows/ci.yml` asserts on its
output — it issues the queries a compromised or buggy service would issue and
fails if any expected denial did not happen. To run it against a database of
your own:

```sh
psql -d onepass_iso -f apps/web/src/db/tests/isolation.sql
```

Run it against a database with the schema and grants but no seed — the file
inserts its own consent definitions, and a seeded database makes the consent half
of the file a no-op. Read the CI step for the exact assertions; a "LEAK" row in
the output means a query that must return nothing returned something.

---

## 5. Payment providers

`apps/web/src/lib/payments/provider.ts` is a small adapter layer behind one
interface: `createOrder()` and `verifyWebhook()`.

The design constraint it enforces: **ONEPASS never touches a card number, a CVV
or a UPI PIN.** The consumer is handed to the provider's own collection surface,
and ONEPASS keeps a provider order id, a provider token and a masked label —
nothing that could authorise a payment. A payment becomes real only when the
provider's webhook says so, and a webhook is believed only after its HMAC
signature verifies in constant time (`safeCompareHex`). The browser's "payment
succeeded" callback is never trusted.

### `PAYMENT_PROVIDER=SANDBOX`

The default, and development only. `SandboxAdapter` returns
`sandbox_order_<reference>` from `createOrder()` and verifies webhooks against a
fixed secret compiled into the file. That fixed secret is acceptable *precisely
because* the provider cannot run in production: `env.ts` fails startup with
*"the sandbox provider must never run in production"*. Nothing else is needed —
no keys, no account.

### `PAYMENT_PROVIDER=RAZORPAY`

The implemented live adapter, chosen as the default for a real deployment
because UPI is the rail this product is designed around. It requires all three
of these, and `env.ts` refuses to boot in production if any is missing:

| Variable | Where it comes from | Notes |
|---|---|---|
| `RAZORPAY_KEY_ID` | Razorpay dashboard → API keys | Publishable by design. It is sent to the browser in `clientParams` so the checkout can open |
| `RAZORPAY_KEY_SECRET` | Issued once with the key id | HTTP Basic auth to `https://api.razorpay.com/v1/orders`. Never leaves the server |
| `RAZORPAY_WEBHOOK_SECRET` | Razorpay dashboard → Webhooks, set when you create the endpoint | **Not optional.** `env.ts` says so in as many words: "required — unverified webhooks are not accepted" |

The webhook secret is a separate value from the key secret. `verifyWebhook()`
computes `HMAC-SHA256(webhookSecret, rawBody)` as hex and compares it in
constant time against the signature header, then and only then parses the body —
never the other way round. `payment.captured` maps to `CAPTURED`,
`payment.failed` to `FAILED`, anything else to `AUTHORIZED`.

You must also register the webhook endpoint in the Razorpay dashboard and point
it at your deployment. That is a step outside this repository; the value it
gives you is what goes in `RAZORPAY_WEBHOOK_SECRET`.

### `PAYMENT_PROVIDER=STRIPE`

Accepted by the schema and by the production boot guard, but **the adapter is not
implemented**: `paymentProvider()` throws `PROVIDER_ERROR` — *"The Stripe adapter
is not implemented"* — the first time anything asks for a provider. Do not
select it. A production instance configured this way will start and then fail
every payment.

### Sandbox versus live, in one line

| | SANDBOX | RAZORPAY |
|---|---|---|
| Money moves | No | Yes |
| Order creation | In-process, no network call | `POST https://api.razorpay.com/v1/orders` |
| Webhook secret | Fixed, compiled into the source | `RAZORPAY_WEBHOOK_SECRET` |
| Allowed in production | **No — startup is refused** | Yes, with all three keys |

---

## 6. Email and SMS delivery

`apps/web/src/lib/delivery.ts`, same adapter shape.

| Setting | State | Needs |
|---|---|---|
| `EMAIL_PROVIDER=CONSOLE` | Prints one-time codes to the server log. **Refused in production** | — |
| `EMAIL_PROVIDER=RESEND` | Implemented | `RESEND_API_KEY`, and an `EMAIL_FROM` on a domain verified with Resend |
| `EMAIL_PROVIDER=SES` | **Not implemented** | — |
| `SMS_PROVIDER=CONSOLE` | Prints codes to the server log. **Refused in production** | — |
| `SMS_PROVIDER=MSG91` | Implemented | `MSG91_AUTH_KEY`, and `MSG91_SENDER_ID` (defaults to `ONEPAS`) |
| `SMS_PROVIDER=TWILIO` | **Not implemented** | — |

The console transport has a second guard inside `consoleTransport()`: even if it
were somehow reached under `NODE_ENV=production` it logs an error and drops the
message rather than printing a code. A one-time code in a log file is a one-time
code in a log file.

**`SES` and `TWILIO` are a trap worth naming.** Both are valid enum values, so
both satisfy the production boot guard — the guard only rejects `CONSOLE`. But
their adapters return `{ delivered: false, error: '… adapter not implemented' }`
for every message. A production instance set to `EMAIL_PROVIDER=SES` starts
cleanly, passes its health check, and silently delivers no verification codes at
all. Use `RESEND` and `MSG91`, or implement the adapter first.

---

## 7. Deployment checklist

Ordered so that each step can be verified before the next one matters.

1. **Provision** Postgres 16 and Redis 7. Note whether `DATABASE_URL` will point
   at a transaction-mode pooler; if so, set `DIRECT_DATABASE_URL` to the direct
   connection.
2. **Generate** `ENCRYPTION_KEY` and `HASH_PEPPER` (§2) and put them in your
   platform's secret store. Not in the repository, not in a shell history that
   syncs.
3. **Apply the schema** with `npm run db:push -- --force` (§4) — never a bare
   `drizzle-kit push`, which drops the row-level policies. Take a dump first
   if the database is not empty.
4. **Apply `isolation.sql`**, give the three roles passwords, set
   `DATABASE_URL_CONSUMER` / `_BUSINESS` / `_PLATFORM` (§4).
5. **Seed the reference data** — `npm run db:seed`. Confirm `SEED_SAMPLE_DATA` is
   *not* set.
6. **Configure the providers** — Razorpay's three keys, a real email and SMS
   provider (§5, §6). Register the Razorpay webhook endpoint and put its secret
   in `RAZORPAY_WEBHOOK_SECRET`.
7. **Build and deploy** the image. Set `APP_VERSION` to the commit.
8. **Verify** — in this order:
   * `GET /api/health` → `200 {"status":"ok","uptime":…,"version":"<your sha>"}`.
     A 500 here means the environment failed validation; the response will not
     say which variable, but the container log will, by name.
   * `GET /api/ready` → `200 {"database":"up","redis":"up"}`. A 503 means one of
     them is not answering within 1.5 s.
   * `/control/health` as a platform admin → the isolation card should read
     separated, and `dependencies.redis` should be `up`.
9. **Point the load balancer's health check at `/api/ready`, not `/api/health`.**
   See `docs/operations.md` for why the two are different.

---

## What is not configured

Named here so each one is a decision rather than an assumption. None of these is
set up in this repository:

* **No scheduler.** `runSweeps()` in `apps/web/src/db/maintenance.ts` performs
  every time-driven state transition — expiring stale inventory holds, ending
  and activating offers, expiring tickets, sweeping no-shows — and nothing in
  this repository calls it on a schedule. Without one, offers stay `LIVE` past
  their window and abandoned checkouts hold capacity indefinitely. See
  `docs/operations.md`, "The sweeps".
* **No backup or restore automation.** `docs/operations.md` gives the commands;
  scheduling, storing, encrypting and — most importantly — periodically
  *restoring* them is not done here. This document states no recovery-point or
  recovery-time figure, because nothing has been configured or tested that could
  support one.
* **No alerting.** `/api/admin/health` reports outbox depth, the age of the
  oldest unpublished event and the count of unacknowledged security events.
  Nothing watches those numbers or pages anyone.
* **No standalone outbox publisher.** There *is* an in-process one:
  `startOutboxPublisher()` in `apps/web/src/lib/realtime.ts` runs
  `drainOutbox()` on a 750 ms interval, claiming batches with
  `FOR UPDATE SKIP LOCKED` so several instances can drain concurrently. But it
  is started at module scope of `apps/web/src/app/api/events/stream/route.ts`,
  and Next.js loads a route module lazily — so on an instance that has never
  served a request to `/api/events/stream`, the publisher has never started and
  the outbox does not drain. The file says as much: at scale this becomes a
  separate worker. That worker does not exist here. Watch
  `outbox.oldestUnpublishedAt` on `/control/health`.
* **No log shipping, tracing or metrics backend.** The app logs JSON via pino to
  stdout at `LOG_LEVEL`.
* **No TLS termination.** `APP_URL` must be `https://` in production; the
  application itself serves plain HTTP on `PORT` and expects a proxy or load
  balancer in front of it.
* **No ESLint configuration.** The `Lint` step in CI says so with a warning
  annotation rather than failing, because `next lint` with no config prompts
  interactively and cannot run non-interactively. It becomes a real gate the
  moment `apps/web/eslint.config.mjs` exists.
* **Outstanding dependency advisories.** `npm audit --audit-level=high`
  currently fails on the committed lockfile. The list and what each one needs is
  in `docs/operations.md`, "Dependency advisories".
* **No security review or penetration test.** The isolation, authorization and
  concurrency tests in CI are real tests of specific properties. They are not an
  audit, and nobody outside this repository has looked.
