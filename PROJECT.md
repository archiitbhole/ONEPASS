# ONEPASS — project brief

**Purpose of this file.** Hand this to Claude at the start of a session and it
knows the project without re-deriving it: what ONEPASS is, how it is built, what
may never be broken, how it is verified, and what is genuinely unfinished. Then
write your prompt on top of it.

Accurate as of the commit that last changed this file (`git log -1 --
PROJECT.md` names it). Where this file says a number, the number came from the
repository rather than from memory; where it says something is missing, it is
missing.

**Working state lives in `.claude/`.** Four files carry the project between
sessions and are kept current as work lands:

| File | What it holds |
|---|---|
| `.claude/onepass-current-state.md` | Where things stand, last verification numbers, honest gaps, next slice. **Read first.** |
| `.claude/onepass-feature-registry.md` | All 158 master-backlog features by ID (TRUST-009, PRIV-003, …) with an evidence-based status and the test that proves it |
| `.claude/onepass-decisions.md` | Decisions D-001 … D-009 and why — event envelope, key versions, disclosure receipts, ownership, status vocabulary |
| `.claude/onepass-project-map.md` | Architecture, the one canonical module per capability, entities, integration boundaries |

What has been built so far, phase by phase, is ticked off in §12.

A prompt can name registry IDs directly — "take TICKET-002 to LIVE" — and the
status vocabulary is fixed: LIVE · NEEDS_CONFIG · PARTNER_REQUIRED · LIMITED ·
DEMO_ONLY · BLOCKED · NOT_STARTED. Nothing is promoted without a test.

---

## 1. What ONEPASS is

India's universal physical-commerce identity, loyalty and intelligence layer.
One account that a person carries into hotels, cinemas, restaurants, shops and
airports: one pass to prove who they are, one wallet of points and savings, one
place their tickets, bookings, receipts and warranties live, and one set of
consents controlling what any merchant ever sees about them.

Three audiences, three consoles, one codebase:

| Audience | Shell | What they do |
|---|---|---|
| **Consumer** | `(app)` | Hold a pass, book, pay, collect receipts and warranties, fly, claim cashback |
| **Partner** (merchant) | `(partner)` | Take bookings, admit ticket-holders, issue credentials, run offers, read insights |
| **Platform** (ONEPASS staff) | `(admin)`, served at `/control` | Approve organizations, investigate security events, support tickets, audit |

Plus a **public** surface — landing, pricing, credential verification at
`/v/<ref>`, and a developer platform at `/developers` with a live endpoint
explorer.

**Travel and AirIndex** is the newest vertical: flight search across
replaceable provider adapters, server-computed pricing, a 14-state booking
machine, bank-offer eligibility, a cashback ledger, and AirIndex — a fare index
built from observed prices (`Fare Index = current normalised fare / reference
fare × 100`).

**The trust foundations** are the newest layer underneath everything:

- **One event envelope.** Every event carries a schema version, the request's
  correlation id (the `x-request-id` a person can quote to support), the
  causing event, the actor, the tenant and a privacy classification. A secret
  can never be emitted as an event.
- **Versioned issuer keys.** A partner can rotate its signing key; credentials
  signed by the old key keep verifying and say which key signed them. Revoking a
  key fails exactly what it signed. Every version is published at
  `/api/v1/issuers/<slug>/keys`.
- **Step-up.** Sensitive actions ask for the password again, in place, and then
  finish — rather than dead-ending once the sign-in elevation has lapsed.
- **Disclosure receipts.** When a partner sees a person's data, the person gets
  a record of who, when, which fields (names, never values) and on what basis,
  at `/disclosures`.
- **Product ownership.** A receipt line for a durable good becomes an owned
  item at `/products`. It can be given or sold with a one-time code; a
  transferable warranty goes with it, and the seller can no longer return what
  they no longer own.

---

## 2. How to prompt this project

Assume these are already agreed; you do not need to repeat them each time.

**Say what you want to be true, not which file to edit.** The codebase has
strong conventions (§6) and they are enforced by tests. "Bookings should be
cancellable by the person who made them" is a better prompt than "add a POST to
bookings/[ref]/route.ts".

**Everything is verified before it is called done.** The standing bar is: the
change typechecks, lints, has a test that would have failed before it, passes
the whole suite, and — for anything with a screen — is looked at in a browser at
390px and at desktop width, in both themes. Do not ask for this; assume it.

**Honesty is a hard constraint, not a style.** See §5. A feature that needs a
credential this deployment does not hold is `NEEDS_CONFIG`, never `LIVE`.
Nothing claims to be tested on a platform it was not tested on. No invented
deployment URLs.

**Useful shapes for a prompt:**

- *Fix:* "X is broken — when I do A, B happens. Prove it, fix it, and add the
  test that would have caught it."
- *Build:* "Add <capability> to <audience>. Here is what a person should be able
  to do end to end: … Respect the existing <ledger/state machine/consent model>
  rather than adding a parallel one."
- *Audit:* "Go through <area> looking for <class of problem>. Report what you
  find with evidence before changing anything."
- *Harden:* "Assume <endpoint> is on the public internet. Throw bad input at it
  and tell me what happens."

---

## 3. Repository map

```
onepass-platform/
├─ apps/web/                    the whole product — Next.js 15 App Router
│  ├─ src/app/
│  │  ├─ (app)/                 consumer shell — 33 destinations, 44 page files
│  │  ├─ (partner)/             merchant console
│  │  ├─ (admin)/control/       platform console
│  │  ├─ (auth)/                sign-in, sign-up, verify-code, recover
│  │  ├─ page.tsx, pricing/,    landing, pricing, credential verification,
│  │  │  verify/, v/[ref]/,     the developer platform, the offline fallback
│  │  │  developers/, offline/
│  │  ├─ api/                   60 route handlers
│  │  ├─ globals.css            palette, component classes
│  │  └─ system.css             depth, ambience, motion, type and space scale
│  ├─ src/db/                   Drizzle schema (94 tables) + seeds; isolation.sql
│  │                            holds the RLS policies and the consent view
│  ├─ src/lib/                  the domain: auth, authz, payments, commerce,
│  │                            travel, credentials, products, privacy,
│  │                            webhooks, realtime, request-context, …
│  ├─ src/components/           consumer/, partner/, admin/, travel/, auth/, ui
│  ├─ src/test/factories.ts     integration-test fixtures
│  ├─ e2e/                      16 Playwright specs
│  └─ scripts/                  db-push.mjs, a11y.mjs, api-audit.mjs,
│                               csp-check.mjs, audit.mjs, smoke-prod.sh,
│                               postbuild.mjs
├─ packages/pass/               the pass primitive: TOTP + QR, shared with mobile
├─ mobile/                      an Expo shell that shows the pass. Small.
├─ docs/                        engineering-reference.md is the one to read
├─ .claude/                     the four state files (§ top of this file)
├─ .github/workflows/           ci.yml, security.yml (secret scanning)
├─ render.yaml, Dockerfile, docker-compose.yml
└─ .env.example                 every variable, with what it is for
```

`docs/engineering-reference.md` is the deep reference — architecture, the 404
doctrine, money rules, the CSP, known limitations, travel. `docs/route-audit.md`
is an honest per-route assessment: UI status and functional status kept
separate, so a beautiful screen over a dead table cannot hide.

---

## 4. Stack and the decisions that are load-bearing

- **Next.js 15 App Router, React 19, TypeScript strict** with
  `noUncheckedIndexedAccess`. Server components by default; every client
  component carries a comment naming the one browser API that forced it.
- **PostgreSQL 16 + Drizzle ORM** (`postgres`/porsager driver). Schema changes
  go through **`npm run db:push`** — a wrapper around `drizzle-kit push` that
  re-applies `src/db/isolation.sql` afterwards and checks it landed. **Never
  run `npx drizzle-kit push` directly against a real database:** it drops the
  RLS policies and the consent-enforcing view, because Drizzle does not know
  about them. `db/isolation-present.test.ts` fails if that ever happens.
- **Redis 7** (ioredis) for rate limits, caches and the realtime fan-out.
- **Argon2id** for passwords (19 MiB, 2 passes). Sessions are opaque random
  tokens; only a **SHA-256 of the token** is stored.
- **ULIDs** as primary keys, with a separate random `publicRef` for anything a
  URL or a human ever sees.
- **RBAC per membership + PostgreSQL RLS.** An unauthorized resource answers
  **404, never 403** — a 403 confirms the thing exists. (A *member* who lacks a
  permission gets 403: they already know the organization exists.)
- **Every request runs inside a request context** (AsyncLocalStorage, opened
  by `route()`), which is how a correlation id and an actor reach every event
  without being threaded through each call.
- **Money is integer minor units (paise).** No floats, ever. `Asia/Kolkata`,
  `en-IN`.
- **Nonce-based CSP with `strict-dynamic`**, which is mutually exclusive with
  static prerendering; the root layout is `force-dynamic`. This is why the
  browser suite runs against the **production build** rather than `next dev`.
- **Transactional outbox → Redis pub/sub → SSE** for realtime; webhook dispatch
  reads only organization channels.
- Build output is `standalone`; `postbuild.mjs` copies static assets and strips
  any `.env` from the bundle.

---

## 5. The invariants — what may never be broken

These are not preferences. A change that violates one is wrong even if it
passes.

**Secrets and credentials**
- ONEPASS is not a plaintext vault. Never store raw passwords, OTPs, card
  numbers, CVVs, banking passwords, UPI PINs, or payment credentials.
- Never store a CVV or a UPI PIN at all. Never log an authentication secret, a
  password, or an OTP value. Never return an OTP in an API response.
- Never hardcode API keys, JWT secrets, database passwords, encryption keys,
  OAuth secrets or payment secrets. Never commit them. Never put a server secret
  in client code or a public env var. Encryption keys are not in source control.
- If an integration needs a credential, build it properly and name the exact
  environment variable required — never substitute a fake implementation because
  a credential is missing.

**Money and payments**
- Never trust `paymentSuccess=true` from a browser. The server decides, from the
  provider's webhook.
- The final amount is computed **server-side**. Never advertise a low price and
  reveal mandatory charges later. Never silently charge a different amount.
- Never claim a discount was applied unless the payment system applied it. Never
  credit cashback twice — the ledger has a unique index that makes it impossible.

**Privacy and authorization**
- A QR code does not carry personal information by default.
- Never expose unnecessary personal information to a merchant. No
  arbitrary-user endpoints (`GET /api/users/:id/data`) for ordinary consumers.
- Frontend filters are not security. Do not weaken a route guard, bypass a
  permission check, or move sensitive logic into the client.

**Honesty**
- Do not claim "100% secure", "fully government compliant", "PCI compliant",
  "bank-grade", or specific RPO/RTO values unless objectively verified and
  configured.
- Do not label deterministic logic as AI. If no LLM is connected, no feature is
  "AI-powered".
- Do not pretend a payment, booking, NFC tap, integration or deployment happened
  when it did not. Do not invent a URL. Do not say an app is published before it
  has been submitted.
- Never write "tested on iOS" or "Play Store compatible" without having done it.

**Structure**
- **One canonical source of truth per capability.** Never create `AuthV2`,
  `WalletV2`, `PaymentV2`, `BookingV2`, `AdminV2`. Extend what exists.
- Do not delete the existing application or its branding to make room for
  something new.

**Travel specifically**
- No bypassing CAPTCHA, bot protection, rate limits or terms of service. No
  unauthorized credentials. No fabricated inventory.
- In production: no fake flights, availability, fares, confirmations, payments,
  rewards, cashback or discounts. Never silently swap a failed live provider for
  fixtures, and never silently switch production into demo mode — the sample
  provider is refused at boot.
- Never claim "all airlines", "all OTAs", "100% accurate" or "guaranteed
  cheapest". Never claim a provider works without having tested it.

---

## 6. Conventions new code is held to

- **Route handlers** go through `route()` (`src/lib/api.ts`), which applies body
  size limits, zod validation, rate limits, the Origin/CSRF check and the error
  envelope. Handlers do not re-implement any of it.
- **Authorization** is `authorize({ permission, actor })`. Permissions are named
  in `src/lib/authz/permissions.ts`. Refusal is 404. A permission marked
  elevated answers `REQUIRES_ELEVATION`; forms handle it with `useStepUp()`
  (`src/components/auth/step-up.tsx`), never by weakening the check.
- **Events** go through `emitEvent` (`src/lib/audit.ts`). Every event type has a
  classification in `EVENT_CLASSIFICATION`, and the compiler refuses a new type
  without one.
- **Disclosure is receipted where it happens.** Code that shows a partner a
  person's data calls `recordDisclosures` (`src/lib/privacy/disclosures.ts`).
- **Anything transferable uses the ownership pattern** (D-007): one owner
  column, a hashed one-time code, row locks, one pending transfer per item.
- **Request shapes for authentication live in `src/lib/auth/contracts.ts`** —
  routes import the schemas as values, forms import the inferred types, so a
  renamed field fails `npm run typecheck` rather than failing in front of a
  person. (This module exists because it once did fail in front of a person; see
  §9.)
- **Rate limits are declared in `src/lib/ratelimit.ts`**, one named budget per
  concern. Tests never disable the limiter — `e2e/global-setup.ts` clears the
  windows instead.
- **Feature status is data** (`src/lib/features.ts`), so "coming soon" cannot
  drift between screens.
- **Consumer destinations live once**, in `src/components/consumer/places.ts`.
  The tab bar renders the seven marked `tab`; the command palette offers all 33.
- **Comments explain why, not what.** The codebase is written to be read; a
  comment that restates the line above it is noise, a comment recording the bug
  a line prevents is the point.
- **Dates and money are formatted at the edge**, never stored formatted.

---

## 7. How it is verified

From `apps/web/`:

| Command | What it proves |
|---|---|
| `npm run typecheck` | 0 errors, strict |
| `npm run lint` | 0 warnings |
| `npm test` | **457 integration tests** in 33 files, against a live Postgres + Redis |
| `npm run test:e2e` | **188 browser tests** in 17 specs (Playwright) |
| `node scripts/a11y.mjs <url> [--theme dark]` | 31 pages, contrast, target size, focus, landmarks |
| `node scripts/api-audit.mjs <url>` | 57 checks: bad input at every endpoint, no 500s, no leaks |
| `node scripts/csp-check.mjs <url>` | the policy actually lets the app run |
| `node scripts/audit.mjs <url> --width 390` | crawl for dead links, overflow, placeholders |
| `node scripts/responsive-check.mjs <url>` | 56 routes × 5 widths (320–1920), horizontal overflow |
| `node scripts/ui-shots.mjs <dir> <url> <spec>` | screenshots at given widths and themes, for review |
| `node scripts/drive.mjs <steps> [url]` | walks a flow in the browser, for screens that need real data |
| `bash scripts/smoke-prod.sh` | boots the built standalone bundle in production mode |

**The browser suite runs against the production build**, not the dev server —
a nonce-based CSP cannot fail against `next dev`, and running it there once hid
a bug that left several pages with no JavaScript at all. `e2e/travel.spec.ts`
skips itself when no flight source is connected, which is the case on a
production build (the sample source is refused outside development, correctly);
run it against `next dev` to exercise the travel journey.

Current state: all of the above pass. On the production bundle, **162 browser
tests pass and 26 skip** for the reason above. Accessibility reports **zero
keyboard, target-size and measurable-contrast findings across 31 pages in both
themes**; what remains is 52 light / 11 dark entries in an *undetermined*
bucket — text over a gradient, where no static check can know which stop a
glyph sits over. Those were measured from the painted pixels instead
(5.55–8.08:1 on the printed-stock objects, 4.62:1 at worst on the pass,
5.18:1 light and 6.61:1 dark on the counter's eyebrow) and by eye at both
themes. The responsive sweep reports **no horizontal overflow at any of 280
page-widths**.

**Local services:** `service postgresql start` and `redis-server --daemonize
yes`. Then `bash scripts/bootstrap-dev.sh` from the repository root: it
creates both databases, writes `apps/web/.env.test` from `.env`, pushes the
schema through the wrapper, seeds the sample data and the sample credential,
and anchors the sample window to today. On a database that predates product
ownership, also run `npm run products:backfill` once. The sample account is
`meera@example.in`.

---

## 8. Current state

**Working end to end:** identity and sessions, step-up re-authentication, the
rotating pass, credential issuance and public verification with versioned and
rotatable issuer keys, bookings and tickets (including passing a ticket to somebody else), receipts — issued on payment
capture for an in-app sale, and at the till for a counter sale, against a pass
the buyer presented — warranties, returns, product ownership and transfer, disclosure history, points
and savings ledgers, gifts, bill splitting, city passes, quests, the day
planner, the partner console (door admission, counter sales, offers, insights,
developer keys, webhooks, signing-key rotation), the platform console (approvals, security
events, support, audit), the developer platform, realtime SSE with a canonical
event envelope, PWA and offline tickets, and the travel vertical including
AirIndex.

By the registry's count, **18 of 158** master-backlog features are LIVE, 64
LIMITED (a real subset works and the gap is named), 2 NEEDS_CONFIG and 74
NOT_STARTED — including the whole agent layer, which has no model connected
and claims none.

**`NEEDS_CONFIG` — implemented, inert without a credential:** payments
(Razorpay), email (Resend), SMS (MSG91), and both real flight providers
(Amadeus, Duffel). The adapters are complete; neither flight adapter has ever
been run against a live account, because this repository holds no credentials.
That is stated rather than glossed. The variables, as named in
`apps/web/.env.example`, set in the host's secret store and never committed:

| Capability | Variables |
|---|---|
| Payments | `PAYMENT_PROVIDER=RAZORPAY`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` |
| Email | `EMAIL_PROVIDER=RESEND`, `RESEND_API_KEY`, `EMAIL_FROM` |
| SMS | `SMS_PROVIDER=MSG91`, `MSG91_AUTH_KEY`, `MSG91_SENDER_ID` |
| Flights | `AMADEUS_CLIENT_ID`, `AMADEUS_CLIENT_SECRET`, `AMADEUS_ENVIRONMENT`; `DUFFEL_ACCESS_TOKEN` |

**Deployment:** blocked. There is no reachable hosting from the build sandbox
and no Vercel configuration in the repository (it carries `render.yaml`). No URL
has been invented.

**Mobile:** `mobile/` is a small Expo shell that displays the pass. It has not
been submitted to any store.

---

## 9. What was built most recently, and what it taught

**The most recent round was COMMERCE-001: receipts for counter sales.** The
product had a shape of hole in it that nobody could see from inside a working
tree. A purchase made *in the app* produced a receipt, a warranty and an owned
product. The identical purchase made two metres away at the shop counter
produced a paper slip the platform never heard about — so warranty and
ownership, two of the things ONEPASS is for, were quietly conditional on how
you happened to pay.

The write side already existed in full. `issueReceipt` wrote the receipt, its
lines, the warranties they carry and the product instances they create in one
transaction, and refused a caller's total that disagreed with the computed one.
What was missing was the step before it: a merchant at a till had no way to say
*who* was buying.

**The answer is a pass presentation, not a customer search.** The shortcut —
let staff pick a name from their customer list — is wrong twice: it turns every
counter into a browsable directory of the shop's customers, readable by whoever
is on shift, and it proves nothing about who is standing there, which matters
because a receipt creates a warranty the shop owes and transfers ownership of
goods. A presentation proves both. `verifyPresentation` had always been able to
answer it and, it turned out, had no caller anywhere in the repository; it now
has two, and the verification is carried forward by *id*, so the buyer's
platform identity never reaches a browser.

What that turned up, in the order it was found:

- **A disabled fieldset is not a read-only fieldset.** Locking the basket while
  the operator reviewed the price used `disabled`, and a disabled control is
  left out of the submission entirely — so pressing *Issue receipt* posted an
  empty sale. Nothing caught it but the browser suite: every unit test called
  the action with a FormData it had built itself. It is `hidden` now, and the
  reviewed total travels with the submission as `issueReceipt`'s own
  cross-check, so the price on the button is the price written or nothing is
  written at all.
- **`[hidden]` is the weakest rule in the cascade.** Having switched to it,
  `.grid { display: grid }` beat it and one fieldset stayed on screen while the
  markup said it was gone — a control invisible to the author and present to
  everyone else. `base.css` now settles it globally.
- **Checkboxes were 18×18 against WCAG 2.5.8's 24×24.** Found by putting the
  first partner console page into the accessibility list, which had until now
  audited only consumer screens and `/control`. Fixed globally, not on this
  page.
- **A rejected presentation is a row too.** The audit trail keeps failed scans,
  so the acceptance filter in `resolveCounterBuyer` is load-bearing: without it
  a till could cite a *refused* scan and write a receipt against a pass that
  never verified. Its test was first written in a way that passed with the
  filter removed — the fixture had no connection either — and was rewritten to
  fail without it, then checked by removing it.
- **The browser spec raced the replay guard.** Two tests inside one 30-second
  window get the same code, and the second is correctly refused. Remembering
  the spent code in a module variable did not survive Playwright's retries, so
  the spec asks Postgres whether that presentation exists and waits for the
  window to roll — which is what a member of staff does when the till says
  "already used".

**The lesson this round: the tests you write from the inside share your
assumptions.** Three of the five defects above were in code with passing unit
tests, and were found only by a browser actually submitting a form. A form is
not its FormData, and building the FormData yourself tests the half you already
understood.

---

## 9a. The round before

**The design round: every screen in the product moved onto Intaglio** (`docs/design-system.md`) — the brand config, the token layer,
the printed objects, the two console registers. It was not a restyle. The rule
it was carried out under was that a beautiful screen over broken functionality
is not finished, so each surface was rebuilt against what its backend actually
does, and what the backend does not do is now said on the screen rather than
implied away.

What that turned up, in the order it was found:

- **Notification links pointed at three screens that do not exist.** `/app/account`,
  `/app/consents` and `/app/privacy` were written into rows by the account,
  consent and export services. The rows cannot be edited retrospectively — a
  notification is a record of what was said — so `safeLinkPath` redirects the
  old prefixes and the services were corrected.
- **A one-way trip hid the cabin selector.** The rule said `:nth-child(4)` and
  matched the fourth child of both search grids. A rule about one field
  addresses that field by name now.
- **A module-level counter was incremented during render.** `SplitForm`
  numbered new rows from it: one counter shared by every request the server
  process handles, and a different one in the browser, so the form hydrated
  with mismatched `id` and `htmlFor`.
- **`Stat tone="value"` set the whole card in the figure's face**, because
  `.stat-value` was both the tone class and the class of the figure inside it.
- **Five console screens wrote their grid columns inline**, two with a pixel
  minimum that cannot collapse — which left the door console's second column
  22px wide on a phone. `.split` replaced all five.
- **The accessibility audit was reporting 44 findings that were not real.** Its
  contrast check walked ancestors for a `background-color`, and every object in
  this system paints with a gradient, whose background colour is `transparent`;
  it sailed past them and reported white text on a dark pass as white on cream.
  It reads gradients now and reports text over one as *undetermined with a
  range*, because which stop a glyph sits over is not something a static check
  can know — and a check that calls that a failure hides the real ones.
- **Four browser tests were asserting on markup rather than on behaviour**, so
  they failed when the markup changed while the guarantee did not. Each now
  addresses the thing by its accessible name or its object class.

**The lesson this round: a check that cries wolf is worse than no check.** The
44 false contrast findings had been there long enough to be scrolled past, and
the six real ones underneath them were invisible for exactly as long.

---

## 9b. Two rounds before

That round took the four foundations in §1 from nothing to LIVE, in
dependency order — event envelope, then issuer keys and step-up, then
disclosure receipts, then product ownership — each with its own tests and the
registry updated only after they passed. Building them turned up four things
that were wrong underneath, each now fixed with a test that would have caught
it:

- **The schema tool was quietly deleting the privacy layer.** `drizzle-kit
  push` drops RLS policies and views it does not know about, so every schema
  change silently removed tenant isolation and the consent-enforcing view.
  Fixed with the `db:push` wrapper and a tripwire test.
- **Elevated actions dead-ended.** Elevation was granted only at sign-in, and
  nothing could renew it, so every sensitive action stopped working fifteen
  minutes into a session. Fixed with the step-up endpoint and a form hook that
  retries the refused action.
- **Receipts were already issued on capture** — the docs said "seed only". The
  real gap is narrower: a merchant cannot issue one for a counter sale.
- **The browser suite reused a signed-out session**, so a spec that ran after
  the sign-out test failed for a reason unrelated to it.

Then the whole repository was rebuilt from its own archive, following only the
README, on empty databases. That found three more:

- **A fresh checkout could not run either test suite.** Nothing created
  `apps/web/.env.test`, and the browser suite needed a sample credential only CI
  issued. `bootstrap-dev.sh` now does both.
- **Every consumer page load moved keyboard focus to the Search button**, so the
  first Tab skipped "Skip to content". The palette also focused its field one
  frame late, losing the first letters typed. Both fixed, with a browser test
  that fails on the old code.
- **One insights test only passed on a database where somebody had already run
  the detectors.** It now presses Recompute itself, as an owner would.

Before that round, registration and recovery had been broken end to end —
each form and each route correct on its own, disagreeing about field names —
which is why `src/lib/auth/contracts.ts` and `auth-flow.test.ts` exist.
**The lesson that keeps repeating: the seams between correct components are
where the real bugs live, and only a test that crosses the seam finds them.**

---

## 10. Open work — good places to point a prompt

Honest list, from `.claude/onepass-current-state.md`, `docs/route-audit.md` and
the reference's known-limitations section. Nothing here is secretly finished.

**Next slices, in dependency order**
- **PRIV-006 — classify API response fields**, not only events.
- **TRUST-005 — issuance rights** per credential type.
- **PRIV-007 — data export archive.** The request is recorded; nothing builds
  the archive.

**Real gaps**
- **`/explore` is only as wide as the seeded venues** — it needs real place data
  to be more than a demo.
- **City Pass cannot be bought**, only held.
- **Paying a share of a split bill** does not reach checkout.
- **Neither real flight provider has been exercised against a live account.**
  Both need credentials; until then, honesty requires saying exactly that.
- **Campaigns** is a partner nav entry marked "Not in this build".

**Worth doing, not broken**
- A job runner, so sweeps and detectors stop being buttons — the last of the
  "worth doing" list, and the one the export archive and the sweeps both wait on.

**Deliberately not done** — recorded so nobody "fixes" them by accident: no
duplicate V2 modules; no fake AI (the agent layer is NOT_STARTED and says so);
no prerendering (the CSP forbids it); no fixture inventory in production;
`drizzle-kit push` through the wrapper rather than generated migrations.

---

## 11. Quick facts

| | |
|---|---|
| Commit | the one that last changed this file (`git log -1 -- PROJECT.md`) |
| Files in the archive | 467 files, no `node_modules`, no `.env`, no secrets |
| Pages | 87 `page.tsx` · 33 consumer destinations (44 consumer page files, including detail routes) |
| API routes | 60 |
| Database tables | 92, with 38 RLS policies and 1 consent-enforcing view |
| Integration tests | 373, in 25 files |
| Browser tests | 180, in 16 specs |
| Accessibility | 29 pages × 2 themes, 0 findings |
| API audit | 45 checks, 0 findings |
| Feature registry | 158 features: 18 LIVE · 64 LIMITED · 2 NEEDS_CONFIG · 74 NOT_STARTED |

---

## 12. Progress

Every build task so far, grouped by phase. A tick means the work is in the
repository and was verified by the tests and checks in §7, not only written.
Where a task shipped narrower than its title, the note says so. What is *not*
done is in §10 and in the registry; it is deliberately not repeated here.

**Phase 1 — Prototype**
- [x] Pure-JS QR encoder, built and verified
- [x] The first ONEPASS app, every flow tested in a real browser
- [x] Prototype published as a private page and its source handed over
- [x] State rebuilt as a synced event log; real-time transport
- [x] Merchant terminal scans for real; optional cross-device relay

**Phase 2 — Production foundation**
- [x] Monorepo and real PostgreSQL schema
- [x] Real authentication (Argon2id, hashed session tokens)
- [x] RBAC and tenant isolation enforced server-side
- [x] Core APIs; consent, pass verification and payments wired
- [x] Real-time events; consumer, partner and admin apps
- [x] Hardening, instrumentation and the first test suites
- [x] PWA, CI and an Expo mobile shell — *the mobile app has had no device
  build and no store submission; NFC is not implemented*

**Phase 3 — Commerce layer**
- [x] Commerce schema and domain services (bookings, tickets, receipts,
  warranties, returns, rewards, gifts, split bills)
- [x] Planner and merchant intelligence engines — deterministic, not AI
- [x] Commerce APIs, consumer app, Merchant OS, platform console, marketing site
- [x] Sample ecosystem seeded; the 18-step story proven end to end

**Phase 4 — Isolation and clean-up**
- [x] Domain isolation enforced in the database (three roles, row-level security)
- [x] Hackathon and college branding removed; sample terminology neutralised
- [x] `/developers` and `/pricing` built; console layout and favicon fixed
- [x] Silent email and SMS delivery failures closed; SEO and social metadata
- [x] Full validation and route re-sweep

**Phase 5 — Integrations**
- [x] Razorpay webhook route and checkout begin endpoint
- [x] Outbound webhooks that deliver; webhook and API-key management for partners
- [x] One-click deploy configuration (`render.yaml`, `start.sh`) — *no live
  deployment exists; this environment cannot reach a host*

**Phase 6 — Design and experience**
- [x] Existing system mapped before changing anything
- [x] Design system and motion; landing, public and verification pages
- [x] Consumer experience: home leads with the pass, the pass and the ticket
  are objects you hold up, quick actions, command palette
- [x] Partner and platform consoles given their own register
- [x] Developer platform and in-app engineering reference
- [x] Offline tickets, feature-status registry, health surface — *the pass is
  deliberately never stored on the device*
- [x] Opportunity map; full validation and the route audit

**Phase 7 — Developer platform**
- [x] API catalogue as data; docs shell; endpoint explorer with Try it
- [x] Tests that fail when the docs drift from the code

**Phase 8 — Closing gaps and audits**
- [x] Receipts issued on payment capture; three contradictory screens fixed
- [x] Crawl of every route and link; API audit against bad input
- [x] Responsive, accessibility and performance; stress and concurrency
- [x] Security and SEO sweep; year and institution references removed
- [x] Packaged and verified from a clean directory

**Phase 9 — Travel and AirIndex**
- [x] Travel domain in the database; provider interface and adapters
- [x] Parallel provider search: per-provider and overall timeouts, bounded
  retries, cache, partial results, provider health
- [x] AirIndex over observed fares; server-side pricing, revalidation, settlement
- [x] Travel screens and API — *real providers are NEEDS_CONFIG and have never
  run against a live account*

**Phase 10 — Auth and navigation**
- [x] Registration, confirmation and recovery fixed end to end, with tests
  that cross the form–API seam
- [x] Command palette and `GET /api/me/search`

**Phase 11 — Master build prompt: foundations**
- [x] The four `.claude/` state files and the 158-feature registry
- [x] Slice 1: canonical event envelope, request context, event classification
- [x] Slice 2: versioned issuer keys, rotation, revocation, published keys; step-up
- [x] Slice 3: disclosure receipts and the holder's history; isolation layer
  survives schema pushes
- [x] Slice 4: product ownership and code-based transfer
- [x] Rebuilt from the archive on empty databases; the three problems it found
  fixed (test setup, palette focus, insights test)

**Phase 12 — Intaglio: the product's own design language**
- [x] Brand configuration centralised (`src/lib/brand.ts`) and proved safe by
  renaming: with the name changed, ten surfaces render the new one and zero
  occurrences of the old. The technical identifiers a rename must *not* touch
  are named in that file and were left alone
- [x] Token layer, materials and the printed objects — pass, ticket, receipt,
  certificate, poster — with guilloche line-work generated to `public/patterns`
- [x] Light and dark designed separately; performance tiers; view transitions;
  `prefers-reduced-motion` honoured throughout
- [x] The design playground at `/design`, gated to platform staff in production
- [x] Consumer surfaces rebuilt: home, pass, tickets, receipts, warranties,
  wallet, bookings, returns, products, savings, split, gifts, city pass,
  quests, plan, profile, help, disclosures
- [x] `/settings` and `/notifications` built, and
  `PATCH /api/me/notifications/preferences` with them — one preference per
  request, upserted on the caller's own row, security notices refused and
  audited. Nine tests
- [x] Travel rebuilt: the hub, search, results with a counting filter rail,
  offer, booking, payment, trips, AirIndex. The booking you hold is drawn as a
  boarding pass beside the state machine it is actually in
- [x] `sources.ts` — what this deployment can honestly say about its flight
  sources, answered once instead of by three screens counting differently
- [x] Partner and control consoles on one shell, one chart treatment (scale
  drawn, numbers one disclosure away), one `.split` layout, one `Meter`
- [x] Public, auth and developer surfaces on the shared site chrome
- [x] Nothing in the app ships a `<style>` element any more; six pages were
  injecting their CSS as strings
- [x] Verification: 403 integration tests; 154 browser tests on the production
  bundle (26 skip without a flight source, by design); zero keyboard,
  target-size and measurable-contrast findings in both themes; zero horizontal
  overflow across 275 page-widths from 320 to 1920; API, CSP and structural
  audits clean
- [x] The accessibility audit itself corrected — it had been reporting 44
  findings that were not real, and hiding six that were

**Phase 13 — Closing two named gaps**
- [x] The realtime cold-start window closed. `/api/events/stream` awaits
  `realtimeReady()` before it subscribes and before it says it is open, with the
  abort listener registered first so a tab closed mid-arming is still noticed.
  The fix had been written down in the engineering reference and left unapplied
  because it could not be verified; it is verified now, by a test that fails
  when the two statements are swapped back
- [x] Webhook redelivery. A partner can send a delivery the platform gave up on
  again, from a "Given up on" table on the API console. `requeueDelivery`
  refuses one already delivered, one the drain is still working through, and one
  whose subscription is off; another tenant's is not found rather than refused.
  It queues rather than sends, so one code path still owns signing, timeouts,
  backoff and the claim. 10 tests

### Phase 14 — the counter

- **COMMERCE-001 — receipts for counter sales.** A merchant can now issue a
  receipt for goods sold across a shop counter, so a walk-in buyer gets the
  warranty and the owned product an in-app buyer already got. The buyer is
  identified by the pass they present — `verifyPresentation`, which had no
  caller anywhere until now — and carried forward by presentation id, so no
  user id reaches a browser. `lib/commerce/counter.ts`,
  `POST /api/partner/{orgId}/pass/verify`,
  `POST /api/partner/{orgId}/receipts`, `/business/{orgId}/counter`.
  19 integration tests, 5 browser tests, 7 API-audit checks.
  Three defects fixed along the way, all found by the browser suite: a
  `disabled` fieldset submitting nothing, `[hidden]` losing to `.grid`, and
  18×18 checkboxes. See §9.

### Phase 15 — passing a ticket on

- **TICKET-002 — ticket transfer.** `TRANSFERRED` had been in the ticket state
  enum since the beginning and the door had always refused it; nothing ever set
  it, so the product told people at the door about something it could not do.
  A claim now marks the sender's ticket TRANSFERRED and issues the claimant a
  **new** reference — the sender's screenshot stops working, which is the
  difference between a transfer and sharing. The booking, the payment and the
  receipt stay with whoever bought them, and both parties are told so in as many
  words. `lib/commerce/ticket-transfer.ts`, `ticket_transfers`, three `/api/me`
  routes, the Tickets screens. 20 integration tests, 2 browser tests,
  5 API-audit checks.
- **A refusal thrown inside a transaction rolls back its own bookkeeping.**
  Building the above on the ownership-transfer pattern reproduced a bug that was
  already in it: closing a dead offer and then throwing meant the close was
  rolled back with everything else, so an expired code sat PENDING forever and
  blocked a fresh one. Both modules now return the refusal and close the row
  outside the transaction. `ownership.test.ts` gained the assertion that fails
  on the old code.

### Phase 16 — consent receipts

- **PRIV-003 — consent receipts.** The consent module's own docstring said a
  grant points at a *version* "so re-wording a scope never rewrites what
  somebody actually agreed to". True of the body text, which is frozen on the
  version — and false of the label, the description, the field list and the
  sensitivity flag, which live on the mutable definition and are the parts a
  person actually reads. Editing a definition silently rewrote every past
  agreement, on the screen where people read theirs back.
  `consent_receipts` snapshots all of it at the moment of the act, including the
  organization's name, and hands back a `cns_…` reference the person can quote.
  Written on grant and on revoke; **not** on expiry, because nothing sweeps the
  table and the consent view gates on the timestamp — saying so beats a receipt
  claiming an expiry nothing observed. `/disclosures` gained the history;
  `/profile` says plainly that it shows permissions as they stand *today* and
  links to the wording that was agreed. 8 integration tests, 1 browser test.

### Phase 17 — two defects found by review and by the calendar

- **Both transfer modules could deadlock against themselves.** Offering locks
  the item and then expires a stale offer row; claiming locked the offer and then
  wanted the item. A claim of an expired code concurrent with a fresh offer on
  the same item is a cycle, and Postgres resolves it by aborting one — a 500.
  Both claim paths now take the item lock first, matching the offer path, and
  assert the locked offer still points at the item that was locked.
- **28 travel tests passed or failed depending on the date.** Every payment and
  cashback test built its booking through the real sample provider, which decides
  whether a fare "went up" from a hash of the offer id — and the offer id comes
  from a search thirty days out from *today*. The suite was green on most days
  and red on the rest, failing with "The price changed", which reads like a
  product bug and is not one. Tests that are about revalidation keep their own
  explicit stubs; tests that merely need a payable booking go through
  `readyToPay`, which asserts it got PRICE_CONFIRMED so a regression names its
  own cause.

**The lesson from both: a test or a lock order that happens to work is not the
same as one that has been reasoned about.** The deadlock had been in
`ownership.ts` since it shipped and no test could have caught it; the travel
flake had been latent since the fixture was written and caught itself only by the
calendar rolling over mid-session.

### Phase 18 — the dependency sweep, and what an upgrade broke

- **`drizzle-orm` 0.38 → 0.45**, for GHSA-gpj5-g38j-94v9 (high, SQL injection
  via improperly escaped identifiers) in a *production* dependency. The three
  npm deprecation notices that prompted the sweep turned out to be the least of
  what the tree was carrying.
- **The upgrade broke both places that catch a unique violation**, because 0.45
  wraps driver errors: the code moved to `cause` and the message became
  `Failed query: …`. The pass replay check turned a refusal into a 500 (a test
  caught it); the offer redemption cap's index backstop degraded from a 409 to a
  500 on a path nothing covers. `src/db/errors.ts` now reads the SQLSTATE
  through the cause chain, and its tests provoke real violations rather than
  asserting against a hand-built object.
- **The new message carries the bound parameters**, and four places logged
  `err.message` on a write they deliberately let fail quietly. That would have
  written real values into log files. `describeDbError` returns the SQLSTATE,
  the constraint and the short reason, and a test proves a value present in the
  raw message is absent from the summary.
- **`vitest` 2 → 5** (critical, dev-only) surfaced a removed option:
  `poolOptions.forks.singleFork` was deleted in Vitest 4, and an ignored option
  there does not fail — it quietly lets the test files run in parallel against
  the one shared database, which the config's own comment forbids.
- **Production vulnerabilities 6 → 2.** Both that remain need Next 16.
- **Not fixed, deliberately:** ESLint 9 is the maintenance channel and ESLint 10
  is blocked by three plugins whose latest releases cap at `^9`; taking it today
  means dropping the jsx-a11y rules. `@esbuild-kit/*` is deprecated upstream and
  still shipped by the newest `drizzle-kit`. Both are in §13.

**The lesson: an upgrade's blast radius is the code that reads the upgraded
thing's *error* shape**, which no type checker covers and most tests never reach.
Both regressions here were in catch blocks.

**Next** — see §10: a city-pass checkout, which is the one thing standing
between the city pass and LIVE; PRIV-006; TRUST-005; PRIV-007.
