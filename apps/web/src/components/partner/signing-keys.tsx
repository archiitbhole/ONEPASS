'use client';

/**
 * The organization's signing keys: history, rotation, revocation.
 *
 * Client because rotation and revocation are POSTs that may need a password
 * re-entry (`useStepUp`), and the page should refresh in place afterwards.
 *
 * The two actions are presented very differently on purpose. Rotation is
 * routine and harmless to anything already issued — a retired key still
 * verifies what it signed — so it is one button. Revocation invalidates every
 * credential a key signed, so it asks for a reason, says in plain words what
 * will stop working, and needs a second press.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, TableScroll, type Tone } from '@/components/ui';
import { postJson, useStepUp } from '@/components/auth/step-up';

export interface KeyRow {
  keyId: string;
  status: 'ACTIVE' | 'RETIRED' | 'REVOKED';
  activatedAt: string;
  retiredAt: string | null;
  revokedAt: string | null;
}

const TONE: Record<KeyRow['status'], Tone> = { ACTIVE: 'ok', RETIRED: 'neutral', REVOKED: 'bad' };
const WORD: Record<KeyRow['status'], string> = {
  ACTIVE: 'Signing',
  RETIRED: 'Retired — still verifies',
  REVOKED: 'Revoked — verifies nothing',
};

const DAY = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
const day = (iso: string | null) => (iso ? DAY.format(new Date(iso)) : '—');

export function SigningKeys({ orgId, keys, canManage }: { orgId: string; keys: KeyRow[]; canManage: boolean }) {
  const router = useRouter();
  const { run, prompt } = useStepUp();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  async function act(label: string, action: () => Promise<Record<string, unknown>>) {
    setBusy(true);
    setMessage(null);
    try {
      const result = await run(action);
      setMessage({ tone: 'ok', text: label.replace('{active}', String(result.active ?? '')) });
      setRevoking(null);
      router.refresh();
    } catch (err) {
      const text = err instanceof Error ? err.message : 'That did not work.';
      if (text !== 'Cancelled.') setMessage({ tone: 'bad', text });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack stack-4">
      <TableScroll>
          <table className="table">
          <caption className="sr-only">Signing key versions</caption>
          <thead>
            <tr>
              <th scope="col">Key</th>
              <th scope="col">State</th>
              <th scope="col">Since</th>
              <th scope="col">Ended</th>
              {canManage ? <th scope="col"><span className="sr-only">Actions</span></th> : null}
            </tr>
          </thead>
          <tbody>
            {keys.map((key) => (
              <tr key={key.keyId}>
                <th scope="row" className="mono">
                  {key.keyId}
                </th>
                <td>
                  <Badge tone={TONE[key.status]}>{WORD[key.status]}</Badge>
                </td>
                <td>{day(key.activatedAt)}</td>
                <td>{day(key.revokedAt ?? key.retiredAt)}</td>
                {canManage ? (
                  <td>
                    {key.status !== 'REVOKED' ? (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setRevoking(revoking === key.keyId ? null : key.keyId)}
                        aria-expanded={revoking === key.keyId}
                        disabled={busy}
                      >
                        Revoke {key.keyId}
                      </button>
                    ) : null}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>

      {canManage && revoking ? (
        <form
          className="card-flat stack stack-3"
          onSubmit={(event) => {
            event.preventDefault();
            const reason = String(new FormData(event.currentTarget).get('reason') ?? '');
            void act(`Key ${revoking} revoked. New credentials are signed with {active}.`, () =>
              postJson(`/api/partner/${orgId}/signing-keys/${revoking}/revoke`, { reason }),
            );
          }}
        >
          <div className="notice notice-bad">
            Every credential signed with <strong>{revoking}</strong> will stop verifying, immediately and
            permanently. Do this if the key may have been exposed; to replace a key routinely, rotate
            it instead.
          </div>
          <div className="field">
            <label className="label" htmlFor="revoke-reason">
              Why is {revoking} being revoked?
            </label>
            <input id="revoke-reason" name="reason" className="input" required minLength={3} maxLength={240} />
          </div>
          <div className="row-wrap" style={{ gap: 8 }}>
            <button type="submit" className="btn btn-danger btn-sm" disabled={busy}>
              Revoke {revoking} permanently
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRevoking(null)} disabled={busy}>
              Keep it
            </button>
          </div>
        </form>
      ) : null}

      {canManage ? (
        <div className="row-wrap" style={{ gap: 12, alignItems: 'center' }}>
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy}
            onClick={() =>
              void act('Rotated. New credentials are signed with {active}; everything issued before still verifies.', () =>
                postJson(`/api/partner/${orgId}/signing-keys`, {}),
              )
            }
          >
            Rotate signing key
          </button>
          <span className="small muted">
            Credentials already issued keep verifying against the key that signed them.
          </span>
        </div>
      ) : null}

      {prompt}

      {message ? (
        <div className={`notice notice-${message.tone}`} role={message.tone === 'bad' ? 'alert' : 'status'}>
          {message.text}
        </div>
      ) : null}
    </div>
  );
}
