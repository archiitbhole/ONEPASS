# ONEPASS — engineering reference

How the system actually works, written so that somebody holding a bug report at
2am can find the relevant machinery without reading the whole repository first.

Every claim here was checked against the code. Where something is not built, it
says so rather than describing what it would look like if it were. Where a
design is unusual, the reason is given — an unexplained constraint is one
somebody will "fix" later.

**Companion documents.** `deployment.md` covers hosting and environment,
`operations.md` covers running it, `integrations.md` covers the outside world,
`service-conventions.md` covers the rules a new service has to follow, and
`design-system.md` covers the front end's visual language. §16 below covers
travel and AirIndex, the one subsystem that depends on suppliers ONEPASS does
not control.

---

## 1. Shape of the system

One Next.js 15 application, three audiences, one database.

```
apps/web
  src/app/(app)/…              consumer      — 42 routes, 17 of them /travel
  src/app/(auth)/…             sign in / up  — 4 routes
  src/app/(partner)/business/[orgId]/…  merchant console — 15 routes
  src/app/(admin)/control/…    platform ops  — 9 routes
  src/app/api/…                50 route handlers
  src/app/v/[ref]              public verification (no session)
  src/lib/…                    every service; no business logic in a page
  src/lib/travel/…             flight providers, search, booking, AirIndex (§16)
  src/db/…                     schema, seeds, maintenance
packages/pass                  TOTP + QR encoder, shared with mobile
mobile/                        Expo client: sign-in and the pass only
```

The rule that keeps this navigable: **a page renders, a service decides.** Pages
read and compose; anything that changes state lives in `src/lib` and is callable
from a route handler, a server action and a test alike. If you are looking for
where something is enforced, it is in `src/lib`, not in the screen.

---

## 2. Identity and sessions

### Passwords
Argon2id via `@node-rs/argon2` (`src/lib/auth/`). No pepper on passwords — the
`HASH_PEPPER` environment variable is for one-way hashing of IP addresses and
identifiers in the audit trail, not for credentials.

### Sessions
Opaque random tokens. What is stored is a **SHA-256 of the token**, never the
token, so a database dump does not yield usable sessions. The cookie is
`SESSION_COOKIE_NAME` (default `onepass_session`), HTTP-only, `Secure` in
production.

### Global revocation
`users.sessionGeneration` is an integer carried on each session. Bumping it
invalidates every session for that account at once, without a delete sweep —
this is what "sign out everywhere" and an admin suspension both use.

### One module for the request shapes
`src/lib/auth/contracts.ts` holds the zod schema for every authentication
request, plus the password policy and the shape of the sign-in reply. The route
handlers import the schemas as values; the forms import the inferred types.

This is not decoration. Three of the four authentication screens once posted a
body their endpoint could not parse — the code screen sent `email` where the
endpoint reads `destination`, the resend button did the same, and the recovery
screen omitted the `step` discriminator of a union — so **registration could not
be completed and a forgotten password could not be reset**, each failing as a
422 rendered in a red box. The routes were right, the flows were right, both
sides were tested, and nothing tested the agreement between them. Now a field
renamed on either side fails `npm run typecheck`, and
`src/lib/auth/auth-flow.test.ts` drives the real handlers with the exact bodies
the forms build.

Nothing server-only may be imported into that file: it is type-imported by
client components, which is why the password *policy* lives there while every
password *operation* stays in `password.ts`.

### Where to look when sign-in misbehaves
* 401 with "that email or password is not right" — `src/lib/auth/`.
* 429 — the limiter. `auth:login:identifier` allows 8 attempts per 15 minutes,
  `auth:login:ip` allows 20 per 5 minutes (`src/lib/ratelimit.ts`). A test suite
  that signs in repeatedly will hit this; `e2e/global-setup.ts` clears the
  windows for exactly that reason.
* Codes never arriving — delivery is `CONSOLE` unless configured, meaning they
  are printed to the server log. Production refuses to boot that way.

---

## 3. Authorization — and why 404 rather than 403

Three separate boundaries, and they do not overlap:

| Boundary | Guard | Permission family |
|---|---|---|
| Consumer | session only | `self.*` |
| Merchant | `requirePartner(permission, orgId)` — `components/partner/guard.ts` | `partner.*` |
| Platform | `requirePlatform(permission)` — `components/admin/guard.ts` | `platform.*` |

Permissions are computed **per membership** (`permissionsForRoles` in
`src/lib/authz/permissions.ts`), so one person can be an owner at one
organization and a door attendant at another.

**A refusal is a 404.** Not a 403. Being told "you may not see this" confirms
the thing exists, and a URL that confirms existence is a way to enumerate
tenants. So "not yours", "suspended", "no such organization" and "no permission"
are one indistinguishable answer.

Two consequences you will meet:

1. `notFound()` is a security mechanism here, not just a missing-page helper.
2. **Never put a `loading.tsx` above a guard.** A Suspense boundary streams,
   which sends the HTTP status before `notFound()` can change it, turning every
   refusal into a 200. This has happened once and `e2e/isolation.spec.ts` caught
   it. See `service-conventions.md`.

**The nav is never the check.** `partner/nav-items.ts` and `admin/nav-items.ts`
carry a permission per entry and the layout filters on it — but every page
authorizes again for its own work. A layout that vouched for its children would
make the children's guards optional, and optional guards rot.

### Database-level isolation
Three PostgreSQL roles plus row-level security, installed by
`src/db/isolation.sql`. **`drizzle-kit push` drops every policy it does not know
about**, so that file is re-applied after every push — not once. `isolationStatus()`
in `src/db/domains.ts` reports whether it is actually in force, and
`/control/health` renders it.

---

## 4. The pass

`packages/pass` — shared with the mobile client so there is one implementation.

* **Rotation:** RFC 6238 TOTP, 30-second step.
* **The secret** is per-pass, sealed with AES-256-GCM (`src/lib/crypto.ts`).
* **Replay defence:** a unique index on `(pass_id, org_id, counter)` in
  `pass_presentations`. Presenting the same code twice at the same organization
  in the same window violates it — the constraint is the defence, not a check.
* **The QR carries a reference, never personal data.** `packages/pass/src/qr.js`
  is an *encoder* only. There is no decoder anywhere in this repository, which is
  why the door console is built around a typed or scanned reference rather than a
  camera: a USB barcode scanner types into the field and works today.

---

## 5. Credentials and verification

The part that makes this infrastructure rather than a records table.

1. Claims are canonicalised — keys sorted, serialised as `[key, value]` pairs —
   so two machines agree byte for byte on what was signed.
2. SHA-256 of that canonical form is the claims hash.
3. The issuing organization signs the hash with **Ed25519**.
4. Verification recomputes both. Edit a claim directly in Postgres and the
   credential stops verifying.

`verifyCredential` returns an outcome, a one-sentence summary, and the list of
checks that produced it. The checks are shown even when everything passed: a
bare tick asks for trust, a list earns it.

**The proof is public.** `PublicCredentialView.proof` carries the signature, the
claims hash and the canonicalisation name, so a verifier can check it with
`node:crypto` and no network. `/v/<ref>` prints that snippet, and
`credentials.test.ts` runs it longhand rather than calling our own verifier —
importing it would prove only that we agree with ourselves.

**The limit of the claim**, stated on the page and worth repeating: a verified
result means the named issuer signed those exact claims and the credential is
not revoked or expired. It is **not** a judgement about any underlying document,
and ONEPASS makes no independent claim of legal authenticity.

---

## 6. Money

### The one rule
**The browser is never a witness to a payment.** A cart may produce many
bookings but exactly one payment, and only a signed provider callback captures
it.

```
POST /api/checkout/begin      holds capacity, opens one provider order,
                              returns publishable params only
        ↓  (the consumer pays on the provider's own surface)
POST /api/webhooks/payments   HMAC verified over raw bytes → completeCheckout
```

### Details that matter
* **Raw bytes, then verify, then parse.** Anything that re-serialises the body
  first invalidates a valid signature and can make an invalid one verify against
  whatever was reconstructed.
* **A bad signature is 400** and files a `payment.webhook.rejected` security
  event. The body and the attempted signature are deliberately not stored.
* **An unknown order is a 5xx**, on purpose. A webhook can beat the commit that
  created the transaction; answering 2xx would stop the provider retrying and
  lose a real payment.
* **Idempotent.** Capture is a conditional `UPDATE` gated on
  `INITIATED|AUTHORIZED`, so redelivery confirms nothing twice.
* **A captured sale is never unwound** by a later failure notice — that is a
  dispute or a refund, each with its own flow.
* Money is **integer minor units (paise)** everywhere. There is no float.

`failCheckout` and `abandonCheckout` share `releaseCheckout`, so the rule about
returning points lives in one place.

---

## 7. Real time

```
domain write ─┬─ row                         ] one transaction
              └─ outbox_events row           ]
                     ↓  drainOutbox(), 750ms
              ┌──────┴───────┐
        Redis pub/sub    webhook_deliveries (queued)
              ↓                    ↓  deliverDue(), same tick
      SSE /api/events/stream   partner endpoints
              ↓
      useLiveEvents → LiveRefresh → router.refresh()
```

**One rule about channels.** Webhook dispatch resolves an organization from the
event's channel and queues nothing when there is none — so an event emitted only
on `user:<id>` reaches no partner, however many have subscribed to it. Any event
type listed in `EVENT_TYPES` therefore needs an `orgChannel` emit as well as the
consumer's, with a payload written for a merchant rather than reused from the
customer's. Five events were missing that and delivered nothing to anyone;
`api-catalog.test.ts` now fails if it happens again.

**Why an outbox.** The event is written in the same transaction as the change,
so nothing can be announced that did not commit.

**Channels come from the session, never from a request.** `user:<id>`,
`org:<id>` for active memberships, and `platform` for platform staff. There is
no `?channel=` parameter, because subscribing is a read.

**Two failure modes that are silent, and both have bitten this codebase:**

1. **A dead subscription.** A Redis pattern subscription does not survive a
   reconnect, and one issued before the socket is up fails outright. The
   subscription is now armed on every `ready` and at process start, and a
   failure logs at error level. Symptom when broken: everything works, screens
   never move.
2. **A publisher that never started.** `startOutboxPublisher()` runs at module
   scope of the SSE route, and Next loads route modules lazily — an instance
   that has never served `/api/events/stream` has never started it. Watch
   `outbox.oldestUnpublishedAt` on `/control/health`. Outbound webhooks share
   this fate.

**This needs a long-running container.** Both the SSE stream and the publisher
assume a process that stays alive; on a serverless host they fail without
raising anything. See `deployment.md`.

---

## 8. Outbound webhooks

`src/lib/webhooks/` — the same contract ONEPASS demands of Razorpay, pointed
outward.

* Signed HMAC-SHA256 over `` `${timestamp}.${body}` ``, so the timestamp is
  inside the MAC and a captured request cannot be replayed later.
* The secret is **generated server-side**, shown once, and sealed at rest.
* Endpoints must be public HTTPS. Private ranges, loopback and the cloud
  metadata address are refused — otherwise "register a webhook" reads as "make
  this server POST anywhere you like, from inside our network".
  *Known limit:* the check is on the host as written, so a DNS rebind is not
  caught. Pinning the resolved address at connect time would fix it.
* Redirects are not followed: a signed payload must not chase a `Location`
  header somewhere the merchant never registered.
* Five attempts, backing off ~30s → 2m → 10m → 45m, then left failed and visible.
* A subscriber only receives events on its **own** organization's channel,
  enforced from the channel the transaction wrote.

---

## 9. Front end

Server components by default. Client components are rationed and each one
carries a comment naming the single browser API that forced it — `usePathname`
for an active nav state, `useActionState` for a form that must keep the page
under it, `EventSource` for the live stream.

* **Filter state is URL state**, in both consoles. Shareable, reloadable, works
  with no JavaScript.
* **Design system:** `globals.css` holds the palette and component classes,
  `system.css` adds depth, ambience, motion tokens and the type/space scale.
  `data-surface` on each shell picks the register — consumer, partner, control.
* **Ambient backgrounds are drawn**, not downloaded: gradients and inline SVG,
  a few hundred bytes, sharp at any density, recoloured for dark mode by the
  same tokens.
* **Motion** is the `motion` package, used only for what CSS cannot do — exit
  animations, shared layout, gestures, orchestration. Reduced motion is handled
  once, in `components/motion/primitives.tsx`.
* **Feature status is data** (`src/lib/features.ts`), so "coming soon" cannot
  drift between screens.
* **One list of destinations** (`src/components/consumer/places.ts`). The tab
  bar renders the seven entries marked `tab`; the command palette offers all
  thirty-three. Before that list existed the bar was the only index there was, and
  two thirds of the app could only be reached from a link on some other page.
* **The command palette** (`components/consumer/command-search.tsx`) opens on
  ⌘K, on `/`, and on a visible control that is present at phone width — a
  shortcut nobody can see is not a way in. Screen names are matched in the
  browser; the holder's own tickets, bookings, receipts, warranties and trips
  come from `GET /api/me/search`, which filters every query on the session's own
  `userId` and returns a title, a date and a reference — never an amount. It is
  an `ILIKE` scan bounded to one person's rows, five per source; if a history
  ever outgrows that, the answer is `pg_trgm` and an index, not a larger limit.
  The dialog is portalled to `document.body` because the topbar carries a
  `backdrop-filter`, and a filter makes its element the containing block for
  every fixed-position descendant — the same trap that keeps the tab bar a
  sibling of the header rather than a child of it.

---

## 10. PWA and offline

Registered **only** in the consumer shell — deliberately absent from the partner
and platform consoles.

`public/sw.js`:
* Cache-first for immutable assets (`/_next/static/`, icons, fonts). Any query
  string disqualifies.
* Network-first for everything else, falling back to cache, then to a
  self-contained offline document.
* **`/api/auth/*` and `/api/me/*` are never cached** — returned untouched from
  the fetch handler.
* `isStorable()` refuses anything non-200 or carrying `no-store`/`private`.
  Because every dynamic page is `no-store`, what actually settles in cache is
  the static layer.

`e2e/pwa.spec.ts` enumerates every cache entry and asserts nothing personal is
in it — that is the load-bearing test, not the manifest checks.

---

## 11. Operating it

### Health
`/control/health` reads isolation status, outbox depth and the age of the oldest
unpublished row, a Redis ping, and row counts. The numbers are read directly
rather than through the admin health API, which 500s for an unrelated reason
noted in that page's header.

### The three numbers worth watching
| Signal | Means |
|---|---|
| `outbox.oldestUnpublishedAt` climbing | the publisher is not running |
| `realtime subscribe failed` in the log | that instance delivers nothing |
| `webhook_deliveries` with a past `next_retry_at` | delivery pass is not running |

### Scheduling
**There is no scheduler in this repository.** The detectors, the sweeps and the
sample-window refresh are commands and buttons. The consoles say so rather than
implying a cron that does not exist.

---

## 12. Testing

| Layer | Where | Count |
|---|---|---|
| Integration, against a live PostgreSQL | `src/**/*.test.ts` | 373, in 25 files |
| Browser | `e2e/*.spec.ts` | 180, in 16 specs |

Integration tests share one database and run in a single process — parallel
files would interleave truncations and produce failures that look like bugs.

The browser suite is run against the **production build**, not a dev server —
`scripts/smoke-prod.sh` boots the standalone bundle and the suite is pointed at
it with `E2E_BASE_URL`. This is not a preference. A nonce-based CSP cannot fail
against `next dev`, because dev renders every page per request; running the
suite there hid a bug that left several pages with no JavaScript at all (§14).

**`travel.spec.ts` is the one exception, and the reason is a feature.** It needs
the sample flight source, and `env.ts` refuses to start a production process with
that enabled — a fixture fare that reached a checkout would be a fare somebody
paid for that no airline has any record of. So `smoke-prod.sh` sets
`TRAVEL_SAMPLE_PROVIDER=false` explicitly, a smoke run has no flight source and
correctly says so, and the travel suite runs against `next dev` instead. Nothing
it asserts is about the CSP, so nothing is lost.
`e2e/global-setup.ts` refreshes the sample window first, because the seed writes
"tonight" as a wall-clock time and a suite that passed an hour after seeding
would otherwise fail the next morning.

The tests worth reading first, because they encode the properties that matter:
`isolation.spec.ts` (tenant separation), `pwa.spec.ts` (nothing personal cached),
`payments/webhook.test.ts` (money), `webhooks/dispatch.test.ts` (SSRF and
signing), `realtime.test.ts` (the fan-out actually delivers),
`api-catalog.test.ts` (the documentation still describes this code, and every
subscribable event is actually deliverable), `csp.spec.ts` (the policy lets the
application run).
`db/isolation-present.test.ts` (the RLS policies and the consent view survived
the last schema push), `event-envelope.test.ts` (a request id reaches every
event it causes), `credentials/keys.test.ts` (rotation never invalidates what the
old key signed; revocation invalidates exactly that).

---

## 13. Known limitations

Stated plainly, because a limitation somebody discovers is worse than one they
were told about.

| Area | Limitation |
|---|---|
| Scheduling | No job runner. Sweeps and detectors are manual. |
| Hydration mismatch on `/control/*` | React #418 fires on roughly **1 load in 36** of the platform console pages, on the production bundle. React discards that subtree's server HTML and re-renders it on the client, so the visible effect is nil to a flash — but it is real and unexplained. What has been ruled out, so the next look does not repeat it: the date formatters (2,800 `en-IN` values compared between Node's ICU and Chromium — zero disagreements); any clock read on those pages or in the components they render (there are none); `LiveRefresh` or `revalidate` (not used there); concurrent writes (`audit_logs` does not grow across a page load); and browser extensions (headless Chromium, none installed). Decoding the minified args gives `fromText = false` and an **empty diff**, so it is an element-level mismatch that React could not describe. It does **not** reproduce on a dev build (24 loads clean), which is where the full message would be — so the remaining candidates from React's own list are variable input, external changing data without a snapshot, or invalid tag nesting, none of which has been found yet. |
| ESLint channel | `eslint@9.39.5` is the newest 9.x and reports as deprecated, because 9.x is the *maintenance* channel now that 10 exists. ESLint 10 is blocked here: the latest releases of `eslint-plugin-react`, `eslint-plugin-jsx-a11y` and `eslint-plugin-import` all cap at `^9`, and no `eslint-config-next@15.x` accepts 10. Moving would mean dropping the jsx-a11y rules from a product whose accessibility is a stated feature, or forcing plugins past their declared peers. Revisit when Next 16 is taken. |
| `@esbuild-kit/*` deprecation | Merged into `tsx` upstream, and still a dependency of `drizzle-kit@0.31.11`, the newest release. Dev-only, not in the shipped bundle, nothing to do here. |
| Next and postcss advisories | One moderate (next) and one high (postcss, via next) remain in the production tree. Both are fixed only by Next 16. Every other production advisory is cleared. |
| Consent expiry | A grant past `expires_at` stays `GRANTED` in the column. The gate is correct — `business_customer_view` filters on the timestamp — but the state column drifts, and no consent receipt is written for an expiry because nothing observes it. |
| Counter camera scanning | `packages/pass` is a QR *encoder*; there is no decoder in the repository, so the door and the counter take the reference or the code as text. A USB or Bluetooth scanner that types into the field works as-is. |
| API metering | Verification calls made with a key are metered. The rest of the API does not read keys, so it is not counted. |
| Loyalty config | `reward_programs` has no write path, and both the loyalty and settings screens now say so rather than pointing at an endpoint that does not exist. |
| Campaigns | A nav entry with no route and no service. Rendered disabled, with the reason on it. |
| Payments | No merchant account configured; the sandbox provider takes no money. |
| Delivery | Email and SMS print to the log until Resend/MSG91 are configured. |
| Alerting | Health is reported; nothing watches it. |
| Backups | Commands are documented; scheduling, encryption and restore testing are not done. No RPO or RTO is claimed. |
| SDKs | None. The API is plain HTTP and JSON. |
| Webhook SSRF | Host-literal check only; DNS rebinding not covered. |
| Static rendering | Nothing is prerendered. The nonce-based CSP and static HTML are mutually exclusive — see §15. |
| Time zones | `IST_OFFSET_MS` is hardcoded. Correct for India, wrong for any other market. |
| Flight providers | The Amadeus and Duffel adapters are written against the published APIs and covered by unit tests against recorded response shapes. **Neither has been exercised against a live account**, because this repository holds no credentials for either. Both are reported as needing configuration. |
| Flight cashback | Crediting is an operator command (`npm run travel:settle-cashback`), because there is no scheduler. A customer is told the date; somebody has to run it. |
| Bank offers | The eligibility engine is complete and the discount is computed server-side, but a payment provider has to report the instrument that was used before a discount can be honoured. The seeded offers are illustrative — no bank has agreed to fund them. |
| AirIndex coverage | It reports the fares this deployment's own sources returned for its own users' searches. That is a real sample and a partial one; `/travel/airindex/quality` says exactly how partial. |

### The realtime cold-start window, and the fix that closes it

`/api/events/stream` used to call `subscribe()` and announce the stream as open
in the same breath. `subscribe()` attaches a local listener immediately, but
nothing reaches that listener until the process has actually issued its Redis
`psubscribe` — so a stream opened in the first moments after a deploy could say
"open" and then miss an event published while that was still in flight.

It was narrow and it was real. The browser suite's realtime test failed exactly
once across a whole audit: on the first request to a cold process, passing on
retry and on three consecutive runs against the same warm process afterwards.

**The fix is applied.** The stream's `start` is `async` and awaits
`realtimeReady()` before it subscribes and before it sends the `stream open`
comment. `realtimeReady()` resolves when the pattern subscription is
established, and resolves immediately when no Redis is configured, so a
Postgres-only deployment pays nothing. The cost is that the stream's first
comment waits on the subscription rather than arriving instantly, which is the
right way round: an open stream that silently drops the next event is worse than
one that takes a few milliseconds longer to say it is open.

Two details that are easy to get wrong and are therefore tested:

- **The abort listener is registered before the await.** A tab closed while the
  subscription is arming is still noticed; without that, the stream would hold a
  Redis subscription and a heartbeat timer for a client that had already gone.
- **`retry: 3000` is still sent immediately.** A client that loses the
  connection during the wait needs to know when to come back.

`src/app/api/events/stream/stream-cold-start.test.ts` holds this down. It does
*not* test it by publishing an event and waiting — the subscriber is
process-wide and long since armed by the time any test runs, so that test passes
whichever order the handler uses, and a test that cannot fail on the old code
protects nothing. It makes `realtimeReady()` deliberately slow and asserts the
ordering directly: nothing claiming the stream is open appears before it
resolves. Reverse the two statements in the route and that test fails.

---

## 14. The CSP and why nothing is prerendered

`middleware.ts` sends a nonce-based Content Security Policy: every response
carries a fresh `'nonce-…'` in `script-src`, and Next stamps that same nonce
onto the script tags it renders.

A prerendered page is rendered once, at build time. Its script tags carry the
nonce from that build; every response afterwards carries a different one. The
browser compares them, finds they differ, and refuses every script on the page.

**This shipped, and stayed shipped.** `/pricing` and `/verify` had no client
JavaScript at all in a production build. The HTML was correct, the styling was
correct, the pages looked finished, and nothing anywhere said otherwise. It
survived because `next dev` renders every page per request — so the nonce always
matched wherever the tests were pointed.

There is no way for middleware to know whether the response it is decorating
came from a render or from a cache, so there is no way to send the right nonce
for a prerendered page. The choice is between a nonce-based CSP and static
prerendering. This application is session-driven and was almost entirely dynamic
already, so `export const dynamic = 'force-dynamic'` in the root layout is the
cheaper side of that trade.

Two things follow, and both matter:

* **The browser suite must run against a built server**, not `next dev`. A
  policy bug is invisible in development by construction.
* `e2e/csp.spec.ts` asserts that no page serves a script the browser refuses,
  that React actually hydrates on every page, and that two responses never reuse
  a nonce.

If static rendering is ever wanted back, the way to get it is to drop the nonce
and adopt hashes for Next's inline bootstrap — not to loosen `script-src` to
`'unsafe-inline'`, which would leave a header that looks like a defence and
is not.

---

## 15. Debugging, by symptom

| Symptom | Look at |
|---|---|
| Screens never update live | `realtime subscribe failed` in the log; outbox depth; is this instance serving SSE at all |
| Partner never receives a webhook | `webhook_deliveries.error` and `attempt`; the delivery pass runs on the same tick as the publisher |
| A payment does not complete | Was the webhook received? A 5xx there is deliberate and the provider retries |
| 404 where you expected data | A guard refused. Check the permission, the membership, and the organization's status |
| 200 where you expected 404 | Somebody added a `loading.tsx` above a guard |
| Sign-in fails for a seeded account | Was the seed re-run after `SAMPLE_PASSWORD` changed? The seed self-corrects; a stale one does not |
| Everything 404s after a schema change | `drizzle-kit push` dropped the RLS policies. Re-apply `isolation.sql` |
| Blank page with no CSS | The standalone bundle is missing `.next/static`. Run the postbuild step |
| Page looks right, nothing is clickable | Open the console. If it reads "Refused to load the script … Content Security Policy", something is being served prerendered — see §15 |
| A partner never receives one particular event type | Is it emitted on an `org:` channel? `api-catalog.test.ts` asserts every subscribable event is. Dispatch ignores `user:` channels by design |
| Production refuses to start | Read the message: it names every variable, and each refusal is deliberate |
| No flights anywhere | Almost always the intended behaviour — no provider is configured. §16 |

Every API response carries an `x-request-id`, and every error body repeats it.
That string is the fastest way from a screenshot to the log line.

---

## 16. Travel and AirIndex

The one subsystem whose inventory ONEPASS does not own. Everything else in this
product is rows this system wrote; a flight is a quote from somebody else's
computer, valid for minutes, that a customer is about to spend real money on.
That difference is what shapes every decision below.

### What was added, and what deliberately was not

Fourteen tables in `src/db/travel.ts`. What is *not* there matters more:

* **No payments table.** A flight pays through `transactions`, the same row a
  cinema seat uses, with the same idempotency key and the same signed webhook.
* **No rewards table.** Points earned on a flight are entries in `reward_ledger`.
  Two balances are two things to disagree.
* **No receipts table.** A ticketed booking issues a `receipt`, so a flight
  appears in `/receipts` beside everything else.
* **No trip table.** A trip is an `itinerary` with kind `JOURNEY`, and flights
  attach to `itinerary_items.flight_booking_id`. One planner, one `/trips`.
* **No second offers table.** `offers` prices a merchant's own capacity; a
  `flight_offer` is an external quote with an expiry in minutes. They share a
  word and almost no columns.

Airports and airlines are reference data seeded in **every** environment,
production included — they are facts about the world, not fixtures. The bank
offers and cashback rules in the seed are illustrative and are refused in
production like every other sample row.

### Providers

```
FlightProvider              src/lib/travel/providers/types.ts
  ├─ AmadeusProvider        licensed GDS channel      AMADEUS_CLIENT_ID/_SECRET
  ├─ DuffelProvider         authorised NDC aggregator DUFFEL_ACCESS_TOKEN
  └─ SampleProvider         fixtures, refused in production
```

Nine methods, each one thing. Adding a source is one file and one registry
entry; nothing else in the product knows how many there are.

**Legitimate sources only.** Every adapter talks to an API its operator is
entitled to use. Nothing here scrapes a website, works around a CAPTCHA or
reuses somebody else's session — those are not shortcuts, they are the
difference between a business and a liability.

**Neither real adapter has been run against a live account in this repository**,
because it holds no credentials for either. They are written against the
published specifications and covered by unit tests over recorded response
shapes. `knownProviders()` reports that, and so does the feature registry.

`normaliseCabin`, `decimalToMinor` and `isoDurationToMinutes` live in the shared
types file, not per adapter: a rounding difference between two providers is the
kind of bug that surfaces as a one-paisa discrepancy six weeks later.
`parseFloat('1234.55') * 100` is `123454.99999999999`, which is why money is
parsed as a string.

### The fan-out

```
searchFlights()             src/lib/travel/search.ts
  ├─ one AbortController for the whole search (1.5 × the per-provider timeout)
  ├─ Promise.allSettled — a rejection loses that provider, not the search
  ├─ merge: dedupe on carrier + flight numbers + departure minute, cheaper wins
  └─ persist: search, offers, segments, and one price observation per offer
```

Three rules it never breaks:

1. **A failure is reported, never filled in.** Each provider gets a line on the
   results page saying what it returned or why it did not answer. "Nothing cheap
   on this route" and "one of our two sources was down" look identical from
   outside, and only one is a reason to search again in a minute.
2. **Nothing is substituted.** No path in this file replaces one provider's
   fares with another's, reuses a stale result as if it were fresh, or invents
   anything.
3. **`?s=<ref>` re-renders a persisted search with no provider call.** That is
   what makes a results link shareable and the back button free; a page that
   re-queried three suppliers on every reopen would cost money on a bookmark.

### Booking, and the states that exist because they must

`src/lib/travel/booking-state.ts` holds the graph as data. Two edges are worth
knowing by heart:

* **There is no edge from `PRICE_CHANGED` to `PAYMENT_PENDING`.** When the
  airline re-quotes higher, the customer sees both figures and decides.
  "Charge the new price because they were already at the checkout" is not
  discouraged here, it is unrepresentable.
* **`BOOKING_FAILED` is not `PAYMENT_FAILED`.** One means money taken and no
  seat — a refund. The other means no money and no seat — a retry. Collapsing
  them into "error" is how a customer is told the wrong thing at the worst
  moment.

The irreversible call happens once, only out of `PAYMENT_AUTHORIZED`, with no
retry: a timeout says nothing about whether the far end finished, so the booking
fails and a person reconciles it rather than a retry producing two tickets.

Points are spent **on capture**, not at submit — a declined card must not cost
somebody their balance.

### Pricing

`priceBooking()` computes the payable amount from the booking row every time.
The request carries three things: which offer, which bank offer, how many
points. It carries no amount, and there is no parameter it could carry one in.

Every component is a named line — fare, taxes, the airline's fee, ONEPASS's fee
if there is one, seats, bags — and then each discount as its own subtraction.
There is no "other charges" line because there is nowhere in the calculation for
a charge to go without a name. The order is stated: the bank offer comes off the
fare, then points come off what is left, so a customer never spends points
against money a bank was already paying.

Cashback is quoted **beside** the total and never subtracted from it. It is
credited later, and telling somebody "you save ₹600" while charging them the
full amount is misleading even when the ₹600 eventually arrives.

### Cashback

`PENDING → APPROVED → CREDITED`, with `REVERSED` and `EXPIRED` as the two ways
it ends unpaid. Credited only once the airline's cancellation window closes,
because a ticket cancelled after payout is money given away for a journey nobody
took.

Double-crediting is impossible rather than unlikely: a unique index on
`(booking_id, rule_id)`, and an idempotency key on the ledger entry derived from
the cashback row's own id. A row that says `CREDITED` carries the
`reward_ledger_id` that proves it. Reversal of credited cashback is a
compensating entry, never an edit — the ledger is append-only.

### AirIndex

One table: `flight_price_observations`, one row per offer per search, priced
per passenger. Every figure AirIndex publishes is an aggregate over it computed
at read time. There is no score table, no nightly job writing conclusions, and
no number anybody can type in.

```
Fare Index = (median of the last 7 days ÷ median of the 90 days before them) × 100
```

The reference window **excludes** the current one. Including it would let a week
of high fares raise the baseline it is measured against, damping exactly the
signal the index exists to show — `airindex.test.ts` asserts this specifically.

Medians rather than means, computed with `percentile_cont`: one business fare on
a budget route moves a mean a long way and a median not at all. Below
`MIN_SAMPLE` (12) nothing is published at all — not a faded figure, not an
estimate. Sample size appears beside every number, and
`/travel/airindex/methodology` states the whole method including what it cannot
support.

`db.execute` bypasses Drizzle's column mappers, so every raw query here runs its
timestamps through `toDate()` and its numerics through `toMinor()`. A `Date`
method called on a string fails at the render rather than at the query, which is
a long way from the mistake.

### Where to look

| Symptom | Look at |
|---|---|
| No fares at all | `knownProviders()` — is anything configured? `/travel` says so on the page |
| One source always missing | `flight_provider_events` for its result codes; the circuit breaker rests a provider after four consecutive failures |
| A price changed at checkout | That is the design. `revalidateBooking()` wrote both figures to the booking row |
| Money taken, no ticket | `BOOKING_FAILED` with `failure_code`. A refund is owed and is an operator action |
| Cashback never arrives | There is no scheduler. `npm run travel:settle-cashback` |
| AirIndex shows nothing for a route | Fewer than 12 observations. `/travel/airindex/quality` lists every route below the threshold |
| A figure looks wrong | `/travel/airindex/observations` and the CSV export are the rows it was computed from |

---

## 17. Foundations: events, keys, step-up, disclosure, ownership, transfer

Decisions live in `.claude/onepass-decisions.md` (D-004 … D-013); status in
`.claude/onepass-feature-registry.md`. This section is where to look.

### The event envelope (D-004)
Every `outbox_events` row carries `schema_version`, `correlation_id`,
`causation_id`, `actor`, `tenant_id` and `privacy_classification`. The
correlation id is the request's `x-request-id`, taken from a request context
(`src/lib/request-context.ts`) that `route()` opens — no emit site passes it.
Outside a request (workers, seeds) it is `null`, not invented.
`EVENT_CLASSIFICATION` in `src/lib/audit.ts` is typed as total over the event
types, so a new event cannot be added without deciding who may see it;
`SECRET` is refused at emit. A caller-supplied `x-request-id` is accepted only
if it matches `[A-Za-z0-9._:-]{1,40}`.

### Issuer keys and rotation (D-005)
`issuer_keys` holds every version of an organization's Ed25519 key. A
credential records `issuer_key_id`; verification resolves **that** key. Rotate
(`POST /api/partner/{org}/signing-keys`) → the old key is RETIRED, still
verifies, and its private half is destroyed. Revoke
(`…/signing-keys/{keyId}/revoke`) → everything it signed fails with the date,
and a HIGH security event is raised. Keys that predate the registry (on the
`organizations` row) are adopted as `v1` the first time they sign or verify.
Public keys: `GET /api/v1/issuers/{slug}/keys`. Owner-only, elevated,
rate-limited per organization.

### Step-up (AUTH-003)
Until `POST /api/auth/step-up` existed, a session was elevated only at sign-in,
and after `SESSION_ELEVATION_MINUTES` every elevated action returned
`REAUTH_REQUIRED` with nowhere to confirm the password. `useStepUp()` in
`components/auth/step-up.tsx` catches that error, asks for the password, and
re-sends the same request. Per-user limit `auth:step-up`; attempts land in the
security timeline as `STEP_UP_SUCCEEDED` / `STEP_UP_FAILED`.

### Disclosure receipts (D-006)
`disclosure_receipts` records every time something about a person reached a
third party: the partner customer list (from what `business_customer_view`
actually returned) and credential verification (claim **names**, for any
verdict that returned the credential). Values are never stored. Identical
disclosures within an hour are recorded once. The holder reads them at
`/disclosures` and `GET /api/me/disclosures`. This module records decisions;
it does not make them — the view and `verifyCredential` do.

### Ownership (D-007)
A receipt line with a warranty or a serial (or `ownable: true`) becomes
`product_instances` rows, one per unit, owned by the buyer, in the same
transaction as the receipt. Transfer is by an 80-bit code shown once (hash
stored), claimed from the recipient's account; the row is locked, so one code
yields one owner. A warranty moves only if the merchant declared it
`transferable`. After a transfer the seller keeps their receipt but can no
longer return the item against it. `npm run products:backfill` creates
instances for older receipts.

### Counter sales (D-010)

A merchant issuing a receipt for goods sold across a shop counter. Everything
that *writes* one already existed — `issueReceipt` writes the receipt, its lines,
the warranties they carry and the product instances they create in one
transaction, and refuses a supplied total that disagrees with the computed one.
What was missing was the step before: who is buying.

The answer is a pass presentation, not a customer search. A search turns every
till into a browsable directory of the shop's customers and proves nothing about
who is standing there, which matters because a receipt creates a warranty the
shop owes and transfers ownership of goods. `verifyPresentation` — written since
the beginning and, until this, with no caller anywhere in the repository — checks
the envelope, the signature, the freshness and the replay, and refuses anything
without an **active connection to that organization**.

The verification is carried forward by `presentationId`, so no user id reaches a
browser. It stays usable for `COUNTER_WINDOW_MINUTES` (15) so staff can ring up a
basket, and is re-resolved at the write, where the tenant filter, the
acceptance filter, the window and the connection state are all re-applied — a
*rejected* presentation is a row too, so the acceptance filter is load-bearing.

`POST /api/partner/{org}/pass/verify` answers a rejection as **200 with
`ok: false`**, not an error status: it is a verdict a till renders next to the
field, and an error status would land it in a catch block and read to staff as a
network fault. `POST /api/partner/{org}/receipts` has no `userId` field and the
body is strict, so sending one is a 422. The console at
`/business/{org}/counter` prices the basket with the receipt service's own
`computeReceiptTotals`, shows that figure, and sends it back as `totalMinor` so
the write refuses if the price moved between the screen and the receipt.

No money moves through any of it. It moved at the merchant's terminal;
`paymentLabel` is a label, not a claim that the platform observed a payment.

### Ticket transfer (D-011)

`TRANSFERRED` had been in the ticket state enum since the beginning and the door
had always refused it. Nothing ever set it.

A claim marks the sender's ticket `TRANSFERRED` and writes the claimant a **new**
ticket with a new reference. Moving `tickets.user_id` instead would be sharing:
the reference is printed under the QR and is what the door reads, so the sender's
screenshot would keep working and whoever arrived second would be turned away.
Same booking on the new row, because the venue's reconciliation has to keep
finding the seat where it was sold — the booking, the payment and the receipt stay
with whoever bought them, and both parties are told so.

The code mechanics are the product transfer's, reused rather than reinvented: 80
bits from an alphabet with no look-alikes, shown once, only the hash stored, one
live offer per ticket by a partial unique index. Two differences: the offer lives
48 hours rather than seven days and never past the ticket's own validity, because
a code that outlives the show is a code somebody claims into a seat already sat
in.

### Two bugs in the transfer pattern, both found late (D-013)

Worth stating because both were in shipped code and neither was reachable by the
tests that existed.

**A refusal thrown inside a transaction rolls back its own bookkeeping.**
`claimTransfer` closed a dead offer and then threw to report it — so the close
went with the rollback, an expired code sat `PENDING` forever, and it blocked a
fresh code for an item nobody could claim. Both claim paths now return the
refusal from the transaction and close the row outside it.

**Opposite lock orders deadlock.** Offering locks the item then expires a stale
offer row; claiming locked the offer then wanted the item. A claim of an expired
code concurrent with a fresh offer on the same item is a cycle, and Postgres
resolves it by aborting one — a 500, which is what `scripts/api-audit.mjs` exists
to refuse. Both claim paths now lock the item first, reading the id unlocked
beforehand and re-reading the offer under lock.

### Consent receipts (D-012)

`consent_receipts` records what somebody agreed to, in the words they agreed to.
Not a second copy of `consent_grants`: a grant points at a `consent_version`,
whose `body_text` is frozen — and stops there. The label, the description, the
field list and the sensitivity flag live on `consent_definitions`, which is
mutable, and those are the parts a person reads. Editing a definition silently
rewrote every past agreement, including on `/profile`.

A receipt snapshots all of it at the moment of the act, plus the organization's
own name, and carries a `cns_…` reference the person can quote — an internal ULID
is not something to put in an email to a shop or a regulator. Field *names*
only, never values, the same rule disclosure receipts follow.

Written on grant and on revoke, inside the transaction that made the change.
**Not on expiry**: nothing sweeps the table and `business_customer_view` gates on
`expires_at > now()` rather than the state column, so no moment exists to write
one at. `consent-receipts.test.ts` edits a definition after the grant and asserts
the receipt did not move with it. `/disclosures` renders the history;
`/profile` now says it shows permissions as they stand *today* and links to what
was agreed, because those are two different questions.

### Reading a driver error (and not reading its parameters)

Two rules here are enforced by a unique index and caught rather than checked
first — the pass replay check, and the offer redemption cap — because an
application check passes twice under concurrency and a constraint does not. That
only works if the catch can tell which violation it caught.

`drizzle-orm` 0.45 changed where that answer lives. The thrown object is a
`DrizzleQueryError` whose message is `Failed query: …` and whose `code` is
`undefined`; the real `PostgresError`, with its `code` and `constraint_name`,
moved to `cause`. Both call sites broke on the upgrade — one matched the driver's
prose, the other read `err.code`. Matching by SQLSTATE was already the right
idea and it still broke, because *where* the driver puts the code is the driver's
business.

`src/db/errors.ts` walks the cause chain instead of trusting a shape:

- `isUniqueViolation(err, constraint?)` — pass the constraint name wherever the
  surrounding code can only handle that one collision, so a different index's
  complaint is not answered with a polite sentence about something else;
- `describeDbError(err)` — for log lines. The new driver message includes the
  **bound parameters**, so logging `err.message` verbatim would write real
  values (an email address, a phone number) into log files that nobody thinks of
  as holding personal data. This returns the SQLSTATE, the constraint and the
  driver's short reason, and nothing else. Used by the audit write, the
  auth-event write, api metering and cashback settlement — the places that log a
  failure they deliberately do not let fail the request.

`src/db/errors.test.ts` provokes real violations against a real database. A
hand-built `{ code: '23505' }` would agree with whatever the helper currently
believes, which is exactly the thing that changed, and would not have caught
either regression.

### `npm run db:push` re-applies the isolation layer
`drizzle-kit push` removes what `schema.ts` does not declare — which includes
every row-level-security policy and `business_customer_view`, because those live
in `src/db/isolation.sql`. Measured: 34 policies before a bare push, 0 after.
`db:push` is now `scripts/db-push.mjs`: push, then re-apply `isolation.sql`,
then refuse to report success unless policies and the view exist.
`src/db/isolation-present.test.ts` fails any database that lacks them.
**Never run `npx drizzle-kit push` directly against a real database.**
