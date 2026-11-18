'use client';

/**
 * The application error boundary.
 *
 * There was none before this — an unhandled throw anywhere in the app hit
 * Next's default screen, which on a production build is an unstyled sentence
 * with no way forward and no way to identify what failed.
 *
 * Two things this does that the default cannot:
 *
 * · **Offers a way out.** `reset()` re-renders the segment without a full page
 *   load, which recovers from a transient failure — a database blip, a timed-out
 *   query — without the person losing where they were.
 *
 * · **Surfaces the digest.** Next replaces a server error's message with an
 *   opaque hash before it reaches the browser, deliberately: the real message
 *   may name a table or a column. The digest is the one string that ties what
 *   the person saw to the line in the server log, so it is shown rather than
 *   swallowed.
 *
 * What it must never do is print `error.message`. On the server that is already
 * redacted; on the client it may carry whatever an exception happened to hold.
 */
import { useEffect } from 'react';
import Link from 'next/link';
import { ErrorState } from '@/components/system';

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The server has already logged this with full context. This records the
    // client half — a boundary that caught it in the browser — so the two can
    // be correlated by digest.
    console.error('render failed', { digest: error.digest });
  }, [error]);

  return (
    // A `main` landmark carrying the id the root layout's skip link points at.
    // Without it "Skip to content" went nowhere on the screen a person reaches
    // when something has already gone wrong.
    <main id="main" className="wrap section">
      <ErrorState
        title="This page did not load"
        body="Something failed while putting it together. Nothing you did caused it, and nothing has been lost — trying again often works."
        requestId={error.digest ?? null}
        action={
          <>
            <button type="button" className="btn btn-primary" onClick={reset}>
              Try again
            </button>
            <Link href="/" className="btn">
              Go to the start
            </Link>
          </>
        }
      />
    </main>
  );
}
