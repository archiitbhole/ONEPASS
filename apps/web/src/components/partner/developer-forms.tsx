'use client';

/**
 * Creating an API key and registering a webhook endpoint.
 *
 * The one behaviour worth reading the code for: both of these are given a secret
 * exactly once, in the response that created them, and this component is the only
 * place it is ever displayed. It is held in React state and never written to
 * `localStorage`, never put in the URL, and never sent anywhere — a refresh loses
 * it, which is correct, because the alternative is a credential sitting in a
 * browser profile until the laptop is sold.
 *
 * The server stores a SHA-256 of an API key and an AES-256-GCM sealed copy of a
 * webhook secret, so neither this page nor a database dump can produce a working
 * one after the fact. The warning shown next to the value is therefore literally
 * true rather than a formality.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Button, Field, Notice } from '@/components/ui';
// Shared so REAUTH_REQUIRED is recognised: creating a key needs a recent password.
import { postJson, useStepUp } from '@/components/auth/step-up';

/** A secret, shown once, with the reason it will not be shown again. */
function RevealedSecret({ label, value, note }: { label: string; value: string; note: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <Notice tone="warn">
      <div className="stack stack-2" style={{ width: '100%' }}>
        <strong>{label}</strong>
        <code className="code-block" style={{ wordBreak: 'break-all' }}>
          {value}
        </code>
        <div className="row-wrap" style={{ gap: 8, alignItems: 'center' }}>
          <Button
            size="sm"
            onClick={() => {
              navigator.clipboard
                ?.writeText(value)
                .then(() => setCopied(true))
                // Clipboard access can be refused; the value is on screen either way.
                .catch(() => setCopied(false));
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <span className="small muted">{note}</span>
        </div>
      </div>
    </Notice>
  );
}

export function CreateApiKey({ orgId, scopes }: { orgId: string; scopes: readonly string[] }) {
  const router = useRouter();
  const [label, setLabel] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ key: string; prefix: string } | null>(null);
  const { run, prompt } = useStepUp();

  const toggle = (scope: string) =>
    setChosen((current) =>
      current.includes(scope) ? current.filter((s) => s !== scope) : [...current, scope],
    );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      // `partner.apikey:write` needs a recent password. Outside the window the
      // server asks for it, the prompt below takes it, and this same request is
      // sent again — rather than the dead end it used to be.
      const result = await run(() =>
        postJson(`/api/partner/${orgId}/api-keys`, {
          label: label.trim(),
          scopes: chosen,
        }),
      );
      setCreated({ key: String(result.key), prefix: String(result.prefix) });
      setLabel('');
      setChosen([]);
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'That request failed.';
      if (message !== 'Cancelled.') setError(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack stack-3">
      <form className="stack stack-3" onSubmit={submit}>
      {created ? (
        <RevealedSecret
          label={`Key ${created.prefix}… created`}
          value={created.key}
          note="Only a hash is stored. This cannot be shown or recovered again."
        />
      ) : null}

      {error ? <Notice tone="bad">{error}</Notice> : null}

      <Field label="Label" htmlFor="key-label" hint="What this key is for — a system, not a person.">
        <input
          id="key-label"
          className="input"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={80}
          required
          placeholder="Front-desk POS"
        />
      </Field>

      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="label">Scopes</legend>
        <div className="row-wrap" style={{ gap: 8 }}>
          {scopes.map((scope) => (
            <label key={scope} className="row" style={{ gap: 6, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={chosen.includes(scope)}
                onChange={() => toggle(scope)}
              />
              <Badge tone={chosen.includes(scope) ? 'ok' : 'neutral'}>{scope}</Badge>
            </label>
          ))}
        </div>
        <p className="hint">
          A key can never be granted more than you hold yourself, and these are read and issue
          scopes only — managing the team or refunding a payment stays with a signed-in person.
        </p>
      </fieldset>

      <div>
        <Button type="submit" variant="primary" disabled={busy || chosen.length === 0 || !label.trim()}>
          {busy ? 'Creating…' : 'Create key'}
        </Button>
      </div>
      </form>
      {/* Outside the form: a form inside a form is not valid HTML. */}
      {prompt}
    </div>
  );
}

export function CreateWebhook({ orgId, eventTypes }: { orgId: string; eventTypes: readonly string[] }) {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ secret: string; url: string } | null>(null);

  const toggle = (type: string) =>
    setChosen((current) =>
      current.includes(type) ? current.filter((s) => s !== type) : [...current, type],
    );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await postJson(`/api/partner/${orgId}/webhooks`, {
        url: url.trim(),
        events: chosen,
      });
      setCreated({ secret: String(result.secret), url: String(result.url) });
      setUrl('');
      setChosen([]);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That request failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack stack-3" onSubmit={submit}>
      {created ? (
        <RevealedSecret
          label={`Signing secret for ${created.url}`}
          value={created.secret}
          note="Verify with HMAC-SHA256 over `${x-onepass-timestamp}.${rawBody}`, compared in constant time."
        />
      ) : null}

      {error ? <Notice tone="bad">{error}</Notice> : null}

      <Field
        label="Endpoint URL"
        htmlFor="hook-url"
        hint="Public HTTPS only. Private and loopback addresses are refused — this server would be the one calling them."
      >
        <input
          id="hook-url"
          className="input input-mono"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          maxLength={2000}
          required
          placeholder="https://your-system.example.com/hooks/onepass"
        />
      </Field>

      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="label">Events</legend>
        <div className="row-wrap" style={{ gap: 8 }}>
          {eventTypes.map((type) => (
            <label key={type} className="row" style={{ gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={chosen.includes(type)} onChange={() => toggle(type)} />
              <Badge tone={chosen.includes(type) ? 'ok' : 'neutral'}>{type}</Badge>
            </label>
          ))}
        </div>
        <p className="hint">
          These are your organization&rsquo;s own events. A customer&rsquo;s activity elsewhere is on
          their personal channel and is never delivered here.
        </p>
      </fieldset>

      <div>
        <Button type="submit" variant="primary" disabled={busy || chosen.length === 0 || !url.trim()}>
          {busy ? 'Registering…' : 'Register endpoint'}
        </Button>
      </div>
    </form>
  );
}

/**
 * Asking for a delivery the platform gave up on to be sent again.
 *
 * Client for one capability: posting, and showing the server's own refusal
 * beside the row it belongs to. The refusals are worth reading rather than
 * hiding — "this already reached your endpoint" and "this is still scheduled"
 * are different facts, and a button that silently did nothing in either case
 * would teach an operator to press it twice.
 *
 * It queues; it does not send. The drain picks the row up with everything else,
 * so there is exactly one code path that signs, times out and backs off.
 */
export function RedeliverButton({
  orgId,
  webhookId,
  deliveryId,
}: {
  orgId: string;
  webhookId: string;
  deliveryId: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<{ kind: 'idle' | 'busy' } | { kind: 'done' | 'error'; message: string }>({
    kind: 'idle',
  });

  async function send() {
    setState({ kind: 'busy' });
    try {
      const res = await fetch(
        `/api/partner/${orgId}/webhooks/${webhookId}/deliveries/${deliveryId}/redeliver`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
          credentials: 'same-origin',
        },
      );
      const parsed = (await res.json().catch(() => ({}))) as {
        error?: { message?: string };
        previousAttempts?: number;
      };
      if (!res.ok) {
        setState({ kind: 'error', message: parsed.error?.message ?? `The server refused that with HTTP ${res.status}.` });
        return;
      }
      setState({
        kind: 'done',
        message: 'Queued. The next drain will send it; this row moves when it does.',
      });
      router.refresh();
    } catch (err) {
      setState({
        kind: 'error',
        message: `That did not reach the server — ${err instanceof Error ? err.message : 'the network failed'}.`,
      });
    }
  }

  if (state.kind === 'done') {
    return <span className="tiny">{state.message}</span>;
  }

  return (
    <span className="stack stack-2">
      <Button size="sm" onClick={() => void send()} disabled={state.kind === 'busy'}>
        {state.kind === 'busy' ? 'Queueing…' : 'Send again'}
      </Button>
      {state.kind === 'error' ? (
        <span className="tiny" role="alert" style={{ color: 'var(--bad)' }}>
          {state.message}
        </span>
      ) : null}
    </span>
  );
}
