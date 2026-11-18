'use client';

/**
 * The support form.
 *
 * Client-side because it holds a pending state and shows the server's own
 * refusal next to the field — including the "you already have an open request
 * about this" case, which is a legitimate answer rather than an error.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export function SupportForm({
  categories,
  help,
}: {
  categories: string[];
  help: Record<string, string>;
}) {
  const router = useRouter();
  const [category, setCategory] = useState(categories[0] ?? 'other');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const el = e.currentTarget;

    start(async () => {
      const res = await fetch('/api/support', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          category,
          subject: String(form.get('subject') ?? '').trim(),
          body: String(form.get('body') ?? '').trim(),
          reference: String(form.get('reference') ?? '').trim() || undefined,
        }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        setError(data?.error?.message ?? 'Could not file that just now. Try again shortly.');
        return;
      }

      el.reset();
      setDone(true);
      router.refresh();
    });
  }

  if (done) {
    return (
      <div className="stack stack-3">
        <div className="notice notice-ok">
          <span>
            <strong>We have it.</strong> Support will reply, and you will see the status change
            above. Nothing else is needed from you.
          </span>
        </div>
        <button type="button" className="btn" onClick={() => setDone(false)}>
          File another request
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="stack stack-4">
      {error ? (
        <div className="notice notice-bad" role="alert">
          {error}
        </div>
      ) : null}

      <div className="field">
        <label className="label" htmlFor="category">
          What is it about?
        </label>
        <select
          id="category"
          name="category"
          className="select input"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          {categories.map((c) => (
            <option key={c} value={c}>
              {c.charAt(0).toUpperCase() + c.slice(1)}
            </option>
          ))}
        </select>
        <p className="hint">{help[category] ?? ''}</p>
      </div>

      <div className="field">
        <label className="label" htmlFor="subject">
          Subject
        </label>
        <input id="subject" name="subject" className="input" required minLength={4} maxLength={180} />
      </div>

      <div className="field">
        <label className="label" htmlFor="reference">
          Reference <span className="muted" style={{ fontWeight: 400 }}>(optional)</span>
        </label>
        <input
          id="reference"
          name="reference"
          className="input input-mono"
          placeholder="bkg_… · tkt_… · rcp_…"
          maxLength={40}
        />
        <p className="hint">The booking, ticket or receipt this is about, if there is one.</p>
      </div>

      <div className="field">
        <label className="label" htmlFor="body">
          What happened?
        </label>
        <textarea id="body" name="body" className="textarea input" required minLength={10} maxLength={5000} />
        <p className="hint">
          What you expected, what happened instead, and when. Never include a password or a
          one-time code.
        </p>
      </div>

      <button type="submit" className="btn btn-primary btn-lg" disabled={pending}>
        {pending ? <span className="spinner" aria-hidden="true" /> : null}
        Send to support
      </button>
    </form>
  );
}
