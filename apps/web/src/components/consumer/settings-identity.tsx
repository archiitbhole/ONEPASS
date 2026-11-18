'use client';

/**
 * Editing the details ONEPASS holds about you.
 *
 * Client because the form posts JSON and has to show the server's own refusal
 * beside the field that caused it — a server action would redirect, and a
 * redirect loses which of two fields was wrong.
 *
 * The form sends exactly the fields that changed. `PATCH /api/me/profile` is
 * `.strict()` and rejects an unknown key, which is the property worth keeping:
 * it means this component cannot grow a field the endpoint has not agreed to,
 * and a typo here is a 422 in development rather than a silently ignored edit.
 *
 * What is deliberately not here: the email address and the mobile number. Both
 * carry a verification state, changing either is an identity change rather than
 * a preference, and there is no endpoint for it — so this screen says so instead
 * of drawing a field that would throw away what you typed.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Field, Notice } from '@/components/ui';

interface Envelope {
  error?: { code?: string; message?: string; requestId?: string; details?: unknown };
}

export interface IdentityValues {
  displayName: string;
  city: string;
}

export function SettingsIdentity({ initial }: { initial: IdentityValues }) {
  const router = useRouter();
  const [values, setValues] = useState<IdentityValues>(initial);
  const [saved, setSaved] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const displayName = values.displayName.trim();
  const city = values.city.trim();
  const dirty = displayName !== initial.displayName.trim() || city !== initial.city.trim();

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setSaved(null);
    setFailure(null);

    // Only what moved. An unchanged field is not sent at all, so a save can
    // never overwrite something with the value the page happened to load.
    const changes: Record<string, string | null> = {};
    if (displayName !== initial.displayName.trim()) changes.displayName = displayName;
    if (city !== initial.city.trim()) changes.city = city.length > 0 ? city : null;

    if (Object.keys(changes).length === 0) {
      setBusy(false);
      setSaved('Nothing had changed, so nothing was sent.');
      return;
    }

    try {
      const res = await fetch('/api/me/profile', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(changes),
        credentials: 'same-origin',
      });

      if (!res.ok) {
        const parsed = (await res.json().catch(() => ({}))) as Envelope;
        setFailure(
          parsed.error?.message ??
            (res.status === 404
              ? 'This deployment has no PATCH /api/me/profile endpoint (404).'
              : `The server refused that with HTTP ${res.status}.`),
        );
        return;
      }

      setSaved('Saved. Your name is what a counter sees when your pass is read.');
      // Your name is on the pass, in the app bar and on /profile — every one of
      // them is rendered on the server, so the whole route has to re-render.
      router.refresh();
    } catch (err) {
      setFailure(`That did not reach the server — ${err instanceof Error ? err.message : 'the network failed'}.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack stack-4" onSubmit={save} noValidate>
      <Field
        label="Display name"
        htmlFor="settings-display-name"
        hint="What a partner sees when you present your pass, and the name on the pass itself."
      >
        <input
          className="input"
          id="settings-display-name"
          name="displayName"
          type="text"
          value={values.displayName}
          maxLength={120}
          required
          autoComplete="name"
          onChange={(event) => setValues((v) => ({ ...v, displayName: event.target.value }))}
        />
      </Field>

      <Field
        label="City"
        htmlFor="settings-city"
        hint="Stored on your profile. It does not filter anything you see — Explore has its own city control."
      >
        <input
          className="input"
          id="settings-city"
          name="city"
          type="text"
          value={values.city}
          maxLength={80}
          autoComplete="address-level2"
          onChange={(event) => setValues((v) => ({ ...v, city: event.target.value }))}
        />
      </Field>

      <div className="row-wrap">
        <Button type="submit" variant="primary" disabled={busy || displayName.length === 0}>
          {busy ? 'Saving…' : 'Save changes'}
        </Button>
        {dirty && !busy ? <span className="tiny muted">Unsaved changes.</span> : null}
      </div>

      {saved ? <Notice tone="ok">{saved}</Notice> : null}
      {failure ? (
        <Notice tone="bad">
          <span role="alert">{failure}</span>
        </Notice>
      ) : null}
    </form>
  );
}
