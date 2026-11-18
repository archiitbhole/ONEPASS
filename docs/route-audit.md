# ONEPASS route audit

Every route in the application, what it is for, and an honest assessment of
both halves — how it looks and whether it works.

**Columns.** *UI status* is about presentation and states. *Functional status*
is about whether the thing behind the screen actually does anything. They are
separate on purpose: a beautiful screen over a dead table is the failure mode
this audit exists to catch.

**Legend.** ✅ good · ◐ works, could be better · ⚠️ a real gap · 🚫 nothing behind it

---

## Public

| Route | Purpose | UI | Functional | Missing | Recommended |
|---|---|---|---|---|---|
| `/` | Landing | ✅ rebuilt — hero, drawn product visual, three audience doors, live numbers, honesty section | ✅ quotes real database counts | — | — |
| `/verify` | Enter a reference | ◐ plain form | ✅ | Visual parity with `/v/<ref>` | Same ambient treatment |
| `/v/[ref]` | The verification verdict | ✅ one large word, then the checks, then the detail | ✅ and now genuinely independent — the proof is published with a runnable offline check | — | Status-list support (see Opportunity Map) |
| `/developers` | Developer platform | ✅ rebuilt — docs shell, sidebar, ⌘K search over endpoints, parameters, events and error codes | ✅ generated from a catalogue a test holds against the routes | — | — |
| `/developers/verify` | Quickstart and the proof | ✅ new | ✅ runnable independent-verification script | — | — |
| `/developers/api` | Endpoint explorer | ✅ new — 15 endpoints, method badges, parameter tables, generated curl, live Try it | ✅ | — | — |
| `/developers/webhooks` | Signatures, events, retries | ✅ new | ✅ payloads match the emit sites field for field | Redelivery from the console | Says so on the page |
| `/developers/realtime` | SSE | ✅ new | ✅ | — | — |
| `/developers/errors` | Error reference | ✅ new — one anchor per code, every rate-limit policy | ✅ | — | — |
| `/developers/architecture` | System reference in-app | ✅ new | ✅ includes an honest known-limits section | — | — |
| `/developers/status` | The whole feature registry | ✅ new | ✅ | — | — |
| `/pricing` | Commercial model | ◐ | ✅ honest | — | Visual pass |
| `/not-found` | 404 | ✅ new | ✅ wording is load-bearing for isolation tests | — | — |
| `/error` | App error boundary | ✅ new — offers a way out and surfaces the digest | ✅ | — | — |

## Authentication

| Route | Purpose | UI | Functional | Missing | Recommended |
|---|---|---|---|---|---|
| `/sign-in` | Sign in | ✅ reveal control, caps-lock hint, per-field server messages, confirmation after verifying or resetting | ✅ rate-limited, open-redirect safe; now reads `mustVerifyEmail` and sends an unconfirmed account for a code | — | — |
| `/sign-up` | Create an account | ◐ correct, states the same password floor the server enforces | ✅ | Onboarding narrative | A short guided first-run |
| `/verify-code` | Enter a code | ✅ resend with a cooling period, address shown back, a way out | ✅ **fixed** — it posted `email` to an endpoint that reads `destination`, so no account could confirm an address | — | — |
| `/recover` | Account recovery | ✅ both steps, which is one more than it had | ✅ **fixed** — the body omitted its `step` discriminator, so a reset was impossible; the completion screen did not exist and the copy promised a link that is not sent | — | — |

## Consumer

| Route | Purpose | UI | Functional | Missing | Recommended |
|---|---|---|---|---|---|
| `/home` | The hub | ✅ rebuilt — pass card leads, quick actions expose five orphaned surfaces | ✅ | — | — |
| `/pass` | The rotating code | ✅ opens the card `/home` shows at rest; the live code on a white plate at the largest size the screen allows | ✅ real TOTP, real QR; never stored on the device | — | — |
| `/tickets`, `/tickets/[ref]` | Tickets | ✅ the detail is a ticket stub you hold up at the door; the list takes a transfer code | ✅ live updates; a ticket opened once can be shown offline; passing one on marks the sender's TRANSFERRED and issues the claimant a new reference (TICKET-002) | — | — |
| `/bookings`, `/bookings/[ref]` | Reservations | ◐ read-only table | ◐ no cancel action although transitions are imported | Cancel | Add it, or say why not |
| `/deals`, `/deals/[ref]` | Live deals | ◐ | ✅ Book now reaches a real checkout | City filter and search on the list | Match `/explore`'s filters |
| `/explore` | Discovery | ◐ good filters | ⚠️ only as wide as the seeded venues | External place data | See Opportunity Map |
| `/wallet`, `/savings` | Points and savings | ◐ | ✅ real ledger | — | — |
| `/receipts`, `/receipts/[ref]` | Receipts, open a return | ◐ strong filters and pagination | ✅ issued on payment capture (`issueReceiptForCheckout`, one sale → one receipt under concurrency) **and** at a merchant's counter against a presented pass (COMMERCE-001) | — | — |
| `/warranties`, `/returns` | Cover and cases | ◐ | ✅ | — | — |
| `/gifts` | Send and claim | ◐ | ✅ | — | Now reachable from home |
| `/split`, `/split/[ref]` | Share a bill | ◐ | ◐ tracked and waivable; paying a share needs checkout | — | Honest today; chipped Beta |
| `/city-pass` | What a pass covers | ✅ in the page container, asserted by `e2e/layout.spec.ts` | ◐ usable if held; cannot be bought | Purchase | See Opportunity Map |
| `/explore-quests` | City explorer | ✅ in the page container, asserted by `e2e/layout.spec.ts` | ✅ | — | — |
| `/plan`, `/travel` | Planner, travel mode | ◐ dense but clear | ✅ real solver, correctly says no model is connected | — | — |
| `/profile` | Account, consents, sessions | ◐ | ◐ reissue the pass, withdraw a consent, disconnect a business, end sessions; ⚠️ no edit of name or phone, no notification-preference write, no export or delete screen (the endpoints exist) | Those screens | Registry-chipped as planned |
| `/help` | Support | ◐ | ✅ | Ticket detail, reply thread | — |
| `/products` | What you own; give or sell it | ✅ new — cover shown with whose name it is under; transfer code shown once | ✅ receipt → ownership in one transaction; code-based transfer; one owner per item under concurrency; seller can no longer return a transferred item | Service history, recall notices | PRODUCT-007/009 |
| `/disclosures` | Who has seen what about you, and what you agreed to | ✅ two sections — disclosures, then consent history with the wording as it was and a `cns_…` reference | ✅ disclosures written where disclosure happens (partner customer list, credential checks); consent receipts written on grant and revoke, snapshotting the scope (PRIV-003). Names only, never values | An expiry writes no receipt — nothing observes it | — |

**Getting to any of it.** The bar holds seven of these; there are thirty-three.
The command palette in the consumer topbar — ⌘K, `/`, or the control next to
the brand, which is present at phone width — searches all thirty-three by name and
by the words people actually use ("refund" finds Returns), and searches the
holder's own tickets, bookings, receipts, warranties and trips through
`GET /api/me/search`. Every query in that endpoint filters on the session's own
user; `src/app/api/me/search/search.test.ts` gives two accounts the same
searchable words and checks that each finds only their own.

## Partner console

| Route | Purpose | UI | Functional | Missing | Recommended |
|---|---|---|---|---|---|
| `/business/[orgId]/dashboard` | Today and the fortnight | ✅ the only surface with a sparkline | ✅ all figures from own rows | — | — |
| `…/door` | Admit a ticket | ✅ verdict tinted by reason | ✅ single-use enforced by index | — | — |
| `…/counter` | Sell something across the counter | ✅ new — identify, ring up, price, issue; the reviewed figure is the one written | ✅ the buyer is identified by presenting their pass, never by a search; `issueReceipt` writes receipt, lines, warranties and product instances in one transaction (COMMERCE-001) | Camera scanning — the repository has a QR encoder and no decoder | — |
| `…/deals`, `…/deals/new` | Sell | ✅ live price preview | ✅ | — | — |
| `…/inventory` | Capacity | ◐ | ✅ | — | — |
| `…/offers` | The offer book | ◐ | ✅ state machine respected | — | — |
| `…/bookings` | Reservations | ◐ | ✅ consent-correct | — | — |
| `…/customers` | Connected customers | ◐ | ✅ withheld fields say *why* | — | — |
| `…/receipts` | Finance | ◐ | ✅ in-app sales issue on capture, counter sales from `…/counter` or the API | — | — |
| `…/returns` | Returns queue | ◐ | ✅ | — | — |
| `…/loyalty` | Programme | ◐ | ◐ read-only, and now says so: no console form and no API; platform operations make the change | A rate-change endpoint | — |
| `…/insights`, `…/demand` | Analysis | ◐ thin samples suppressed correctly | ◐ no scheduler — refresh is a button | A job runner | — |
| `…/api` | Developer console | ◐ | ◐ **metering now records key-authenticated calls**; keys and webhooks can now be created | Redelivery, request log | See Opportunity Map |
| `…/settings` | Organisation | ◐ | ◐ signing keys can be rotated and revoked (behind a password re-check); organisation details are read-only | Details write path | Registry-chipped |
| `…/campaigns` | — | 🚫 nav entry only | 🚫 no route, no service | Everything | Honest today: disabled with a reason |

## Platform console

| Route | Purpose | UI | Functional | Missing | Recommended |
|---|---|---|---|---|---|
| `/control` | Nine counted numbers | ◐ each behind its own permission | ✅ | — | — |
| `/control/users`, `/control/users/[id]` | Directory, one account | ◐ masked by default | ✅ | — | — |
| `/control/partners` | Approval queue | ◐ | ✅ | — | — |
| `/control/transactions` | Cross-tenant ledger | ◐ | ✅ labels sandbox rows prominently | — | — |
| `/control/security` | Alert queue | ◐ evidence on the card | ◐ sweep is a button | A scheduler | — |
| `/control/audit` | The trail | ◐ | ✅ structurally read-only | — | — |
| `/control/support` | Ticket queue | ✅ explains *why* a queue is empty | ✅ | — | — |
| `/control/credentials` | Aggregates only | ◐ | ✅ no roster, by design | — | — |
| `/control/health` | On-call | ◐ | ✅ reads directly rather than via the broken admin health API | Alerting | — |

---

## Cross-cutting findings

### Fixed in this pass
* **No `error.tsx`, `not-found.tsx` or `loading.tsx` existed anywhere.** All
  three now do, with loading boundaries placed only where a page cannot 404.
* **Five consumer surfaces had no route in** — gifts, split, city pass, quests,
  help. Quick actions on `/home` now reach all five.
* **Ragged card grids** — deal cards had their buttons at four heights.
  `.fill-height` + `.push-end`.
* **The name appeared twice on `/home`.**
* **`api_usage` was read and never written.** Verification calls made with a key
  are now metered.
* **The credential proof was never published**, making "verify this yourself"
  impossible to act on.

### Fixed in the developer-platform pass
* **Every prerendered page had all its JavaScript blocked in production.** The
  CSP is nonce-based; a prerendered page carries a build-time nonce and every
  response carries a fresh one, so the browser refused every script. `/pricing`
  and `/verify` had no client runtime at all in a production build, silently,
  and had not for as long as the app has been built for production. It survived
  because `next dev` renders per request, so the nonce always matched wherever
  the tests looked. Fixed by rendering dynamically; guarded by `e2e/csp.spec.ts`
  and by running the whole browser suite against the built server.
* **Five webhook events were subscribable and undeliverable.** `BOOKING_HELD`,
  `PAYMENT_INITIATED`, `PAYMENT_COMPLETED`, `RECEIPT_ISSUED` and
  `RETURN_DECIDED` were offered in the registration schema and the console's
  checkboxes, and emitted only on the customer's own channel — which webhook
  dispatch ignores by design. A partner subscribing to any of them would have
  waited forever. They now have an org-channel emit with a merchant-appropriate
  payload, and `api-catalog.test.ts` fails if a subscribable event ever loses
  one again.
* **`CONSENT_REVOKED` on disconnect never reached the partner.** Withdrawing one
  consent told them; disconnecting entirely — which withdraws every grant at
  once — told only the customer.

### Still open
* **Campaigns** is a partner nav entry with no route; it is marked "Not in this
  build" in the console rather than hidden. (The two layout inconsistencies and
  the receipts and loyalty contradictions previously listed here are fixed.)
* **No scheduler**, so three consoles depend on somebody pressing a button — and
  a consent grant past its expiry keeps `GRANTED` in the column while the consent
  view correctly filters it out on the timestamp.
* **Camera scanning** at the door and the counter: `packages/pass` is a QR
  encoder and the repository has no decoder, so both screens take the reference
  or the code as text and say so. A hardware scanner needs no setup.

### Not found
* **No broken or dead links.** Every `href` resolves to a route that exists.
* **No misleading functionality.** Every unbuilt capability either says so on
  screen or is chipped from the feature registry. The landing page's honesty
  section, the sandbox labels on `/control/transactions`, the "no model is
  connected" badge on `/plan` and `/travel`, and the door console's note about
  camera scanning are all accurate.
* **No unnecessary year references.** No year is hard-coded into a name, a
  password or an identifier. What remains is a code comment, an API example
  whose dates demonstrate a one-year validity window, and a graduation year in
  a sample credential — where the year is the fact being represented.
  Copyright is already `new Date().getFullYear()`.
* **No institution, competition or event names** anywhere in the repository.
