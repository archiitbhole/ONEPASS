/**
 * The error reference.
 *
 * One shape for the whole API, one anchor per code, and a "what to do" column
 * that is not "contact support" — a test enforces that last part, because it is
 * the sentence everybody reaches for when they have run out of things to say
 * and it is worth exactly nothing to the person reading it.
 */
import type { Metadata } from 'next';
import { Code } from '@/components/developers/code';
import { ERROR_DOCS } from '@/lib/api-catalog';
import { MAX_BODY_BYTES } from '@/lib/api';
import { LIMITS } from '@/lib/ratelimit';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = {
  title: 'Errors',
  description:
    `Every error ${BRAND.name} returns, what it means, and what to do about it — plus the rate-limit headers on every response.`,
};

export default function ErrorsPage() {
  return (
    <>
      <section className="stack stack-4">
        <p className="eyebrow">Reference</p>
        <h1 className="display h1">Errors</h1>
        <p className="lede">
          One envelope for the whole API. A stable machine code, a sentence a person can act on, and
          the request id to quote at support — and never a stack trace, an ORM message, or anything
          that distinguishes &ldquo;no such account&rdquo; from &ldquo;wrong password&rdquo;.
        </p>
      </section>

      <section className="card stack stack-4">
        <h2 className="h3">The shape</h2>
        <Code>{`{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Some fields need attention.",
    "requestId": "cee7134e9e9e4e8e9019",
    "details": {
      "fields": [
        { "path": "reference", "message": "String must contain at least 4 character(s)" }
      ]
    }
  }
}`}</Code>
        <p className="muted">
          <span className="mono">details</span> is present only where there is something structured
          to say — today that is schema validation, where it names every offending path. Branch on{' '}
          <span className="mono">code</span>, never on <span className="mono">message</span>: the
          message is written for a person and will be reworded.
        </p>
      </section>

      <section className="stack stack-4">
        <h2 className="h2 anchored">Every code</h2>
        {ERROR_DOCS.map((d) => (
          <article key={d.code} id={d.code} className="card stack stack-3 anchored">
            <div className="endpoint-head">
              {/* Warn for a caller's mistake, alarm for ours. A whole column of
                  red would say every error is equally our fault, which is the
                  opposite of what a 422 means. */}
              <span
                className={`method ${d.status >= 500 ? 'method-delete' : 'method-patch'}`}
                style={{ minWidth: 48 }}
              >
                {d.status}
              </span>
              <h3 className="h3 mono">{d.code}</h3>
            </div>
            <p className="muted" style={{ maxWidth: '70ch' }}>
              {d.meaning}
            </p>
            <p style={{ maxWidth: '70ch', fontSize: 14 }}>
              <strong>What to do.</strong> {d.fix}
            </p>
          </article>
        ))}
      </section>

      <section className="card stack stack-4">
        <h2 className="h3 anchored">Rate limits</h2>
        <p className="muted">
          Every response carries the current state of the policy that applied to it, so you can slow
          down before you are refused rather than after.
        </p>
        <Code language="plain">{`RateLimit-Limit: 120
RateLimit-Remaining: 118
RateLimit-Reset: 47
Retry-After: 47          (only on a 429)`}</Code>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Policy</th>
                <th scope="col">Allowance</th>
                <th scope="col">Window</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(LIMITS).map(([name, policy]) => (
                <tr key={name}>
                  <td className="mono" style={{ fontSize: 12.5 }}>
                    {name}
                  </td>
                  <td className="table-num">{policy.limit}</td>
                  <td className="table-num">{policy.windowSeconds}s</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted">
          Limits are counted per client address, except where a policy names something more specific
          — sign-in is counted per address <em>and</em> per identifier, so one attacker cannot lock
          out an account by spending its allowance from elsewhere.
        </p>
      </section>

      <section className="card stack stack-3">
        <h2 className="h3 anchored">Other hard limits</h2>
        <ul className="stack stack-2" style={{ paddingLeft: 18 }}>
          <li className="muted">
            Request bodies over {Math.round(MAX_BODY_BYTES / 1024)} KB are refused with{' '}
            <span className="mono">PAYLOAD_TOO_LARGE</span>, checked twice: once on the declared{' '}
            <span className="mono">content-length</span> and once on what actually arrived.
          </li>
          <li className="muted">
            A page is at most 100 items. Pagination is a cursor on the ULID primary key, so pages
            stay stable while rows are being inserted.
          </li>
          <li className="muted">
            An outbound webhook attempt is abandoned after 8 seconds. Accept fast and work
            afterwards.
          </li>
        </ul>
      </section>
    </>
  );
}
