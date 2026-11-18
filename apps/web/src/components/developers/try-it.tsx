'use client';

/**
 * Run the verification call from the documentation page.
 *
 * This is real. It POSTs to this deployment's own `/api/v1/verify` and prints
 * exactly what comes back — status line, timing, body. A "Try it" that returns
 * a canned response would be a lie told on the page where a developer decides
 * whether to trust the system, which is the worst possible place to tell one.
 *
 * **There is no API key field, deliberately.** A key pasted into a form on a
 * public page is a key in browser memory, in the network tab, and one stray
 * `console.log` from being in a log. The key changes attribution and metering
 * and nothing else — the verdict is identical without it — so there is nothing
 * a reader learns from sending one here that they cannot learn from the curl
 * example, and the curl example runs on their machine where the key belongs.
 *
 * Safe to expose because the endpoint is genuinely open: no session is spent,
 * no state is changed, it is rate limited by address like every other caller,
 * and references are random rather than sequential so there is nothing to walk.
 */
import { useCallback, useRef, useState } from 'react';
import { Code } from './code';

interface Outcome {
  status: number;
  ms: number;
  body: string;
  /** A network failure, as opposed to an HTTP error — those still have a status. */
  transportError?: string;
}

export function TryVerify({ sample }: { sample: string }) {
  const [reference, setReference] = useState(sample);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  // One in-flight call at a time. Double-clicking Run would otherwise race two
  // responses and render whichever returned last, which on a rate-limited
  // endpoint is a confusing way to show a 429.
  const inFlight = useRef(false);

  const run = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    const startedAt = performance.now();

    try {
      const res = await fetch('/api/v1/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reference: reference.trim() }),
      });
      const text = await res.text();
      let body = text;
      try {
        body = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        /* Not JSON — show it raw rather than hiding whatever went wrong. */
      }
      setOutcome({ status: res.status, ms: Math.round(performance.now() - startedAt), body });
    } catch (err) {
      setOutcome({
        status: 0,
        ms: Math.round(performance.now() - startedAt),
        body: '',
        transportError: err instanceof Error ? err.message : 'The request did not complete.',
      });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [reference]);

  const tone =
    outcome == null ? '' : outcome.status === 200 ? 'chip-live' : outcome.status === 0 ? 'chip-soon' : 'chip-config';

  return (
    <div className="stack stack-3">
      <div className="row-wrap" style={{ gap: 8 }}>
        <input
          className="input input-mono"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void run();
            }
          }}
          placeholder="cred_…"
          aria-label="Credential reference to verify"
          spellCheck={false}
          autoComplete="off"
          style={{ flex: '1 1 240px', minWidth: 0 }}
        />
        <button type="button" className="btn btn-primary" onClick={() => void run()} disabled={busy}>
          {busy ? 'Running…' : 'Run'}
        </button>
      </div>

      <p className="muted" style={{ fontSize: 13 }}>
        This posts to <span className="mono">/api/v1/verify</span> on this deployment and prints what
        comes back. No key is sent — a key changes attribution, never the verdict.
      </p>

      {outcome ? (
        <div className="stack stack-2">
          <div className="row-wrap" style={{ gap: 8, alignItems: 'center' }}>
            <span className={`chip ${tone}`}>
              {outcome.status === 0 ? 'No response' : `HTTP ${outcome.status}`}
            </span>
            <span className="muted mono" style={{ fontSize: 12 }}>
              {outcome.ms} ms
            </span>
          </div>
          {outcome.transportError ? (
            <p className="muted" style={{ fontSize: 13 }}>
              {outcome.transportError} This usually means the deployment is not reachable from here.
            </p>
          ) : (
            <Code>{outcome.body}</Code>
          )}
        </div>
      ) : null}
    </div>
  );
}
