'use client';

/**
 * Your data: asking for a copy, and closing the account.
 *
 * Both are `REQUIRES_ELEVATION` permissions, so the server refuses a session
 * that has not re-entered its password recently. `useStepUp()` is what turns
 * that refusal into a prompt and then retries the *same* action — before it
 * existed, an export request simply dead-ended fifteen minutes into a session.
 *
 * Closing the account goes through a native `<dialog>`: focus is trapped and
 * returned by the browser, Escape closes it, and the confirmation is a sentence
 * the person reads rather than a `confirm()` string the browser styles like a
 * warning about pop-ups.
 *
 * Every sentence here is what the endpoints actually do, checked against them:
 * `POST /api/me/export` records a request and announces it and nothing else —
 * no archive is written anywhere — and `DELETE /api/me/account` files a
 * deletion request, moves the account to DELETION_PENDING (which stops its
 * sessions resolving on the next request) and leaves a thirty-day window in
 * which support can undo it. Neither deletes a row today.
 */
import { useRef, useState } from 'react';
import { ButtonLink, Button, Notice } from '@/components/ui';
import { ReauthRequired, useStepUp } from '@/components/auth/step-up';

interface Envelope {
  error?: { code?: string; message?: string; requestId?: string };
}

/** POST/DELETE JSON, turning the API's envelope into something to show or step up for. */
async function send<T>(path: string, method: 'POST' | 'DELETE', body: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'same-origin',
  });
  const parsed = (await res.json().catch(() => ({}))) as T & Envelope;
  if (!res.ok) {
    const message = parsed.error?.message ?? `The server refused that with HTTP ${res.status}.`;
    if (parsed.error?.code === 'REAUTH_REQUIRED') throw new ReauthRequired(message);
    throw new Error(parsed.error?.requestId ? `${message} (request ${parsed.error.requestId})` : message);
  }
  return parsed;
}

function longDate(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(iso));
}

export function SettingsData({ graceDaysHint }: { graceDaysHint: number }) {
  const { run, prompt } = useStepUp();
  const dialog = useRef<HTMLDialogElement>(null);

  const [exportState, setExportState] = useState<{ kind: 'idle' | 'busy' } | { kind: 'done' | 'error'; message: string }>(
    { kind: 'idle' },
  );
  const [closeState, setCloseState] = useState<
    { kind: 'idle' | 'busy' } | { kind: 'error'; message: string } | { kind: 'filed'; executeAfter: string }
  >({ kind: 'idle' });

  async function requestExport() {
    setExportState({ kind: 'busy' });
    try {
      const result = await run(() => send<{ status: string; requestedAt: string }>('/api/me/export', 'POST', {}));
      setExportState({
        kind: 'done',
        message: `Recorded as ${result.status}. It is on your security activity and in your notifications. Nothing is generated yet — see below.`,
      });
    } catch (err) {
      setExportState({ kind: 'error', message: err instanceof Error ? err.message : 'That did not work.' });
    }
  }

  async function closeAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = String(new FormData(event.currentTarget).get('reason') ?? '').trim();
    dialog.current?.close();
    setCloseState({ kind: 'busy' });
    try {
      const result = await run(() =>
        send<{ executeAfter: string; graceDays: number }>('/api/me/account', 'DELETE', reason ? { reason } : {}),
      );
      setCloseState({ kind: 'filed', executeAfter: result.executeAfter });
    } catch (err) {
      setCloseState({ kind: 'error', message: err instanceof Error ? err.message : 'That did not work.' });
    }
  }

  return (
    <div className="stack stack-5">
      {prompt}

      <div className="stack stack-3">
        <h3 className="h3">Ask for a copy of your data</h3>
        <p className="small">
          This records a request, puts it on your security activity and sends you a notice saying so.
          <strong> It does not produce a file.</strong> Nothing in this build writes an archive and nothing
          emails a link, so what you get today is a durable record that you asked — which is what the
          endpoint returns, and what it is honest to say.
        </p>
        <div className="row-wrap">
          <Button onClick={() => void requestExport()} disabled={exportState.kind === 'busy'}>
            {exportState.kind === 'busy' ? 'Recording…' : 'Request a copy'}
          </Button>
          <span className="tiny muted">Your password is asked for again — an export is the whole account.</span>
        </div>
        {exportState.kind === 'done' ? <Notice tone="ok">{exportState.message}</Notice> : null}
        {exportState.kind === 'error' ? (
          <Notice tone="bad">
            <span role="alert">{exportState.message}</span>
          </Notice>
        ) : null}
      </div>

      <hr className="divider" />

      <div className="stack stack-3">
        <h3 className="h3">Close your account</h3>
        <p className="small">
          Filing this suspends the account immediately — you are signed out on the next request — and starts
          a {graceDaysHint}-day window in which support can undo it. At the end of the window the account is{' '}
          <strong>anonymised rather than erased</strong>: transactions and audit records carry retention
          obligations of their own and outlive the name attached to them.
        </p>

        {closeState.kind === 'filed' ? (
          <Notice tone="warn">
            <div className="stack stack-2">
              <strong>Your account is scheduled for closure.</strong>
              <span>
                It stays reversible until {longDate(closeState.executeAfter)}. You have been signed out; contact
                support before that date if this was not what you meant.
              </span>
              <span>
                <ButtonLink href="/sign-in" size="sm">
                  Sign in again
                </ButtonLink>
              </span>
            </div>
          </Notice>
        ) : (
          <div className="row-wrap">
            <Button
              variant="danger"
              onClick={() => dialog.current?.showModal()}
              disabled={closeState.kind === 'busy'}
            >
              {closeState.kind === 'busy' ? 'Filing…' : 'Close my account'}
            </Button>
            <span className="tiny muted">You are asked to confirm, and then for your password.</span>
          </div>
        )}

        {closeState.kind === 'error' ? (
          <Notice tone="bad">
            <span role="alert">{closeState.message}</span>
          </Notice>
        ) : null}
      </div>

      <dialog className="dialog-native" ref={dialog} aria-labelledby="close-account-heading">
        <form className="stack stack-4" onSubmit={closeAccount}>
          <div className="stack stack-2">
            <h2 id="close-account-heading" className="h3">
              Close this account?
            </h2>
            <p className="small">
              Your pass stops working, every device is signed out, and businesses you are connected to can no
              longer recognise you. Tickets you hold are not honoured after that. It stays reversible for{' '}
              {graceDaysHint} days.
            </p>
          </div>

          <div className="field">
            <label className="label" htmlFor="close-reason">
              Why, if you want to say (optional)
            </label>
            <input className="input" id="close-reason" name="reason" type="text" maxLength={240} />
            <p className="hint">Stored on the request so support can see it. Leave it blank if you would rather not.</p>
          </div>

          <div className="row-wrap">
            <Button type="submit" variant="danger">
              Yes, close it
            </Button>
            <Button type="button" variant="ghost" onClick={() => dialog.current?.close()}>
              Keep my account
            </Button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
