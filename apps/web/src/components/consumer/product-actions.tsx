'use client';

/**
 * Giving a product away, and claiming one.
 *
 * Client because both are POSTs whose answers change the page, and giving an
 * item away needs a recent password (`useStepUp`). The transfer code is shown
 * exactly once, in this component's state, and is never written anywhere the
 * browser keeps — the server stored only its hash, so a code nobody copied is
 * cancelled and replaced, not recovered.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { postJson, useStepUp } from '@/components/auth/step-up';

export function TransferProduct({
  productRef,
  name,
  pendingRef,
  warrantyNote,
}: {
  productRef: string;
  name: string;
  pendingRef: string | null;
  warrantyNote: string | null;
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
        postJson<{ code: string; expiresAt: string }>(`/api/me/products/${productRef}/transfer`, {}),
      );
      setCode({ value: result.code, expiresAt: result.expiresAt });
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'That did not work.';
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
      await postJson(`/api/me/product-transfers/${pendingRef}/cancel`, {});
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
            <strong>Give this code to the new owner of {name}</strong>
            <code className="code-block mono" style={{ fontSize: 18, letterSpacing: '0.08em' }}>
              {code.value}
            </code>
            <span className="small">
              They enter it on their own Products screen. It works once and lapses on{' '}
              {new Date(code.expiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}. It will
              not be shown again.
            </span>
            {warrantyNote ? <span className="small">{warrantyNote}</span> : null}
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
            Give or sell this
          </button>
        )}
      </div>
      {prompt}
    </div>
  );
}

export function ClaimProduct() {
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
      const result = await postJson<{ name: string; warrantyMoved: boolean; warrantyStayed: boolean }>(
        '/api/me/product-transfers/claim',
        { code },
      );
      setMessage({
        tone: 'ok',
        text: `${result.name} is yours now.${
          result.warrantyMoved
            ? ' Its warranty came with it.'
            : result.warrantyStayed
              ? ' Its warranty did not transfer — the seller’s terms tie cover to the original buyer.'
              : ''
        }`,
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
        <label className="label" htmlFor="transfer-code">
          Transfer code
        </label>
        <input
          id="transfer-code"
          name="code"
          className="input input-mono"
          placeholder="XXXX-XXXX-XXXX-XXXX"
          autoComplete="off"
          spellCheck={false}
          required
          minLength={16}
          maxLength={40}
        />
        <p className="hint">From the person giving you the item. Case and dashes do not matter.</p>
      </div>
      {message ? (
        <div className={`notice notice-${message.tone}`} role={message.tone === 'bad' ? 'alert' : 'status'}>
          {message.text}
        </div>
      ) : null}
      <div>
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
          {busy ? 'Claiming…' : 'Claim the item'}
        </button>
      </div>
    </form>
  );
}
