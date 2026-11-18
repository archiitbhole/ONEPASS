'use client';

/**
 * What you want to be told about.
 *
 * One switch, one request: `PATCH /api/me/notifications/preferences` takes a
 * single category and channel, because that is what a person just changed.
 * The switch moves optimistically and moves back if the server refuses — the
 * alternative, a switch that waits half a second before agreeing with the
 * finger that flipped it, reads as broken.
 *
 * Security is drawn as fixed rather than as a switch that springs back. The
 * endpoint refuses to switch it off, and a control that always refuses is worse
 * than a sentence saying why.
 */
import { useState } from 'react';
import { Notice } from '@/components/ui';

interface Envelope {
  error?: { code?: string; message?: string };
}

export interface PreferenceRow {
  category: string;
  channel: string;
  enabled: boolean;
  label: string;
  description: string;
  /** True for SECURITY: shown as on, with no control. */
  locked: boolean;
}

export function SettingsNotifications({ initial }: { initial: PreferenceRow[] }) {
  const [rows, setRows] = useState(initial);
  const [pending, setPending] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const keyOf = (row: PreferenceRow) => `${row.category}:${row.channel}`;

  async function toggle(row: PreferenceRow, next: boolean) {
    const key = keyOf(row);
    setPending(key);
    setFailure(null);
    setSaved(null);
    setRows((current) => current.map((r) => (keyOf(r) === key ? { ...r, enabled: next } : r)));

    try {
      const res = await fetch('/api/me/notifications/preferences', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ category: row.category, channel: row.channel, enabled: next }),
        credentials: 'same-origin',
      });

      if (!res.ok) {
        const parsed = (await res.json().catch(() => ({}))) as Envelope;
        // Back to what the server still believes, which is what it was.
        setRows((current) => current.map((r) => (keyOf(r) === key ? { ...r, enabled: !next } : r)));
        setFailure(parsed.error?.message ?? `The server refused that with HTTP ${res.status}.`);
        return;
      }

      setSaved(`${row.label} is now ${next ? 'on' : 'off'}.`);
    } catch (err) {
      setRows((current) => current.map((r) => (keyOf(r) === key ? { ...r, enabled: !next } : r)));
      setFailure(`That did not reach the server — ${err instanceof Error ? err.message : 'the network failed'}.`);
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="stack stack-4">
      <ul className="prefs">
        {rows.map((row) => {
          const key = keyOf(row);
          const id = `pref-${key.replace(/[^a-z0-9]/gi, '-').toLowerCase()}`;
          return (
            <li key={key} className="prefs-row">
              <div className="prefs-text">
                <label className="prefs-label" htmlFor={row.locked ? undefined : id}>
                  {row.label}
                </label>
                <p className="tiny muted">{row.description}</p>
              </div>
              {row.locked ? (
                <span className="badge badge-ok">Always on</span>
              ) : (
                <span className="switch">
                  <input
                    id={id}
                    type="checkbox"
                    checked={row.enabled}
                    disabled={pending === key}
                    onChange={(event) => void toggle(row, event.target.checked)}
                  />
                  <span className="switch-track" aria-hidden="true" />
                </span>
              )}
            </li>
          );
        })}
      </ul>

      <p className="tiny muted" aria-live="polite">
        {saved ?? ' '}
      </p>

      {failure ? (
        <Notice tone="bad">
          <span role="alert">{failure}</span>
        </Notice>
      ) : null}
    </div>
  );
}
