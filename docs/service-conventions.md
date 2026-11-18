# Writing a ONEPASS domain service

Read this before adding anything under `apps/web/src/lib/`. It is short because
most of it is one idea: the database enforces the rules, the service explains
them, and neither invents a fact it cannot show the working for.

## Where things are

- `src/db/schema.ts` — identity, auth, consent, consent receipts, credentials,
  payments. Re-exports `./commerce.ts` (venues, inventory, offers, bookings,
  tickets, ticket transfers, receipts, warranties, returns, rewards, savings,
  city pass, itineraries, insights, demand, campaigns, api usage, households,
  corporate, quests) and
  `./extensions.ts` (splits, gifts, itinerary collaborators, venue maps, parking
  memory). Import every table from `@/db/schema` — never from the sub-modules.
- `src/db/client.ts` — `db`, `sql`, and the types `Db` and `DbOrTx`.
- `src/lib/errors.ts` — `badRequest`, `notFound`, `conflict`, `forbidden`,
  `unprocessable`, `rateLimited`. Throw these; the route wrapper maps them.
- `src/lib/ids.ts` — `ulid()` for primary keys, `publicRef(prefix)` for anything
  a third party sees.
- `src/lib/audit.ts` — `recordAudit`, `recordSecurityEvent`, `emitEvent`,
  `notify`, `userChannel`, `orgChannel`.
- `src/lib/api.ts` — `route()` and `json()` for HTTP handlers.
- `src/lib/authz/authorize.ts` — `getActor`, `requireActor`, `authorize`,
  `authorizePartner`, `assertSameOrg`, `can`.

## Rules

**Money is `integer` minor units.** Paise, never rupees, never a float, never a
string. A price of ₹149 is `14900`. Divide only at the point of display.

**Anything that changes two rows runs in a transaction.** `db.transaction(async
(tx) => …)`, and every helper takes `tx: DbOrTx` so it can be composed into a
caller's transaction rather than opening its own.

**Take the lock.** Reading a count, deciding, and writing it back is a race.
`.for('update')` on the row first — see `src/lib/commerce/inventory.ts`, which is
the reference implementation for this.

**Take locks in the same order everywhere.** Two code paths that lock the same
pair of rows in opposite orders will deadlock against each other, and Postgres
resolves that by aborting one — which reaches the caller as a 500, not as a
refusal it can act on. Both transfer modules had this: offering locked the item
then the offer row, claiming locked the offer then the item. If a path needs the
second row's id before it can lock the first, read it *without* a lock, lock in
the canonical order, then re-read under lock — see `claimTransfer` in
`src/lib/products/ownership.ts`.

**A refusal thrown inside a transaction rolls back its own bookkeeping.** If the
code closes a dead row and then throws to report it, the close goes with the
rollback and the claim in the error message is false. Return the refusal from the
transaction, apply the housekeeping afterwards in its own statement, and throw
outside — both `claimTransfer` and `claimTicketTransfer` do this, and each has a
test that fails on the older shape.

**Let the database enforce limits.** A redemption cap is a unique index on
`(offer_id, user_id, sequence)`, not an `if` statement. Application checks pass
twice under concurrency; constraints do not.

**Catch the violation by SQLSTATE and constraint, never by the driver's prose.**
Use `isUniqueViolation(err, 'the_index_name')` from `src/db/errors.ts`, which
reads through the driver's cause chain — `drizzle-orm` 0.45 moved the code there
and broke both hand-rolled versions of this check at once. Name the constraint:
a catch that asks only "was this unique?" will one day answer a different
index's complaint with a polite sentence.

**Never log a driver error's `message`.** It contains the statement *and the
values bound to it*, so `logger().error({ err: err.message })` on a failed write
puts real data — an email address, a phone number — into a log file. Use
`describeDbError(err)`, which returns the SQLSTATE, the constraint and the short
reason.

**Idempotency where the caller may retry.** Payment webhooks arrive twice as a
matter of course. Key on something stable and let a repeat return the original
result rather than doing the work again.

**Never spread a row into a response.** Build the response object field by field.
`{...row}` is how an internal id, a hash or a soft-deleted flag reaches a
partner's screen. See `publicView()` in `src/lib/credentials/service.ts`.

**Tenant isolation is a filter, not a check.** Every partner query carries
`eq(table.organizationId, ctx.organizationId)` in its `where`. `authorize()`
returns that id; use it.

## Honesty

**A record of what somebody agreed to is a snapshot, not a join.** If the words
live on a row an administrator can edit, then the record describes whatever that
row says today rather than what was on screen at the time, and it is not evidence
of anything. Copy the wording at the moment of the act — see
`src/lib/privacy/consent-receipts.ts`, which snapshots a scope's label,
description, field list, sensitivity, version number and body text, plus the
organization's own name, because a business can rename itself too.

These are product constraints from the client, not style preferences.

- **No claim of a real payment.** The sandbox provider settles instantly and
  moves no money. Anything it produces is labelled.
- **No model is connected.** The planner, the concierge and the merchant advisor
  are deterministic computation over live rows. Call them a planner, an advisor,
  a forecast — not AI. Where a table has a `method` or `generator` column, fill
  it with what actually ran.
- **Show the working.** Anything derived stores `evidence` and `sample_size`. A
  forecast below a usable sample says so rather than reporting a confident
  number.
- **Sample data is flagged in the row**, not in a comment — e.g.
  `venue_maps.is_sample`. Screens read the flag and say so.
- **Never widen disclosure.** A merchant-facing function returns aggregates or
  consented fields only. If you need a new consent scope, add a
  `consent_definitions` row; do not read around the consent check.

## Style

Comments explain *why*, at the top of a file and above a decision that would
otherwise look arbitrary. Do not narrate what the next line does. Keep exported
functions small enough to test directly, and prefer a pure function taking rows
over one that queries and decides in the same breath.

Every file must pass `npx tsc --noEmit` with the repo's strict settings —
`noUncheckedIndexedAccess` is on, so index access is `T | undefined` and you must
handle it.

## `loading.tsx` and the 404-as-refusal rule

**Do not add a `loading.tsx` to a route segment whose pages can call
`notFound()` — including one thrown for them by a guard.**

A `loading.tsx` wraps its segment in a Suspense boundary, and a Suspense
boundary makes the response stream. The HTTP status goes out with the first
chunk, so a `notFound()` raised further down can still swap the *body* for the
404 page but can no longer change **200 into 404**.

That is not cosmetic here. `requirePartner` and `requirePlatform` answer a
request for another tenant with `notFound()` rather than a 403, deliberately, so
that a URL cannot be used to enumerate which organizations or accounts exist.
Put a loading boundary above one of those guards and every refusal becomes a
200 with 404-looking content: the page still says nothing useful, but the status
line now confirms the route exists.

This was introduced once, during the design-system work, by adding a
`loading.tsx` at each of the three group roots. `e2e/isolation.spec.ts` and
`e2e/admin.spec.ts` caught it — `/control/security` answered 200 to an account
that must not see it. The boundaries now sit only on individual pages that
cannot 404 (`/home`, `/wallet`, `/explore`, `/receipts`, `/tickets`).

Before adding one, grep the page for `notFound()` and check which guard it
calls. If either can refuse, the page does not get a loading boundary.
