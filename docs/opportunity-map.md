# ONEPASS Opportunity Map

What this platform already does, what the surrounding ecosystem does, and which
of the differences are worth closing.

**How to read this.** Nothing here is implemented because a competitor has it.
Every recommendation answers one question: *why would a ONEPASS user, partner or
developer actually be better off?* Where the answer is thin, the item is in the
low-priority section rather than dressed up.

**On confidence.** Items grounded in a specification or a published standard are
marked ✅. Items drawn from general industry practice that I could not verify
against a primary source in this session are marked ⚠️ — treat those as leads to
confirm, not as facts.

---

## 1. What ONEPASS already does

Verified against the repository, not aspiration.

**Identity and access.** Argon2id passwords; opaque session tokens stored as
SHA-256; a generation counter for global revocation; a rotating RFC 6238 TOTP
pass with replay defence enforced by a unique database index rather than a
check.

**Credentials.** Ed25519 signatures over a SHA-256 of canonicalised claims.
Verification recomputes both, so editing a claim in the database breaks it. The
proof — signature, hash and canonicalisation — is now published, so a verifier
can check it with `node:crypto` and no network.

**Isolation.** Three PostgreSQL roles, row-level security, a consent-gated
customer view, and refusals that return 404 rather than 403 so URLs cannot
enumerate tenants.

**Commerce.** One payment per cart, captured only by a signed provider callback;
integer paise throughout; capacity holds, offers, bookings, tickets, receipts,
returns, warranties, gifts, split bills, city passes.

**Platform.** A transactional outbox → Redis → SSE fan-out, signed outbound
webhooks with bounded retries and an SSRF guard, a partner API with scoped keys,
a public verification API, four detectors for suspicious activity, and a
platform console with an audit trail that is structurally read-only.

That is a genuinely substantial base. The gaps below are mostly about
*interoperability* and *developer ergonomics*, not about missing product.

---

## 2. What the surrounding ecosystem does

### Verifiable credentials — the standards have landed ✅

The W3C Verifiable Credentials Working Group put a cluster of specifications
through Proposed Recommendation in 2025, and the family now includes a data
model, securing mechanisms, and a status/revocation mechanism
([W3C news](https://www.w3.org/news/2025/seven-proposed-recommendations-published-by-the-verifiable-credentials-working-group/),
[VC Overview](https://www.w3.org/TR/vc-overview/)).

The one most directly relevant here is **Bitstring Status List**
([spec](https://www.w3.org/TR/vc-bitstring-status-list/)): revocation published
as a compressed bitstring at a URL, where each credential holds an index into
it. A verifier checks a bit rather than asking the issuer about a specific
credential — which both scales and stops the issuer learning who is checking
what.

ONEPASS today answers revocation from its own database, per credential, per
check. That works and it is honest, but it means the issuer sees every
verification, and a verifier must be online and must trust us to answer.

### Selective disclosure ⚠️

The direction of travel across the ecosystem is proving a *predicate* rather than
disclosing a *value* — "over 18" without the date of birth, "enrolled" without
the roll number. The mechanisms discussed are SD-JWT and BBS-style signatures. I
could not verify the current specification status of either in this session.

ONEPASS discloses all claims of a credential or none. The type decides whether
the holder's name appears, which is a real privacy control, but it is
per-credential rather than per-claim.

### Wallet passes ⚠️

Apple Wallet and Google Wallet both accept third-party passes, and a loyalty or
generic pass is the usual vehicle. Both involve a developer account and a
signing/issuer setup. I could not confirm current fees or approval requirements
in this session, and they should be checked before any commitment.

ONEPASS's pass is web-only. The thing a person reaches for at a counter is their
platform wallet.

### India ⚠️

**DigiLocker** is the obvious credential source for an Indian identity product —
government-issued documents the holder already has. Integration requires
registration as a requester organisation; that is a prerequisite, not an
implementation detail.

**ONDC** is the open network for commerce. Participation means becoming a
network participant with the associated registration and protocol work. It is
the honest answer to "integrate with BookMyShow/Zomato" — those have no public
partner API, and a network standard is how that inventory becomes reachable
without a private deal per merchant.

**Aadhaar** is legally constrained. Do not design anything that stores or
proxies Aadhaar numbers without specific legal advice.

### Developer platforms ⚠️

The conventions a mature API platform provides that a young one usually lacks:
idempotency keys on every mutating endpoint, an explicit versioning and
deprecation policy, a separate test environment with its own keys, webhook
*redelivery* from a console, an event catalogue with payload schemas, and a
recent-requests log a developer can inspect after a failure.

ONEPASS has idempotency on checkout, `/api/v1/` as a prefix, signed webhooks
with delivery history, and an event catalogue in code. It has no test
environment, no redelivery control, no stated versioning policy, and — the sharp
one — **no request log at all, because `api_usage` is read by the console and
written by nothing.**

---

## 3. Gap analysis

| Area | Existing ONEPASS capability | Missing opportunity | Recommended feature | Priority |
|---|---|---|---|---|
| Revocation | Per-credential lookup against our database | Verifier must be online and we see every check | Publish a Bitstring Status List per issuer; keep the API as the convenience path ✅ | **High** |
| API metering | `api_usage` table read by the console | Nothing writes it; two cards are permanently zero | Meter in the `route()` wrapper, where every call already passes | **High** |
| Developer trust | Signed webhooks, delivery history | A partner cannot replay a delivery they lost | Redeliver button on the partner API page | **High** |
| Loyalty config | Programme shown, rates read-only | Console says "changes go through the partner API"; that endpoint does not exist | Either build the endpoint or change the sentence | **High** |
| Selective disclosure | All claims or none, per type | Cannot prove a predicate without revealing a value ⚠️ | Age/eligibility predicates on credential types | Medium |
| Issuer keys | Versioned keys, rotation and revocation; every key version published at `/api/v1/issuers/<slug>/keys` | Not in a standard resolvable format | `did:web`-style issuer document at a well-known path ⚠️ | Low |
| Wallet | Web pass only | Not where people look at a counter ⚠️ | Apple/Google Wallet pass issuance | Medium |
| Test environment | One environment | Integrators test against production data | Sandbox keys with an isolated dataset | Medium |
| Receipts | Issued on capture for in-app sales **and** at a merchant's counter against a presented pass (COMMERCE-001) | ✅ done | A printed or emailed customer copy | Low |
| Scheduling | Sweeps and detectors are buttons | Nothing happens unless somebody presses something | A job runner; the consoles can then stop apologising | Medium |
| Consent | Grants, a gated view, and a receipt on grant and revoke that snapshots the terms with a `cns_…` reference (PRIV-003) | ◐ readable but not yet machine-portable | A signed, machine-readable export of the consent history | Low |
| Credential import | Issued by partners only | Indian users already hold documents ⚠️ | DigiLocker import — needs partner registration first | Low (blocked) |
| Inventory reach | Partners publish to us | No route to existing marketplaces ⚠️ | ONDC participation — large, strategic | Low (large) |
| Alerting | Health reported | Nothing watches it | Page somebody on outbox age and subscribe failures | Low |

---

## 4. High-value opportunities

**1. Bitstring Status List for revocation.** ✅ The single most valuable
standards-alignment available. It turns verification from "ask ONEPASS" into
"check a published list", which means a verifier can work offline against a
cached list, the issuer stops learning who checks what, and revocation scales
without a query per check. It also composes with the proof this platform already
publishes — the signature plus a status list is close to a complete verifiable
credential story.

**2. Meter the API.** Two cards and two headline stats in the partner console
read from a table nothing writes. The fix is small — `route()` is the one place
every API call already passes — and it turns a dead surface into the usage data
that billing, rate limits and support all eventually need.

**3. Webhook redelivery.** Deliveries, attempts and errors are already recorded.
A partner whose endpoint was down for an afternoon currently has no way to
recover the events they missed, which makes the whole integration feel fragile
regardless of how careful the signing is.

**4. ~~Let a merchant issue a receipt for a counter sale.~~** Done —
COMMERCE-001. `/business/{org}/counter` and two endpoints behind it; the buyer is
identified by presenting their pass rather than by a customer search, because a
search turns every till into a browsable directory and proves nothing about who
is standing there. The person who buys a kettle in a shop now gets the receipt,
the warranty and the owned product.

---

## 5. Lower-priority ideas

Recorded so they are not rediscovered, not recommended now.

* **Social/loyalty sharing** — gifting exists; a referral graph is a growth
  feature, not a platform one.
* **Merchant-facing campaign tooling** — the nav entry exists and the service
  does not. Worth building when there is demand, not before.
* **In-app messaging between partner and customer** — support covers the real
  need today and a second channel is a second moderation problem.
* **Multi-currency** — the whole money layer is paise and `Asia/Kolkata`.
  Correct for the stated market; revisit only with a real second market.
* **Native camera scanning** — the door console is built around a reference
  because there is no decoder in the repository. A USB scanner already works.

---

## 6. Technical opportunities

* **A job runner.** The detectors, sweeps and sample refresh are all manual.
  This is the single biggest structural gap in operations.
* **Move the outbox publisher out of the web process.** It starts at module
  scope of the SSE route, so an instance that never serves a stream never
  publishes. A worker makes that explicit.
* **Pin resolved addresses when delivering webhooks.** The SSRF guard checks the
  host as written; a DNS rebind is not covered, and the code says so.
* **Idempotency keys on the partner API**, not only on checkout.
* **An explicit API versioning and deprecation policy.** `/api/v1/` is a prefix
  today, not a promise.

---

## 7. UX opportunities

* **Timeline for a booking's life** — held, confirmed, admitted, completed — in
  one strip. The data exists; the story is scattered across pages.
* **A single "what happened" activity stream** with real filters. Recent
  activity is currently the five newest notifications.
* **Ticket detail as the thing you hold up**, with the same care the pass card
  now gets.
* **Partner onboarding.** Approval exists; the path from "interested merchant"
  to "publishing a deal" has no guided surface.
* **Empty states that offer the next action.** The consoles already distinguish
  "your filter matched nothing" from "there is nothing", which is better than
  most products manage — extend it to the consumer surfaces.

---

## 8. Developer ecosystem opportunities

* **A request log.** The single most-used feature of a good developer console:
  what I sent, what came back, and the request id. Depends on metering.
* **Webhook replay and a signature debugger** — paste a payload and a signature,
  see why it did not verify.
* **A published event catalogue with payload schemas.** `EVENT_TYPES` is the
  source of truth in code; it should be documented output.
* **Client libraries.** None exist, and the docs correctly say so. A thin
  TypeScript client generated from the route schemas would be honest and cheap.
* **A changelog and deprecation notices** with somewhere to put them.

---

## 9. Offline opportunities

What can genuinely work without a network, and what must never:

| Can work offline | Why |
|---|---|
| A previously loaded ticket and its code | The code is time-based, not network-based |
| Cached receipts, warranties, bookings | Read-only, already fetched |
| Credential verification against a cached status list ✅ | The proof is published and self-contained |
| The developer documentation | Static |
| The app shell and navigation | Already cached |

| Must not work offline | Why |
|---|---|
| Payments | Only a signed provider callback captures |
| Account or security changes | Needs authoritative server state |
| Admitting a ticket | Single-use enforcement is a database constraint |
| Anything administrative | Privileged and irreversible |

The service worker already refuses to cache `/api/auth/*` and `/api/me/*`, and
`e2e/pwa.spec.ts` enumerates every cache entry to prove nothing personal lands
there. That is the right foundation; the opportunity is extending *deliberate*
offline reads on top of it, not loosening the rule.

---

## 10. Privacy and security opportunities

* **Selective disclosure** ⚠️ — the largest privacy win available. Proving a
  predicate beats disclosing a value.
* **Status lists also reduce surveillance** ✅ — the issuer stops seeing each
  check.
* **Consent receipts** ◐ — the record exists and is readable (PRIV-003:
  `consent_receipts` snapshots the terms, `/disclosures` renders them, each has a
  `cns_…` reference). What is left is *portability*: a signed, machine-readable
  export somebody could hand to a regulator without trusting this deployment.
* **Key rotation for issuers.** Keys are created lazily and never rotated. A
  rotation story should exist before anyone depends on this in earnest.
* **A published security contact and disclosure policy.** There is none.

---

## 11. Future roadmap, in order

**Now — finish what is started.** Meter the API. Issue receipts on capture.
Webhook redelivery. Resolve the loyalty-config contradiction. These are all
small, all close a gap between what a screen says and what the system does, and
none needs an external account.

**Next — interoperate.** Bitstring Status List, an issuer key document,
idempotency across the partner API, a sandbox environment. This is the step that
turns a good internal platform into one somebody else can build on.

**Then — reach.** Wallet passes, DigiLocker, selective disclosure. Each needs an
external relationship or an account, and each should be started by opening that
relationship rather than by writing code.

**Structural, whenever it blocks something.** A job runner, and moving the
publisher into it.

---

## Implemented now vs recommended later

**Implemented in this pass:** the credential proof is published and independently
verifiable offline; the feature registry makes every unbuilt capability state its
own status; the loading/error/offline states exist; the design system and motion
layer; the landing page, consumer home and quick actions.

**Recommended later:** everything in the gap table above. None of it has been
started, none of it is implied by any screen, and every unbuilt capability that
a screen touches is chipped from `src/lib/features.ts` rather than quietly
looking finished.

---

Sources consulted for the ✅ items:
[W3C VC Working Group, seven Proposed Recommendations](https://www.w3.org/news/2025/seven-proposed-recommendations-published-by-the-verifiable-credentials-working-group/) ·
[Verifiable Credentials Overview](https://www.w3.org/TR/vc-overview/) ·
[Bitstring Status List v1.0](https://www.w3.org/TR/vc-bitstring-status-list/)
