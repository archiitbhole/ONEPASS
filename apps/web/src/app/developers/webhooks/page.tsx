/**
 * The webhook reference: how to verify a delivery, what can arrive, and what
 * happens when your endpoint is down.
 *
 * The signature section comes first and is the longest, because a webhook
 * receiver that does not verify the signature is an unauthenticated POST
 * endpoint that mutates a merchant's records — and the single most common way
 * that happens is documentation that mentions signing somewhere near the
 * bottom.
 *
 * The event catalogue below is generated from `EVENT_DOCS`, whose payloads are
 * the payloads the emit sites actually construct.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { Code } from '@/components/developers/code';
import { EVENT_DOCS, EXAMPLE_ISSUED } from '@/lib/api-catalog';
import { MAX_ATTEMPTS } from '@/lib/webhooks/dispatch';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = {
  title: 'Webhooks',
  description:
    `Receive signed ${BRAND.name} events on your own servers: signature verification, the full event catalogue with real payloads, and the retry schedule.`,
};

const VERIFY_NODE = `import { createHmac, timingSafeEqual } from 'node:crypto';

// The RAW body. Parse it only after the signature checks out — a JSON round
// trip changes whitespace and key order, and the signature is over bytes.
export function isFromOnepass(rawBody, headers, secret) {
  const timestamp = Number(headers['x-onepass-timestamp']);
  const presented = headers['x-onepass-signature'];
  if (!Number.isFinite(timestamp) || typeof presented !== 'string') return false;

  // Reject anything older than five minutes: a valid signature stays valid
  // forever, so without this a captured delivery can be replayed at will.
  if (Math.abs(Date.now() / 1000 - timestamp) > 300) return false;

  const expected = createHmac('sha256', secret)
    .update(\`\${timestamp}.\${rawBody}\`)
    .digest('hex');

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(presented, 'utf8');
  // Length check first: timingSafeEqual throws on a mismatch, and === would
  // leak the answer one byte at a time.
  return a.length === b.length && timingSafeEqual(a, b);
}`;

const VERIFY_PYTHON = `import hmac, hashlib, time

def is_from_onepass(raw_body: bytes, headers, secret: str) -> bool:
    try:
        timestamp = int(headers["x-onepass-timestamp"])
    except (KeyError, ValueError):
        return False
    presented = headers.get("x-onepass-signature", "")

    if abs(time.time() - timestamp) > 300:
        return False

    expected = hmac.new(
        secret.encode(),
        f"{timestamp}.".encode() + raw_body,
        hashlib.sha256,
    ).hexdigest()

    return hmac.compare_digest(expected, presented)`;

export default function WebhooksPage() {
  // A plausible recent timestamp rather than a fixed one. A hard-coded epoch in
  // a header example is a date in disguise, and it goes stale exactly the way a
  // written-out year does.
  const exampleTimestamp = Math.floor(Date.now() / 1000) - 37;

  return (
    <>
      <section className="stack stack-4">
        <p className="eyebrow">Reference</p>
        <h1 className="display h1">Webhooks</h1>
        <p className="lede">
          {BRAND.name} posts a signed JSON body to an endpoint you register, and keeps trying until you
          accept it. Register one in the business console under{' '}
          <span className="mono">API</span>, or with{' '}
          <Link href="/developers/api#webhooks-create">POST /api/partner/…/webhooks</Link>.
        </p>
      </section>

      <section id="signature" className="stack stack-4 anchored">
        <h2 className="h2">Verify the signature. Always.</h2>
        <p className="muted" style={{ maxWidth: '68ch' }}>
          A webhook endpoint is a public URL that changes your records. Without a signature check it
          is an unauthenticated write API, and the only thing stopping anyone from posting{' '}
          <span className="mono">PAYMENT_COMPLETED</span> to it is that they have not guessed the
          URL yet.
        </p>

        <div className="card stack stack-3">
          <h3 className="h3">What arrives</h3>
          <Code language="plain" title="Delivery">{`POST /your/endpoint
content-type: application/json
user-agent: ONEPASS-Webhooks/1
x-onepass-timestamp: ${exampleTimestamp}
x-onepass-signature: 4f1c…  (HMAC-SHA256, hex)`}</Code>
          <p className="muted">
            The signature is computed over{' '}
            <span className="mono">{'`${timestamp}.${rawBody}`'}</span> using the secret returned
            once when you registered the endpoint. The timestamp is in the signed material on
            purpose — signing the body alone would let anyone who captured one delivery replay it
            forever.
          </p>
        </div>

        {/* Stacked, not side by side. Two columns halves the width available to
            a code block, and code that has to be scrolled horizontally to be
            read is code nobody reads. */}
        <div className="card stack stack-4">
          <h3 className="h3">Checking it, in full</h3>
          <Code language="plain" title="Node">{VERIFY_NODE}</Code>
          <Code language="plain" title="Python">{VERIFY_PYTHON}</Code>
        </div>

        <div className="card stack stack-3">
          <h3 className="h3">Three ways this goes wrong</h3>
          <ul className="stack stack-2" style={{ paddingLeft: 18 }}>
            <li className="muted">
              <strong>Comparing with <span className="mono">===</span>.</strong> String comparison
              returns as soon as two bytes differ, which is enough to recover a valid signature one
              character at a time. Use a constant-time compare.
            </li>
            <li className="muted">
              <strong>Signing the parsed body.</strong> Most frameworks hand you a parsed object and
              throw the bytes away. Re-serialising changes whitespace and key order, and the
              signature will never match. Capture the raw body first — in Express that is{' '}
              <span className="mono">express.raw()</span> on this route only.
            </li>
            <li className="muted">
              <strong>Skipping the timestamp window.</strong> A signature with no expiry is a
              password that never rotates. Five minutes is the tolerance we use on the inbound side
              and a sensible one to use here.
            </li>
          </ul>
        </div>
      </section>

      <section id="catalogue" className="stack stack-4 anchored">
        <h2 className="h2">Event catalogue</h2>
        <p className="muted" style={{ maxWidth: '68ch' }}>
          {EVENT_DOCS.length} events. Subscribe to the ones you need, or to{' '}
          <span className="mono">*</span> for everything including events added later. Each payload
          below is what the emit actually constructs — field for field, not an illustration.
        </p>
        <p className="muted" style={{ maxWidth: '68ch' }}>
          Your copy of an event is not the customer&rsquo;s copy. A merchant is told what happened
          to their inventory, their money and their queue; who the customer is stays out of it,
          which is why there is no name, email or account id in any payload here.
        </p>

        <div className="card stack stack-3">
          <h3 className="h3">The envelope</h3>
          <Code title="Envelope">{`{
  "id": "01JB7QG2M5P7R9T1V3X5Z7B9DF",
  "type": "BOOKING_CONFIRMED",
  "at": "${EXAMPLE_ISSUED}T18:12:51.006Z",
  "organizationId": "01JB7Q4Z0TQ7M3T0G6VJ0K2XPQ",
  "data": { }
}`}</Code>
          <p className="muted">
            <span className="mono">id</span> is stable across retries, so it is what you should key
            your idempotency on. The <span className="mono">data</span> object is what changes per
            event type, and is what each entry below describes.
          </p>
        </div>

        {EVENT_DOCS.map((event) => (
          <article key={event.type} id={event.type} className="card stack stack-3 anchored">
            <div className="endpoint-head">
              <h3 className="h3 mono">{event.type}</h3>
            </div>
            <p className="muted" style={{ maxWidth: '68ch' }}>
              {event.when}
            </p>
            <Code title="data">{event.data}</Code>
          </article>
        ))}
      </section>

      <section id="delivery" className="stack stack-4 anchored">
        <h2 className="h2">Delivery and retries</h2>

        <div className="card stack stack-4">
          <ul className="stack stack-2" style={{ paddingLeft: 18 }}>
            <li className="muted">
              <strong>Any 2xx is acceptance.</strong> Return it as soon as you have the event
              durably; do the work afterwards. We wait 8 seconds and then treat the attempt as
              failed.
            </li>
            <li className="muted">
              <strong>4xx is not retried.</strong> A 4xx is your endpoint saying the request is
              wrong, and retrying an argument does not win it. Anything else — 5xx, a timeout, a
              connection failure — is retried.
            </li>
            <li className="muted">
              <strong>{MAX_ATTEMPTS} attempts, then it stops.</strong> Backoff is 30 seconds, 2
              minutes, 10 minutes, 45 minutes.
            </li>
            <li className="muted">
              <strong>Redirects are not followed.</strong> An endpoint that redirects is an endpoint
              that has moved; following it would send a signed payload somewhere you did not
              register. Update the URL instead.
            </li>
            <li className="muted">
              <strong>Order is not guaranteed.</strong> Retries mean a delivery can land after a
              later event. Use <span className="mono">at</span> to order and{' '}
              <span className="mono">id</span> to deduplicate.
            </li>
            <li className="muted">
              <strong>At-least-once, not exactly-once.</strong> A delivery you accepted can arrive
              again if our acknowledgement was lost. Make your handler idempotent; there is no way
              to make delivery exactly-once and anyone who tells you otherwise is describing your
              idempotency, not their delivery.
            </li>
          </ul>
        </div>

        <div className="card stack stack-3">
          <h3 className="h3">What we refuse to send to</h3>
          <p className="muted" style={{ maxWidth: '68ch' }}>
            Plain <span className="mono">http</span>, <span className="mono">localhost</span>,
            private address ranges, link-local addresses and the cloud metadata endpoints are
            rejected at registration. This is an SSRF guard, not a tidiness rule: without it,
            &ldquo;register a webhook&rdquo; reads as &ldquo;make this server POST anywhere you
            like, from inside our network, with a signature attached&rdquo;.
          </p>
          <p className="muted" style={{ maxWidth: '68ch' }}>
            The honest limit: the check is on the URL as registered. A hostname that resolves
            publicly at registration and privately later would not be caught, because we do not
            re-resolve at delivery time.
          </p>
        </div>

        <div className="card stack stack-3">
          <h3 className="h3">Not built yet</h3>
          <p className="muted" style={{ maxWidth: '68ch' }}>
            There is no redelivery button and no per-request log in the console, so a failed
            delivery cannot currently be replayed from our side. Deliveries and their errors are
            recorded; the surface to act on them is not built. If you need an event back before
            that exists, the state it describes is readable through the API.
          </p>
        </div>
      </section>
    </>
  );
}
