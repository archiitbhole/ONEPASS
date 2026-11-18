'use client';

/**
 * Step-up: confirm the password, then carry on with what you were doing.
 *
 * Client because it holds the pending action and a password field. Some actions
 * (REQUIRES_ELEVATION) need a person at the keyboard, and the server says so
 * with REAUTH_REQUIRED. Before this existed that error was a dead end — the
 * message said "confirm your password" and there was nowhere to confirm it, so
 * the only way through was to sign out and back in.
 *
 * `useStepUp().run(action)` runs the action; if the server asks for the
 * password, a small inline prompt appears, `/api/auth/step-up` elevates the
 * session, and the *same* action runs again. Nothing is resubmitted that the
 * person did not already ask for, and the password is posted to exactly one
 * endpoint and kept in no state beyond the field it was typed into.
 */
import { useCallback, useId, useRef, useState } from 'react';
import type { StepUpBody, StepUpResponse } from '@/lib/auth/contracts';

/** The server wants a recent password before it will do this. */
export class ReauthRequired extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReauthRequired';
  }
}

interface ErrorBody {
  error?: { code?: string; message?: string; requestId?: string };
}

/**
 * POST JSON and turn the error envelope into something a form can show.
 * REAUTH_REQUIRED becomes a `ReauthRequired` so `useStepUp` can catch it.
 */
export async function postJson<T = Record<string, unknown>>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T & ErrorBody;
  if (!res.ok) {
    const message = json.error?.message ?? `That request failed (${res.status}).`;
    if (json.error?.code === 'REAUTH_REQUIRED') throw new ReauthRequired(message);
    throw new Error(json.error?.requestId ? `${message} (request ${json.error.requestId})` : message);
  }
  return json;
}

interface Pending {
  action: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

export function useStepUp() {
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fieldId = useId();
  const headingId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const run = useCallback(<T,>(action: () => Promise<T>): Promise<T> => {
    return action().catch((err: unknown) => {
      if (!(err instanceof ReauthRequired)) throw err;
      return new Promise<T>((resolve, reject) => {
        setError(null);
        setPending({ action, resolve: resolve as (v: unknown) => void, reject });
        requestAnimationFrame(() => inputRef.current?.focus());
      });
    });
  }, []);

  const cancel = () => {
    pending?.reject(new Error('Cancelled.'));
    setPending(null);
    setError(null);
  };

  async function confirm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pending) return;
    const password = String(new FormData(event.currentTarget).get('password') ?? '');
    setBusy(true);
    setError(null);
    try {
      await postJson<StepUpResponse>('/api/auth/step-up', { password } satisfies StepUpBody);
      const current = pending;
      setPending(null);
      // The same action, once. If it fails now it fails for its own reasons,
      // and those are the caller's to show.
      current.action().then(current.resolve, current.reject);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work.');
      inputRef.current?.select();
    } finally {
      setBusy(false);
    }
  }

  const prompt = pending ? (
    <form
      onSubmit={confirm}
      className="card-flat stack stack-3"
      role="group"
      aria-labelledby={headingId}
      onKeyDown={(event) => {
        if (event.key === 'Escape') cancel();
      }}
    >
      <p id={headingId} className="small" style={{ margin: 0 }}>
        <strong>Confirm it&rsquo;s you.</strong> This action needs your password again because it
        cannot be undone by the person who does it by accident.
      </p>
      {error ? (
        <div className="notice notice-bad" role="alert">
          {error}
        </div>
      ) : null}
      <div className="field">
        <label className="label" htmlFor={fieldId}>
          Your password
        </label>
        <input
          ref={inputRef}
          id={fieldId}
          name="password"
          type="password"
          className="input"
          autoComplete="current-password"
          required
        />
      </div>
      <div className="row-wrap" style={{ gap: 8 }}>
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
          {busy ? 'Checking…' : 'Confirm and continue'}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={cancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  ) : null;

  return { run, prompt };
}
