'use client';

/**
 * One button that posts a JSON body and tells the truth about what came back.
 *
 * The rule this component exists to enforce: a screen never claims something
 * happened. If the endpoint answers 404 because it has not been built, or 409
 * because the seat went while the page was open, the person reads that sentence —
 * not a spinner that resolves into a lie.
 *
 * The API's error envelope is `{ error: { code, message, requestId } }`, so the
 * message shown is the server's own words, with the request id kept alongside it for
 * anyone who has to go and look the failure up.
 */
import { useState, useTransition } from 'react';
import { forgetThisDevice } from '@/lib/offline/tickets';
import { useRouter } from 'next/navigation';
import { Button, Notice } from '@/components/ui';

type Outcome =
  | { kind: 'idle' }
  | { kind: 'ok'; message: string }
  | { kind: 'error'; message: string; code?: string; requestId?: string };

export function PostAction({
  path,
  body,
  label,
  pendingLabel = 'Working…',
  successMessage,
  method = 'POST',
  variant = 'primary',
  size,
  block,
  confirm,
  disabled,
  disabledReason,
  clearsDevice,
}: {
  path: string;
  body?: Record<string, unknown>;
  label: string;
  pendingLabel?: string;
  successMessage: string;
  method?: 'POST' | 'DELETE';
  variant?: 'default' | 'primary' | 'danger' | 'ghost';
  size?: 'sm' | 'lg';
  block?: boolean;
  /** Shown in a confirm() before anything is sent. Used for destructive actions. */
  confirm?: string;
  disabled?: boolean;
  disabledReason?: string;
  /**
   * Set on an action that ends this device's session. Clears the offline
   * tickets and the service worker's caches on success, so a shared phone does
   * not carry one person's copies into the next person's session.
   */
  clearsDevice?: boolean;
}) {
  const router = useRouter();
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' });
  const [pending, startTransition] = useTransition();
  const [sending, setSending] = useState(false);

  async function send() {
    if (confirm && !window.confirm(confirm)) return;
    setSending(true);
    setOutcome({ kind: 'idle' });

    try {
      const res = await fetch(path, {
        method,
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        // The session cookie is same-origin and httpOnly; nothing else authenticates.
        credentials: 'same-origin',
      });

      const text = await res.text();
      let parsed: unknown = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = null;
      }

      if (res.ok) {
        // Before the refresh, and awaited: a navigation that starts first can
        // tear down the page mid-sweep and leave half of it behind.
        if (clearsDevice) await forgetThisDevice();
        setOutcome({ kind: 'ok', message: successMessage });
        startTransition(() => router.refresh());
        return;
      }

      const envelope =
        parsed && typeof parsed === 'object' && 'error' in parsed
          ? (parsed as { error: { code?: string; message?: string; requestId?: string } }).error
          : null;

      setOutcome({
        kind: 'error',
        // A 404 with no body is the shape of a route that does not exist yet, and
        // saying so is more useful than "something went wrong".
        message:
          envelope?.message ??
          (res.status === 404
            ? `This action is not available: the server has no ${method} ${path} endpoint (404).`
            : `The server refused this with HTTP ${res.status}.`),
        ...(envelope?.code ? { code: envelope.code } : {}),
        ...(envelope?.requestId ? { requestId: envelope.requestId } : {}),
      });
    } catch (err) {
      setOutcome({
        kind: 'error',
        message: `The request could not be sent — ${err instanceof Error ? err.message : 'the network failed'}.`,
      });
    } finally {
      setSending(false);
    }
  }

  const busy = sending || pending;

  return (
    <div className="stack stack-3">
      {/* The button sits in a row rather than directly in the stack: a stack is
          a flex column and stretches its children, which turned every action
          here — including the destructive ones — into a full-width bar. */}
      <div className="row-wrap">
        <Button
          variant={variant}
          {...(size ? { size } : {})}
          {...(block ? { block } : {})}
          onClick={() => void send()}
          disabled={busy || disabled}
        >
          {busy ? pendingLabel : label}
        </Button>
      </div>

      {disabled && disabledReason ? <p className="tiny muted">{disabledReason}</p> : null}

      {outcome.kind === 'ok' ? <Notice tone="ok">{outcome.message}</Notice> : null}

      {outcome.kind === 'error' ? (
        <Notice tone="bad">
          <span>
            {outcome.message}
            {outcome.requestId ? (
              <>
                {' '}
                <span className="mono tiny">Request {outcome.requestId}</span>
              </>
            ) : null}
          </span>
        </Notice>
      ) : null}
    </div>
  );
}
