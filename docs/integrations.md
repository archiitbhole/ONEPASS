# Integrations

Everything ONEPASS exchanges with software it does not control: what it calls
out to, what calls in, and exactly which credential each one needs.

Two rules govern this whole document.

**A signature is the only thing that authenticates a machine.** Inbound, that
means a payment is captured because the provider signed a callback, never
because a browser came back to a success URL. Outbound, it means ONEPASS signs
what it sends so a partner can hold it to the same standard. There is no
integration here that trusts an origin header, a redirect, or a query parameter.

**A missing credential is a refusal, not a fallback.** Production will not boot
on a console email transport or a sandbox payment provider. Nothing degrades
into pretending — if a key is absent, the platform says so at startup rather
than silently doing nothing at the moment it matters.

---

## 1. Payments — Razorpay (inbound)

UPI is the rail this product is designed around, which is why Razorpay is the
default rather than Stripe.

### What is implemented

| Piece | Where | State |
|---|---|---|
| Order creation | `apps/web/src/lib/payments/provider.ts` | Real `POST https://api.razorpay.com/v1/orders` |
| Signature verification | same file, `verifyWebhook` | HMAC-SHA256, constant-time compare |
| Checkout entry point | `apps/web/src/app/api/checkout/begin/route.ts` | Resolves a public offer ref, takes holds, opens one order |
| Capture | `apps/web/src/app/api/webhooks/payments/route.ts` | The only path that captures |
| Stripe | `provider.ts` | **Not implemented** — throws rather than pretending |

### Credentials you need to supply

```
PAYMENT_PROVIDER=RAZORPAY
RAZORPAY_KEY_ID=rzp_live_xxxxxxxxxxxx
RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx
RAZORPAY_WEBHOOK_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx
```

`RAZORPAY_KEY_ID` is publishable and is returned to the browser so the
provider's own checkout can open. The other two never leave the server and never
appear in a response, a log line or an audit row.

Get them from the Razorpay Dashboard: **Settings → API Keys** for the first two,
and **Settings → Webhooks** for the third, which Razorpay calls the webhook
secret and generates when you add the endpoint.

### Configuring the webhook at Razorpay

Point it at:

```
https://<your-domain>/api/webhooks/payments
```

Subscribe to `payment.captured` and `payment.failed`. `payment.authorized` is
accepted and acknowledged but deliberately changes nothing — an authorisation is
not money, and holds become sales only on capture.

### What the endpoint does, and why

- Reads the body as **raw bytes** and verifies before parsing. Anything that
  re-serialises the body first — `req.json()`, a schema parse, a proxy that
  reformats — breaks a valid signature and, worse, makes an invalid one verify
  against whatever was reconstructed.
- Rejects a bad signature with **400** and files a `payment.webhook.rejected`
  security event. Neither the body nor the attempted signature is stored: one is
  unverified attacker input and the other is a credential attempt.
- Answers **5xx** when it verifies a callback for an order it has never heard
  of. This is deliberate. A webhook can beat the commit that created the
  transaction, and answering 2xx would tell Razorpay to stop retrying — losing a
  real payment. It retries with backoff and succeeds on the next attempt.
- Is **idempotent**. Capture is a conditional `UPDATE` gated on
  `INITIATED|AUTHORIZED`, so a redelivery confirms nothing twice and issues no
  second ticket. Providers redeliver as a matter of course.
- **Never unwinds a captured sale** if a failure arrives afterwards. That is a
  dispute or a refund — each its own flow with its own money movement.

Covered by `apps/web/src/lib/payments/webhook.test.ts`: ten tests, including a
body edited after signing, a redelivery three times over, and a failure arriving
after a capture.

---

## 2. Webhooks — ONEPASS calling a partner (outbound)

The same contract, pointed the other way, so a merchant's own software learns
that a booking arrived or a ticket was admitted at the moment it happens instead
of polling or finding out at close of day.

### How it works

Dispatch rides the **transactional outbox**. Every emitter already writes an
outbox row inside the transaction that caused it, which is what guarantees
nothing is announced that did not commit. `apps/web/src/lib/webhooks/dispatch.ts`
hangs off that same drain, so no write site changes, no write site can forget,
and an event delivered to a browser and one delivered to a merchant's server are
by construction the same event.

Queueing and sending are separate passes. A partner endpoint that takes eight
seconds to time out must not hold up the events behind it or the browser stream
beside it.

### What a partner receives

```http
POST https://their-endpoint.example.com/hooks/onepass
content-type: application/json
user-agent: ONEPASS-Webhooks/1
x-onepass-timestamp: 1894703400
x-onepass-signature: 9f2b…<hex>

{
  "id": "01J…",
  "type": "BOOKING_CONFIRMED",
  "at": "2030-01-15T10:30:00.000Z",
  "organizationId": "01H…",
  "data": { "bookingRef": "bkg_…", "quantity": 2, "amountMinor": 30000 }
}
```

### How a partner verifies it

HMAC-SHA256 over `` `${x-onepass-timestamp}.${rawBody}` ``, hex, compared in
constant time. The timestamp is **inside** the signed material, not beside it, so
a captured request cannot be replayed later; reject anything more than five
minutes old.

`verifySignature` in `apps/web/src/lib/webhooks/dispatch.ts` is the reference
implementation, and it is the implementation — the tests verify what is actually
sent.

### Delivery behaviour

- Five attempts, backing off roughly 30s → 2m → 10m → 45m, then left failed and
  visible in the partner console rather than retried forever.
- 8-second timeout per attempt.
- Any 2xx is acceptance. 4xx is the endpoint saying the request is wrong;
  retrying an argument does not win it.
- **Redirects are not followed.** Following one would send a signed payload
  somewhere the merchant never registered — an open redirect with a credential
  attached.
- Claimed with `FOR UPDATE SKIP LOCKED` and the claim committed before any HTTP
  happens, so two instances draining at once never send the same delivery twice.

### Registering an endpoint

`POST /api/partner/<orgId>/webhooks`, or the **Register an endpoint** form on the
business console's API page. Requires `partner.webhook:write`.

```json
{ "url": "https://your-system.example.com/hooks/onepass",
  "events": ["BOOKING_CONFIRMED", "TICKET_ADMITTED"] }
```

`"*"` subscribes to everything, including event types added later.

The signing secret is **generated by the server**, returned once in the creation
response, and stored sealed with the AES-256-GCM key ring. A caller-supplied
secret would be a caller-chosen one, and it would arrive in a request body and a
log.

**The URL must be public HTTPS.** `localhost`, private ranges, link-local
addresses (including the cloud metadata endpoint) and credentials-in-URL are all
refused. Without that check, "register a webhook" reads as "make this server POST
anywhere you like, from inside our network, with a signature header attached".

> **A stated limit.** The guard checks the host as written. A hostname that
> resolves to a private address at request time — a DNS rebind — is not caught,
> and catching it properly means pinning the resolved address at connect time. On
> a platform with egress rules that is the network's job; where there are none,
> this is a real gap, and it is better stated than implied.

### Events a partner can subscribe to

`BOOKING_CONFIRMED`, `BOOKING_CANCELLED`, `BOOKING_HELD`, `TICKET_ADMITTED`,
`PAYMENT_COMPLETED`, `PAYMENT_INITIATED`, `RECEIPT_ISSUED`, `RETURN_REQUESTED`,
`RETURN_DECIDED`, `PASS_PRESENTED`, `CONSENT_GRANTED`, `CONSENT_REVOKED`.

The canonical list is `EVENT_TYPES` in
`apps/web/src/lib/webhooks/subscriptions.ts`; the console and the dispatcher read
that same constant, so the catalogue shown to a partner cannot drift from what
actually fires.

A subscriber only ever receives events on its **own** organization's channel,
enforced from the channel the transaction wrote — not from anything the
subscriber registered. A consumer's personal events are on their own channel and
are never delivered to a merchant.

No credentials are needed from you for this. It is ONEPASS's own outbound
integration and it works as soon as a partner registers an endpoint.

---

## 3. API keys — a partner's server calling ONEPASS

`POST /api/partner/<orgId>/api-keys` (requires `partner.apikey:write`), or the
**Create an API key** form on the same console page.

- Returned once as `op_live_…`; only a SHA-256 is stored, so neither the console
  nor a database dump can produce a working key.
- The prefix `op_live_<8>` is stored in the clear and is what appears in the
  console and in logs, so a key can be identified and revoked without ever
  needing the secret half.
- **Scopes cannot exceed the creator's own.** Recomputed from that member's roles
  with the same function every other authorisation decision uses.
- Grantable scopes are a deliberate subset: read, issue, revoke and verify.
  Managing teammates, changing roles and refunding a payment are absent — those
  are decisions a person takes with a session behind them, not something a
  long-lived key in a CI configuration should be able to do.
- Revoked, never deleted (`DELETE /api/partner/<orgId>/api-keys/<keyId>`). A key
  that issued credentials is part of the explanation for how they exist.

---

## 4. Delivery — email and SMS (outbound)

| Provider | Endpoint | Environment |
|---|---|---|
| Resend | `POST https://api.resend.com/emails` | `EMAIL_PROVIDER=RESEND`, `RESEND_API_KEY`, `EMAIL_FROM` |
| MSG91 | `POST https://control.msg91.com/api/v5/flow/` | `SMS_PROVIDER=MSG91`, `MSG91_AUTH_KEY`, `MSG91_SENDER_ID` |
| SES | — | **Not implemented.** Selecting it refuses to boot rather than silently dropping mail |
| Twilio | — | **Not implemented**, same |

Production refuses to start on `CONSOLE` for either channel, on a provider whose
adapter is unwritten, or on a wired provider with no credential. Each of those
refusals is asserted by a test — the failure mode being guarded against is an
OTP that goes to a log file while a person stares at a sign-in screen.

> **Known gap.** The MSG91 adapter posts to the v5 *flow* endpoint but sends a
> `message` body rather than a `flow_id` and template variables. Against a real
> MSG91 account that is likely to be rejected. Whoever wires up the account
> should expect to adjust `sendSms` in `apps/web/src/lib/delivery.ts` to match the
> template they create there.

---

## 5. Flights — licensed providers (outbound)

ONEPASS holds no air inventory. Every fare in `/travel` is quoted by a provider
its operator is entitled to use, and is booked with that provider under its
terms. The adapter interface is `FlightProvider` in
`src/lib/travel/providers/types.ts`; adding a source is one file and one entry
in the registry.

### What counts as a legitimate source

An airline's own developer API, an authorised NDC channel, or a licensed GDS or
aggregator with a signed agreement. That list is the whole of it. There is no
adapter in this repository that scrapes a website, works around a CAPTCHA or bot
protection, reuses somebody else's session, or reads a booking page it was not
invited to — and there should never be. Those are not implementation shortcuts;
they are the difference between a business and a liability, and they stop
working the first time anybody notices.

### The two that are written

| Provider | Kind | Needs | Status |
|---|---|---|---|
| **Amadeus Self-Service** | Licensed GDS channel | `AMADEUS_CLIENT_ID`, `AMADEUS_CLIENT_SECRET`, `AMADEUS_ENVIRONMENT` | Adapter written against the published specification, covered by unit tests over recorded response shapes. **Not exercised against a live account.** |
| **Duffel** | Authorised NDC aggregator | `DUFFEL_ACCESS_TOKEN`, `DUFFEL_API_VERSION` | Adapter written against the published API, covered by unit tests over recorded response shapes. **Not exercised against a live account.** |

Both distinctions matter and are repeated on `/developers/status`, on `/travel`
and in the feature registry: "written against the published API" and "tested
against a live account" are different claims, and only the first is true here.
This repository holds no credentials for either provider, and inventing some to
be able to say otherwise would be worse than saying so.

**Amadeus** — sign up at `developers.amadeus.com` for the free test tier;
production needs a signed agreement and `AMADEUS_ENVIRONMENT=production`. Offers
are stateless: pricing or booking one means sending the whole offer object back,
which is why `offer-store.ts` exists.

**Duffel** — sign up at `duffel.com`. Orders are paid from a Duffel balance the
operator funds. That is a separate movement from the customer's card payment,
which reaches ONEPASS through its own payment provider, and the two are
reconciled as such.

### The development source

`TRAVEL_SAMPLE_PROVIDER=true` serves deterministic fixture fares so the screens,
the booking state machine and the tests can be exercised without a provider
account. **`env.ts` refuses to start a production process with it enabled**, and
`scripts/smoke-prod.sh` sets it to `false` explicitly. A fixture fare that
reached a checkout would be a fare somebody paid for that no airline has any
record of.

Every offer it produces is tagged `SAMPLE` all the way to the screen, where it
is labelled as sample data rather than blended in with real fares, and the
references it issues (`SMPL…`, `SAMPLE-…`) could not be mistaken for an
airline's.

### With nothing configured

A deployment with no flight source still runs. `/travel` says so in plain words,
names the environment variables an operator has to set, and returns no fares —
which is the only honest behaviour, because a fare that cannot be booked is
worse than no fare at all.

---

## 6. What is deliberately not integrated

Worth being explicit, because these are the names people expect to see.

**BookMyShow, Zomato, Swiggy, MakeMyTrip, Ola, Uber** have no public partner API
that a third party can build against. There is no honest integration to write;
anything claiming to pull live data from them would be a scrape or a fiction.
Where ONEPASS needs that inventory, the direction is the partner API above —
those businesses pushing to ONEPASS, or a commerce network standard both sides
already speak.

**DigiLocker** is a real and appropriate integration for the credential wallet,
and it requires registration as a requester organisation with NeGD before any
code can be tested against it. Not started, because a partner registration is a
prerequisite rather than an implementation detail.

**Place and map data.** Venue rows are currently created only by the seed, so
coverage is whatever has been seeded rather than anywhere in India. A keyed
provider (Google Places, Mapbox) is the straightforward fix and needs an account
before it can be built honestly.

---

## Configuration summary

Everything an operator must supply, in one place:

```bash
# Payments
PAYMENT_PROVIDER=RAZORPAY
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=

# Email
EMAIL_PROVIDER=RESEND
RESEND_API_KEY=
EMAIL_FROM="ONEPASS <no-reply@your-domain>"

# SMS
SMS_PROVIDER=MSG91
MSG91_AUTH_KEY=
MSG91_SENDER_ID=

# Flights — at least one, or /travel has nothing to search
AMADEUS_CLIENT_ID=
AMADEUS_CLIENT_SECRET=
AMADEUS_ENVIRONMENT=test          # test | production
DUFFEL_ACCESS_TOKEN=
DUFFEL_API_VERSION=v2
TRAVEL_SAMPLE_PROVIDER=false      # refused in production
TRAVEL_PLATFORM_FEE_BP=0          # basis points; always its own line at checkout
```

Set them in the host's environment, never in a file in the repository. The build
strips any `.env` from the deployable bundle for exactly this reason — see
`docs/deployment.md`.
