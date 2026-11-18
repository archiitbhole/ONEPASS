/**
 * The system reference, in the product.
 *
 * `docs/engineering-reference.md` is the long form and stays the long form —
 * this is the part a developer integrating against ONEPASS needs in order to
 * predict its behaviour, which is a different and much shorter document than
 * the one somebody joining the codebase needs.
 *
 * Everything here is a description of what the repository does, not of what a
 * deployment is certified to do. No compliance claims, no availability targets,
 * no "bank-grade" anything: those are properties of an operated system, and
 * this is a description of source code. The known-limits section at the bottom
 * exists so that distinction is impossible to miss.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { Code } from '@/components/developers/code';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = {
  title: 'System reference',
  description:
    `How ${BRAND.name} is built: authorization, tenant isolation, the credential proof, money handling, the transactional outbox — and what it does not do.`,
};

export default function ArchitecturePage() {
  return (
    <>
      <section className="stack stack-4">
        <p className="eyebrow">How it works</p>
        <h1 className="display h1">System reference</h1>
        <p className="lede">
          Enough of the internals to predict the behaviour you will see, and an honest list of what
          is not built. Written about this repository — not about a certification, an uptime target,
          or a compliance regime.
        </p>
      </section>

      <section id="shape" className="card stack stack-4 anchored">
        <h2 className="h2">Shape</h2>
        <p className="muted" style={{ maxWidth: '70ch' }}>
          One Next.js application, one PostgreSQL database, one Redis. Server components read the
          database directly; route handlers serve the JSON API; a small number of client components
          handle the parts that genuinely need a browser. There is no separate API service, and the
          JSON API is not a second implementation of the pages — both call the same service
          functions.
        </p>
        <p className="muted" style={{ maxWidth: '70ch' }}>
          It needs a container, not a serverless host. The realtime publisher and the outbox drain
          are long-lived in-process work, and a platform that freezes the process between requests
          will silently deliver nothing.
        </p>
      </section>

      <section id="identity" className="card stack stack-4 anchored">
        <h2 className="h2">Identity and sessions</h2>
        <ul className="stack stack-2" style={{ paddingLeft: 18 }}>
          <li className="muted">
            Passwords are hashed with <strong>Argon2id</strong>. They are never stored, logged, or
            returned, and no code path exists that could.
          </li>
          <li className="muted">
            A session token is opaque and random. Only its SHA-256 is stored, so a database dump
            does not contain anything that can be presented as a session.
          </li>
          <li className="muted">
            Every account carries a <span className="mono">sessionGeneration</span>. Bumping it
            invalidates every session everywhere at once — which is what a password change does, and
            what recovery from a compromise needs.
          </li>
          <li className="muted">
            One-time codes are hashed at rest, never returned in a response, and never written to a
            log. In a deployment with no delivery provider configured they are printed to the server
            log so development works; the console says so rather than pretending a message was sent.
          </li>
        </ul>
      </section>

      <section id="isolation" className="card stack stack-4 anchored">
        <h2 className="h2">Authorization, and why 404</h2>
        <p className="muted" style={{ maxWidth: '70ch' }}>
          Permissions are computed per membership, not per account: the same person can be an owner
          of one organization and a door operator at another, and every check names both the
          permission and the organization it is being asked about.
        </p>
        <p className="muted" style={{ maxWidth: '70ch' }}>
          When a check fails for a resource belonging to another tenant, the answer is{' '}
          <strong>404, never 403</strong>. A 403 is an admission that the thing exists, and an
          attacker who can distinguish &ldquo;no such organization&rdquo; from &ldquo;not
          yours&rdquo; can enumerate your customer list one identifier at a time. The two cases are
          indistinguishable from outside, on purpose, and a test suite asserts it stays that way.
        </p>
        <p className="muted" style={{ maxWidth: '70ch' }}>
          Underneath that, PostgreSQL row-level security enforces the same boundary at the database,
          so a query that forgets its tenant filter returns nothing rather than everything. What a
          merchant may read about a customer is gated by a consent-scoped view — fields the customer
          has not shared are absent from the result, and the console says which ones and why rather
          than silently showing blanks.
        </p>
      </section>

      <section id="credentials" className="card stack stack-4 anchored">
        <h2 className="h2">Credentials</h2>
        <p className="muted" style={{ maxWidth: '70ch' }}>
          Each issuing organization has an Ed25519 keypair, created on first issuance. The private
          half is sealed with the platform encryption key and never leaves the server; the public
          half is published on every verification response, because publishing it is the point.
        </p>
        <p className="muted" style={{ maxWidth: '70ch' }}>
          Claims are canonicalised before hashing — keys sorted, serialised as{' '}
          <span className="mono">[key, value]</span> pairs — so the bytes that were signed can be
          rebuilt exactly by anyone. The signature is over the SHA-256 of those bytes.
        </p>
        <Code language="plain">{`claims      → sort keys → JSON [[k,v], …] → SHA-256 → Ed25519 sign
verifier    → same canonicalisation → same hash → verify with issuer public key`}</Code>
        <p className="muted" style={{ maxWidth: '70ch' }}>
          The rotating pass is RFC 6238 TOTP over a per-pass secret. Replay is prevented by a unique
          index on <span className="mono">(pass, organization, counter)</span> — presenting the same
          code twice is refused by the database, not by a check somebody could forget to write.
        </p>
        <p style={{ maxWidth: '70ch', fontSize: 14 }}>
          <strong>What this does not establish.</strong> A valid signature proves an issuer produced
          those claims. It does not make a document legally authentic, and nothing in this system
          asserts that it does — legal effect depends on the issuer and the jurisdiction, not on
          cryptography and not on us.
        </p>
      </section>

      <section id="money" className="card stack stack-4 anchored">
        <h2 className="h2">Money</h2>
        <ul className="stack stack-2" style={{ paddingLeft: 18 }}>
          <li className="muted">
            Amounts are integers in minor units — paise — everywhere: in the database, in the API,
            in every calculation. There is no floating-point money in this system.
          </li>
          <li className="muted">
            A payment is only ever confirmed by a provider webhook whose signature we verified
            server-side. A browser saying the payment succeeded is not evidence and is never treated
            as any.
          </li>
          <li className="muted">
            Capture is idempotent. A provider retrying a delivery after a timeout settles the same
            transaction once, and a duplicate never unwinds a sale that has already completed.
          </li>
          <li className="muted">
            An unknown order id on a webhook returns 5xx rather than 200, so the provider keeps
            retrying while we work out why — a 200 would tell them to stop, permanently.
          </li>
          <li className="muted">
            Card numbers, CVVs and UPI PINs are not stored, not logged and not received. The
            provider holds those; {BRAND.name} holds an order id and an amount.
          </li>
        </ul>
      </section>

      <section id="realtime" className="card stack stack-4 anchored">
        <h2 className="h2">Real time</h2>
        <p className="muted" style={{ maxWidth: '70ch' }}>
          Every event is written to an outbox table inside the same transaction as the change it
          describes. A publisher drains that table and fans out over Redis pub/sub to connected
          streams and to the webhook delivery queue.
        </p>
        <p className="muted" style={{ maxWidth: '70ch' }}>
          That ordering is the whole design: an event cannot describe a write that rolled back, and
          a write cannot fail to produce its event because a network call failed at the wrong
          moment. The price is that delivery is <strong>at least once</strong> and unordered under
          retry, which your handlers have to account for.
        </p>
        <p className="muted" style={{ maxWidth: '70ch' }}>
          Three channels: <span className="mono">user:&lt;id&gt;</span>,{' '}
          <span className="mono">org:&lt;id&gt;</span> and <span className="mono">platform</span>.
          Webhook dispatch only ever reads organization channels — a consumer&rsquo;s own activity is
          not a merchant&rsquo;s to receive, and that is enforced by which channel an event is
          addressed to rather than by a filter somewhere downstream.
        </p>
      </section>

      <section id="limits" className="stack stack-4 anchored">
        <h2 className="h2">Known limits</h2>
        <p className="muted" style={{ maxWidth: '70ch' }}>
          The things most likely to matter to you, said plainly rather than discovered later.
        </p>

        <div className="card stack stack-3">
          <ul className="stack stack-2" style={{ paddingLeft: 18 }}>
            <li className="muted">
              <strong>The partner API needs a session.</strong> Issuing, keys and webhooks are
              browser-console routes: a cookie plus a same-origin check. API keys exist and carry
              scopes, but only verification reads them today.
            </li>
            <li className="muted">
              <strong>There is no scheduler.</strong> Insight refreshes, the security sweep and the
              expiry sweep are triggered by a person pressing a button. Nothing runs on a timer.
            </li>
            <li className="muted">
              <strong>Delivery providers may not be configured.</strong> Email and SMS adapters are
              written and tested; without credentials, codes print to the server log. A deployment
              says which state it is in rather than implying a message was sent.
            </li>
            <li className="muted">
              <strong>One environment.</strong> There is no separate sandbox with its own keys.
              Sandbox transactions are labelled where they appear, but they share the deployment.
            </li>
            <li className="muted">
              <strong>No published SDK.</strong> The API is plain HTTP and JSON and is documented as
              such. A client library would be a second thing to keep in step with the first.
            </li>
            <li className="muted">
              <strong>Webhook URL checks do not re-resolve.</strong> The SSRF guard runs at
              registration. A hostname that resolves publicly then and privately later would not be
              caught.
            </li>
            <li className="muted">
              <strong>Single-instance assumptions in one place.</strong> The realtime publisher runs
              in-process. Correct for one instance; at scale it becomes a separate worker, which
              changes nothing at any write site — that is what the outbox is for.
            </li>
          </ul>
        </div>

        <div className="card stack stack-3">
          <h3 className="h3">What this page is not</h3>
          <p className="muted" style={{ maxWidth: '70ch' }}>
            It is not a compliance statement. This is a description of how the source code behaves;
            whether a given deployment is secure, available, or compliant with anything depends on
            how it is operated, and that is not a claim source code can make on its own. There are
            no certifications behind this system, no tested recovery objectives, and no audited
            availability figures — and you should treat any product that offers you those numbers
            without naming the audit the same way.
          </p>
          <p className="muted" style={{ maxWidth: '70ch' }}>
            The longer engineering reference, including the debugging-by-symptom section, ships in
            the repository at <span className="mono">docs/engineering-reference.md</span>.
          </p>
        </div>
      </section>

      <section className="card stack stack-3">
        <h2 className="h3">Related</h2>
        <p className="row-wrap">
          <Link className="btn" href="/developers/api">
            API reference
          </Link>
          <Link className="btn" href="/developers/webhooks">
            Webhooks
          </Link>
          <Link className="btn" href="/developers/status">
            What is built
          </Link>
        </p>
      </section>
    </>
  );
}
