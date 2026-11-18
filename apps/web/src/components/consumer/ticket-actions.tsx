'use client';

/**
 * Passing a ticket on, and claiming one.
 *
 * The same shape as the product transfer next door, because it is the same
 * problem — a one-time code, shown once, never stored in the browser — with one
 * difference this component has to say out loud rather than imply: **the sender
 * loses the ticket, not the booking.** The seat stops working in their hand the
 * moment it is claimed; the money and the receipt stay where they are. Somebody
 * who thinks they just transferred a refund has been misled by a screen, and
 * the screen is this one.
 *
 * Client because both actions are POSTs whose answers change the page, and
 * because giving a seat away needs a recent password (`useStepUp`).
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { postJson, useStepUp } from '@/components/auth/step-up';

export function TransferTicket({
  ticketRef,
  title,
  seatLabel,
  pendingRef,
}: {
  ticketRef: string;
  title: string;
  seatLabel: string | null;
  pendingRef: string | null;
}) {
  const router = useRouter();
  const { run, prompt } = useStepUp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<{ value: string; expiresAt: string } | null>(null);

  async function offer() {
    setBusy(true);
    setError(null);
    try {
      const result = await run(() =>
        postJson<{ code: string; expiresAt: string }>(`/api/me/tickets/${ticketRef}/transfer`, {}),
      );
      setCode({ value: result.code, expiresAt: result.expiresAt });
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'That did not work.';
      // `useStepUp` reports a dismissed password prompt this way. Nothing went
      // wrong, so nothing is shown.
      if (message !== 'Cancelled.') setError(message);
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!pendingRef) return;
    setBusy(true);
    setError(null);
    try {
      await postJson(`/api/me/ticket-transfers/${pendingRef}/cancel`, {});
      setCode(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack stack-2">
      {code ? (
        <div className="notice notice-warn" role="status">
          <div className="stack stack-2" style={{ width: '100%' }}>
            <strong>
              Give this code to whoever is taking {seatLabel ? `seat ${seatLabel}` : title}
            </strong>
            <code className="code-block mono" style={{ fontSize: 18, letterSpacing: '0.08em' }}>
              {code.value}
            </code>
            <span className="small">
              They enter it on their own Tickets screen. It works once, and it lapses at the later of{' '}
              {new Date(code.expiresAt).toLocaleString('en-IN', {
                day: 'numeric',
                month: 'short',
                hour: 'numeric',
                minute: '2-digit',
              })}{' '}
              or when the ticket stops being valid. It will not be shown again.
            </span>
            <span className="small">
              The moment they claim it, your copy stops working at the door. Your booking and your
              payment stay with you — only the admission moves.
            </span>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="notice notice-bad" role="alert">
          {error}
        </div>
      ) : null}

      <div className="row-wrap" style={{ gap: 8 }}>
        {pendingRef ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={cancel} disabled={busy}>
            Cancel the transfer
          </button>
        ) : (
          <button type="button" className="btn btn-sm" onClick={offer} disabled={busy}>
            Pass this on
          </button>
        )}
      </div>
      {prompt}
    </div>
  );
}

export function ClaimTicket() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  async function claim(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const code = String(new FormData(form).get('code') ?? '').trim();
    setBusy(true);
    setMessage(null);
    try {
      const result = await postJson<{ title: string; seatLabel: string | null }>(
        '/api/me/ticket-transfers/claim',
        { code },
      );
      setMessage({
        tone: 'ok',
        text: result.seatLabel
          ? `${result.title} — seat ${result.seatLabel} is yours. It is in your tickets now.`
          : `${result.title} is yours. It is in your tickets now.`,
      });
      form.reset();
      router.refresh();
    } catch (err) {
      setMessage({ tone: 'bad', text: err instanceof Error ? err.message : 'That did not work.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack stack-3" onSubmit={claim}>
      <div className="field">
        <label className="label" htmlFor="ticket-transfer-code">
          Ticket transfer code
        </label>
        <input
          id="ticket-transfer-code"
          name="code"
          className="input input-mono"
          placeholder="XXXX-XXXX-XXXX-XXXX"
          autoComplete="off"
          spellCheck={false}
          required
          minLength={16}
          maxLength={40}
        />
        <p className="hint">
          From whoever is passing you the seat. Case and dashes do not matter. You get your own
          reference — theirs stops working.
        </p>
      </div>
      {message ? (
        <div className={`notice notice-${message.tone}`} role={message.tone === 'bad' ? 'alert' : 'status'}>
          {message.text}
        </div>
      ) : null}
      <div>
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
          {busy ? 'Claiming…' : 'Claim the ticket'}
        </button>
      </div>
    </form>
  );
}
