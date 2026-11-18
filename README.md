# ONEPASS

One identity across physical commerce. A person proves who they are once, with
consent, and a merchant gets the customer record they would otherwise have had
to build themselves.

India-first: rupees as integer paise, `Asia/Kolkata` for every "today", `en-IN`
formatting, E.164 mobile numbers, Razorpay as the payment rail behind a provider
interface. Nothing scopes the product to a city — cities are rows with an
`is_live` flag, so opening a new one is data, not a release.

## What is in here

| Path | What it is |
|---|---|
| `apps/web` | The Next.js 15 application — consumer, partner console, platform console, and the public verification API |
| `packages/pass` | The rotating pass: RFC 6238 TOTP and a dependency-free QR encoder. One implementation, shared |
| `mobile` | An Expo client scoped to sign-in and the pass. Not a second copy of the web app |
| `docs` | Deployment, operations, service conventions, and the build report |
| `start.sh` | One command to a running app on `http://localhost:3000` — Docker, secrets, schema, policies, sample data |
| `render.yaml` | A Render Blueprint: the app, managed Postgres and managed Redis, provisioned together, with a public URL |
| `scripts/bootstrap-dev.sh` | The same bootstrap without Docker, against a Postgres and Redis you already run |
| `apps/web/scripts` | Validation and audit tooling — see [Checks](#checks) |

## Running it

One command, if you have Docker:

```sh
./start.sh
```

Then open **http://localhost:3000**.

It generates a `.env` with real random secrets on first run (and leaves an
existing one alone), brings up Postgres and Redis, applies the schema, the
row-level security policies and the sample data, and starts the app. Re-running
it is safe — every step is idempotent.

### A public URL

Once this repository is on GitHub, replace `YOUR-USER/YOUR-REPO` below and the
link is a single click that deploys it:

```
https://render.com/deploy?repo=https://github.com/YOUR-USER/YOUR-REPO
```

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/YOUR-USER/YOUR-REPO)

It reads `render.yaml` and provisions all three pieces together — the app from
this Dockerfile's `runtime` stage, a managed Postgres 16 and a managed Redis —
generating the encryption key and pepper itself, and hands you an https URL.

**It has to be a platform that keeps a container running** — Render, Railway,
Fly.io, a VM. Not Vercel or any other serverless host: the event stream is a
long-lived connection and the outbox publisher is an in-process interval, and
both stop working on a platform that freezes the process between requests,
*without raising an error*. `docs/deployment.md` explains what would have to
change first.

It will prompt you for six provider credentials, and there is no way around
that: `apps/web/src/lib/env.ts` refuses to start in production on the sandbox
payment provider or on console email and SMS, because both of those look like a
working system while quietly taking no money and printing sign-in codes into a
log file. `docs/integrations.md` says where to get each one.

### Without Docker

Requires Node 22, PostgreSQL 16 and Redis 7 already running.

```sh
npm ci
cp apps/web/.env.example apps/web/.env     # then fill in the values below
bash scripts/bootstrap-dev.sh              # databases, schema, isolation, sample data
npm run dev                                # http://localhost:3000
```

Bootstrap also writes `apps/web/.env.test` from your `.env`, pointed at
`onepass_test` — the integration suite refuses to run against any other
database. Then, from `apps/web/`:

```sh
npm test                                   # integration tests, live Postgres + Redis
npm run test:e2e                           # browser tests; see docs/engineering-reference.md §12
```

The `.env` files are deliberately **not** in this repository. Generate your own:

```sh
# ENCRYPTION_KEY — base64 for exactly 32 bytes
openssl rand -base64 32
# HASH_PEPPER — hex, 32+ bytes (sessions are opaque random tokens; there is no session secret)
openssl rand -hex 32
```

Sample accounts, created by the seed and refused in production, all share the
password `onepass-sample-password`:

| Role | Email |
|---|---|
| Consumer | `meera@example.in` |
| Partner owner | `owner@phoenix-cinemas.example` |
| Platform admin | `admin@onepass.in` |
| Security | `security@onepass.in` |

## Deploying it

`npm run dev` is for development only. Production runs the standalone bundle:

```sh
npm ci
npm run build     # next build, then the postbuild step that completes the bundle
npm start         # node apps/web/.next/standalone/apps/web/server.js
```

The server binds `0.0.0.0` and honours `PORT`, so a platform that injects a port
needs no extra configuration. A `Dockerfile` and `docker-compose.yml` are at the
root if you would rather ship a container.

**Read `docs/deployment.md` before deploying.** The application refuses to start
in production on an unsafe configuration — a sandbox payment provider, console
delivery of one-time codes, a non-https `APP_URL`, a missing pepper, or a
delivery provider whose adapter is not implemented. That is deliberate: each
refusal is a thing that would otherwise fail silently in front of real users.

You will need, and this repository cannot provide: a managed Postgres and Redis,
Razorpay live keys, and Resend plus MSG91 credentials. **Start MSG91's DLT
registration first** — it is an Indian regulatory step with days of lead time,
and sign-in codes do not send without it.

## Checks

```sh
cd apps/web
bash scripts/validate.sh   # typecheck, lint and 457 integration tests, in one pass
```

**The browser suite has to run against a production build, not `npm run dev`.**
That is not a preference. The Content Security Policy is nonce-based, and a dev
server renders every page per request so the nonce always matches — running the
suite there once hid a bug that left several pages with no JavaScript at all in
production.

```sh
npm run build
PORT=4000 SMOKE_APP_URL=https://localhost:4000 ./scripts/smoke-prod.sh &
E2E_BASE_URL=http://localhost:4000 npx playwright test     # 188 browser tests
```

The same command verifies a real deployment, which is how to check that a
release actually works:

```sh
E2E_BASE_URL=https://your-onepass-host npx playwright test
```

### Auditing a running instance

Four scripts that look for the things a test suite does not assert. Each exits
non-zero when it finds something, so any of them can gate a release.

```sh
cd apps/web
node scripts/audit.mjs        http://localhost:4000   # every route, as every persona:
                                                      # dead links, console errors,
                                                      # hydration, landmarks, overflow
node scripts/a11y.mjs         http://localhost:4000   # contrast against painted pixels,
                                                      # focus, target size, heading order
node scripts/a11y.mjs         http://localhost:4000 --theme dark
node scripts/api-audit.mjs    http://localhost:4000   # malformed, hostile and oversized
                                                      # input; leaks; rate limits
node scripts/layout-check.mjs http://localhost:4000 --width 320
```

`audit.mjs` and `a11y.mjs` reuse the sessions the browser suite mints, so run
the Playwright suite once first.

## What is real, and what is not

The project keeps a precise account of this in `docs/onepass-build-report.html`,
because the distinction matters more than the feature list. In short: identity,
consent, the pass, credential verification, the commerce layer and tenant
isolation are real and tested. Payments run on a labelled sandbox until Razorpay
keys arrive. The planner is a constraint solver and the merchant advisor is
arithmetic — no language model is connected, and no screen claims one is.

**Travel.** ONEPASS holds no air inventory. The provider adapters, the parallel
search, live price revalidation, the booking state machine, bank-offer
eligibility and the cashback ledger are written and tested. The Amadeus and
Duffel adapters are written against their published APIs and covered by unit
tests over recorded response shapes; **neither has been exercised against a live
account**, because this repository holds no credentials for either. With none
configured, `/travel` says so and returns no fares — a fare that cannot be
booked is worse than no fare. A development source serves deterministic fixtures
and is refused in production.

**AirIndex** reports the fares this deployment's own sources returned for its
own users' searches. That is a real sample and a partial one; it publishes
nothing from fewer than twelve observations, prints the sample size beside every
figure, and `/travel/airindex/quality` says exactly where the gaps are. It is
not a forecast and makes no claim to find the cheapest fare that exists.

No compliance certification is claimed. No availability or recovery figure is
quoted, because none has been measured.
