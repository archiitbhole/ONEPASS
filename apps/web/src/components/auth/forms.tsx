'use client';

/**
 * The authentication forms.
 *
 * Client components because they need to hold a pending state and render a
 * server error next to the field that caused it. They are deliberately thin:
 * every decision — whether an account exists, whether a password is right,
 * whether an OTP is still valid — is the server's, and this file's job is to
 * show the answer without adding one of its own.
 *
 * Note what is NOT here: no client-side "email not found", no password strength
 * meter that leaks the server's rules, no optimistic redirect. The API is
 * deliberately anti-enumeration — it returns the same shape whether or not an
 * account exists — and a client that guessed differently would undo that.
 *
 * Every request body below is typed against `@/lib/auth/contracts`, which is the
 * same module the route handlers validate with. That is not ceremony. Three of
 * these four forms previously sent a body their endpoint could not parse — the
 * field was called `email` where the server reads `destination`, and the
 * recovery body omitted its discriminator — so registration could never be
 * completed and a forgotten password could never be reset. Both sides now fail
 * to compile rather than failing in front of a person.
 */
import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  PASSWORD_MIN_LENGTH,
  type OtpBody,
  type PasswordResetBody,
  type RegisterBody,
  type SignInBody,
  type SignInResponse,
  type VerifyBody,
} from '@/lib/auth/contracts';
import { BRAND } from '@/lib/brand';

interface ApiError {
  error?: {
    code?: string;
    message?: string;
    details?: { fields?: { path?: string; message?: string }[] };
  };
}

interface Result<T> {
  ok: boolean;
  data: T | null;
  message?: string;
  /** Field-level messages, keyed by field name, when the server returned them. */
  fields?: Record<string, string>;
}

/**
 * One typed POST.
 *
 * `Body` is supplied by the caller from the contract module, so a field this
 * endpoint does not read is a type error here rather than a 422 there.
 */
async function post<Body, Data = unknown>(path: string, body: Body): Promise<Result<Data>> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    // Offline, or the request never left. Worth saying plainly: "something went
    // wrong" sends people to check their password when the problem is the train
    // going into a tunnel.
    return { ok: false, data: null, message: `Could not reach ${BRAND.name}. Check your connection and try again.` };
  }

  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // A non-JSON body means something upstream failed; the status still tells us.
  }

  if (!res.ok) {
    const error = (data as ApiError | null)?.error;
    const fields: Record<string, string> = {};
    for (const entry of error?.details?.fields ?? []) {
      if (entry.path && entry.message && !fields[entry.path]) fields[entry.path] = entry.message;
    }
    return {
      ok: false,
      data: null,
      message: error?.message ?? 'Something went wrong. Try again.',
      fields: Object.keys(fields).length > 0 ? fields : undefined,
    };
  }
  return { ok: true, data: data as Data };
}

/**
 * The server's message for one field, if it sent one.
 *
 * The generic 422 message is "Some fields need attention", which tells a person
 * nothing. The per-field messages behind it are written to be read — "Use at
 * least 10 characters" — so they are shown where the eye already is.
 */
function FieldNote({ message }: { message: string | undefined }) {
  if (!message) return null;
  return (
    <p className="hint hint-bad">{message}</p>
  );
}

function Submit({ pending, children }: { pending: boolean; children: React.ReactNode }) {
  return (
    <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={pending}>
      {pending ? <span className="spinner" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="notice notice-bad" role="alert">
      {message}
    </div>
  );
}

/**
 * A password field that can be read back.
 *
 * Two things a plain `<input type="password">` gets wrong on a phone. People
 * mistype long passphrases and have no way to check, so they pick short ones;
 * and a caps-locked keyboard produces a wrong password with no visible cause.
 * The reveal button is a real button with a stable accessible name and
 * `aria-pressed`, not an icon that toggles silently.
 *
 * The typed value is never sent anywhere until the form is submitted, and the
 * field keeps its `autoComplete` hint so password managers still work.
 */
function PasswordField({
  id,
  name,
  label,
  autoComplete,
  hint,
  error,
  minLength,
  autoFocus,
  action,
}: {
  id: string;
  name: string;
  label: string;
  autoComplete: 'current-password' | 'new-password';
  hint?: string;
  error?: string;
  minLength?: number;
  autoFocus?: boolean;
  /** Rendered opposite the label — "Forgotten?" on the sign-in screen. */
  action?: React.ReactNode;
}) {
  const [visible, setVisible] = useState(false);
  const [capsLock, setCapsLock] = useState(false);

  return (
    <div className="field">
      <div className="row-between" style={{ marginBottom: -2 }}>
        <label className="label" htmlFor={id}>
          {label}
        </label>
        {action}
      </div>

      <div className="op-password">
        <input
          id={id}
          name={name}
          type={visible ? 'text' : 'password'}
          className="input"
          autoComplete={autoComplete}
          required
          minLength={minLength}
          autoFocus={autoFocus}
          onKeyUp={(e) => setCapsLock(e.getModifierState('CapsLock'))}
          onBlur={() => setCapsLock(false)}
        />
        <button
          type="button"
          className="op-password-toggle"
          onClick={() => setVisible((was) => !was)}
          aria-pressed={visible}
          aria-controls={id}
          // Deliberately not "Show password": the label is the control's name,
          // and `aria-pressed` carries the state. A name that changes with the
          // state is announced as a different control each time it is pressed.
          aria-label="Reveal what you typed"
        >
          {visible ? 'Hide' : 'Show'}
        </button>
      </div>

      {capsLock ? (
        <p className="hint" role="status">
          Caps lock is on.
        </p>
      ) : null}
      {hint ? <p className="hint">{hint}</p> : null}
      <FieldNote message={error} />
    </div>
  );
}

/** The six-digit code field, shared by verification and recovery. */
function CodeField({ error, autoFocus = true }: { error?: string; autoFocus?: boolean }) {
  return (
    <div className="field">
      <label className="label" htmlFor="code">
        Six-digit code
      </label>
      <input
        id="code"
        name="code"
        className="input input-mono"
        inputMode="numeric"
        pattern="[0-9]{6}"
        maxLength={6}
        autoComplete="one-time-code"
        required
        autoFocus={autoFocus}
        style={{ fontSize: 22, letterSpacing: '0.35em', textAlign: 'center' }}
      />
      <FieldNote message={error} />
    </div>
  );
}

/**
 * A resend button that will not let somebody walk into the rate limiter.
 *
 * Codes are limited per destination as well as per IP. Without a visible cooling
 * period people press the button three times in eight seconds, get told they
 * have requested too many codes, and conclude the product is broken.
 */
function ResendButton({
  onResend,
  pending,
  seconds = 30,
  children,
}: {
  onResend: () => void;
  pending: boolean;
  seconds?: number;
  children: React.ReactNode;
}) {
  const [left, setLeft] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
  }, []);

  function start() {
    onResend();
    setLeft(seconds);
    if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(() => {
      setLeft((n) => {
        if (n <= 1 && timer.current) clearInterval(timer.current);
        return n - 1 <= 0 ? 0 : n - 1;
      });
    }, 1000);
  }

  return (
    <button type="button" className="btn btn-ghost btn-block" onClick={start} disabled={pending || left > 0}>
      {left > 0 ? `${children} in ${left}s` : children}
    </button>
  );
}

// ── sign in ──────────────────────────────────────────────────

export function SignInForm({ next, notice }: { next: string; notice?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFields({});
    const form = new FormData(e.currentTarget);
    const email = String(form.get('email') ?? '').trim();

    const body: SignInBody = {
      email,
      password: String(form.get('password') ?? ''),
      devicePlatform: 'web',
      deviceLabel: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 100) : undefined,
    };

    start(async () => {
      const result = await post<SignInBody, SignInResponse>('/api/auth/sign-in', body);

      if (!result.ok) {
        setError(result.message ?? 'Sign in failed.');
        setFields(result.fields ?? {});
        return;
      }

      // An account that has never confirmed its address gets sent to do that
      // rather than dropped on a screen it cannot use. This branch used to test
      // for a second-factor challenge the server has never issued, so the field
      // the server does send went unread and registration dead-ended here.
      if (result.data?.mustVerifyEmail) {
        const query = new URLSearchParams({ email, purpose: 'EMAIL_VERIFY', next });
        router.push(`/verify-code?${query.toString()}`);
        return;
      }

      router.push(next);
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="stack stack-5">
      <div>
        <h1 className="h2">Sign in</h1>
        <p className="small muted" style={{ marginTop: 6 }}>
          One identity across every {BRAND.name} partner.
        </p>
      </div>

      {notice ? (
        <div className="notice notice-ok" role="status">
          {notice}
        </div>
      ) : null}

      <ErrorNote message={error} />

      <div className="field">
        <label className="label" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          className="input"
          autoComplete="email"
          required
          autoFocus
          placeholder="you@example.in"
        />
        <FieldNote message={fields.email} />
      </div>

      <PasswordField
        id="password"
        name="password"
        label="Password"
        autoComplete="current-password"
        error={fields.password}
        action={
          <Link href="/recover" className="tiny">
            Forgotten?
          </Link>
        }
      />

      <Submit pending={pending}>Sign in</Submit>

      <p className="small muted" style={{ textAlign: 'center' }}>
        New to {BRAND.name}? <Link href="/sign-up">Create an account</Link>
      </p>
    </form>
  );
}

// ── register ─────────────────────────────────────────────────

export function SignUpForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFields({});
    const form = new FormData(e.currentTarget);
    const email = String(form.get('email') ?? '').trim();

    const body: RegisterBody = {
      email,
      mobile: String(form.get('mobile') ?? '').trim() || undefined,
      password: String(form.get('password') ?? ''),
      displayName: String(form.get('displayName') ?? '').trim(),
    };

    start(async () => {
      const result = await post<RegisterBody>('/api/auth/register', body);

      if (!result.ok) {
        setError(result.message ?? 'Registration failed.');
        setFields(result.fields ?? {});
        return;
      }

      // The response is identical whether or not the address was already taken —
      // that is deliberate, and it is why the next screen asks for the code
      // rather than confirming anything.
      const query = new URLSearchParams({ email, purpose: 'EMAIL_VERIFY' });
      router.push(`/verify-code?${query.toString()}`);
    });
  }

  return (
    <form onSubmit={onSubmit} className="stack stack-5">
      <div>
        <h1 className="h2">Create your {BRAND.name}</h1>
        <p className="small muted" style={{ marginTop: 6 }}>
          One account for hotels, cinemas, restaurants and shops that accept {BRAND.name}.
        </p>
      </div>

      <ErrorNote message={error} />

      <div className="field">
        <label className="label" htmlFor="displayName">
          Your name
        </label>
        <input id="displayName" name="displayName" className="input" required autoFocus maxLength={80} />
        <FieldNote message={fields.displayName} />
      </div>

      <div className="field">
        <label className="label" htmlFor="email">
          Email
        </label>
        <input id="email" name="email" type="email" className="input" autoComplete="email" required />
        <FieldNote message={fields.email} />
      </div>

      <div className="field">
        <label className="label" htmlFor="mobile">
          Mobile <span className="muted" style={{ fontWeight: 400 }}>(optional)</span>
        </label>
        <input
          id="mobile"
          name="mobile"
          type="tel"
          className="input"
          autoComplete="tel"
          placeholder="+91 98000 00000"
        />
        <p className="hint">Used to send a one-time code when you sign in on a new device.</p>
        <FieldNote message={fields.mobile} />
      </div>

      <PasswordField
        id="password"
        name="password"
        label="Password"
        autoComplete="new-password"
        minLength={PASSWORD_MIN_LENGTH}
        // The number comes from the schema the server validates with, so the
        // form cannot advertise a floor the server does not hold.
        hint={`At least ${PASSWORD_MIN_LENGTH} characters. Longer beats complicated.`}
        error={fields.password}
      />

      <Submit pending={pending}>Create account</Submit>

      <p className="small muted" style={{ textAlign: 'center' }}>
        Already have one? <Link href="/sign-in">Sign in</Link>
      </p>
    </form>
  );
}

// ── one-time code ────────────────────────────────────────────

export function VerifyCodeForm({
  destination,
  purpose,
  next,
}: {
  destination: string;
  purpose: VerifyBody['purpose'];
  next: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [sent, setSent] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFields({});
    const form = new FormData(e.currentTarget);

    const body: VerifyBody = {
      purpose,
      destination,
      code: String(form.get('code') ?? '').trim(),
    };

    start(async () => {
      const result = await post<VerifyBody>('/api/auth/verify', body);

      if (!result.ok) {
        setError(result.message ?? 'That code was not accepted.');
        setFields(result.fields ?? {});
        return;
      }

      // Confirming an address does not sign anybody in — this endpoint issues no
      // session, deliberately, because the code proves control of the mailbox
      // and not of the account. So: back to sign in, with the good news, and
      // with wherever they were heading still attached.
      const query = new URLSearchParams({ verified: '1' });
      if (next && next !== '/') query.set('next', next);
      router.push(`/sign-in?${query.toString()}`);
    });
  }

  function resend() {
    setError(null);
    setSent(null);
    const body: OtpBody = { purpose, destination };
    start(async () => {
      const result = await post<OtpBody>('/api/auth/otp', body);
      setSent(
        result.ok
          ? 'If that address needs a code, one is on its way.'
          : (result.message ?? 'Could not send a code just now.'),
      );
    });
  }

  return (
    <form onSubmit={onSubmit} className="stack stack-5">
      <div>
        <h1 className="h2">Enter your code</h1>
        <p className="small muted" style={{ marginTop: 6 }}>
          We sent a six-digit code to <strong>{destination}</strong>. It is valid for ten minutes.
        </p>
      </div>

      <ErrorNote message={error} />
      {sent ? (
        <div className="notice notice-info" role="status">
          {sent}
        </div>
      ) : null}

      <CodeField error={fields.code} />

      <Submit pending={pending}>Confirm</Submit>

      <ResendButton onResend={resend} pending={pending}>
        Send another code
      </ResendButton>

      <p className="small muted" style={{ textAlign: 'center' }}>
        Wrong address? <Link href="/sign-up">Start again</Link>
      </p>

      <p className="tiny muted" style={{ textAlign: 'center' }}>
        In development the code is printed to the server log rather than emailed — the console
        transport is refused in production.
      </p>
    </form>
  );
}

// ── recovery ─────────────────────────────────────────────────

/**
 * Recovery, in the two steps the endpoint actually implements.
 *
 * What was here before asked for an address, posted a body the endpoint could
 * not parse, and — on the 400 it got back — told the person a reset *link* was
 * on its way. There is no link. The server issues a six-digit code, expects it
 * back with a new password, and had no screen to receive either. This is that
 * screen.
 */
export function RecoverForm() {
  const router = useRouter();
  const [phase, setPhase] = useState<'request' | 'confirm' | 'done'>('request');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [sent, setSent] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onRequest(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFields({});
    const form = new FormData(e.currentTarget);
    const address = String(form.get('email') ?? '').trim();

    const body: PasswordResetBody = { step: 'start', email: address };

    start(async () => {
      const result = await post<PasswordResetBody>('/api/auth/password/reset', body);
      if (!result.ok) {
        setError(result.message ?? 'Could not start recovery.');
        setFields(result.fields ?? {});
        return;
      }
      setEmail(address);
      setPhase('confirm');
    });
  }

  function onConfirm(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFields({});
    const form = new FormData(e.currentTarget);

    const body: PasswordResetBody = {
      step: 'complete',
      email,
      code: String(form.get('code') ?? '').trim(),
      newPassword: String(form.get('newPassword') ?? ''),
    };

    start(async () => {
      const result = await post<PasswordResetBody>('/api/auth/password/reset', body);
      if (!result.ok) {
        setError(result.message ?? 'Could not set a new password.');
        setFields(result.fields ?? {});
        return;
      }
      setPhase('done');
    });
  }

  function resend() {
    setError(null);
    setSent(null);
    // The code endpoint does not issue reset codes — a reset code is minted by
    // the reset endpoint's own start step, and asking the other one would be a
    // 422 dressed up as a resend.
    const body: PasswordResetBody = { step: 'start', email };
    start(async () => {
      const result = await post<PasswordResetBody>('/api/auth/password/reset', body);
      setSent(result.ok ? 'Another code is on its way.' : (result.message ?? 'Could not send a code just now.'));
    });
  }

  if (phase === 'done') {
    return (
      <div className="stack stack-4">
        <h1 className="h2">Password changed</h1>
        <p className="small muted">
          Every device that was signed in has been signed out, including any that should not have
          been. Sign in with the new password.
        </p>
        <button
          type="button"
          className="btn btn-primary btn-block"
          onClick={() => router.push('/sign-in?reset=1')}
        >
          Go to sign in
        </button>
      </div>
    );
  }

  if (phase === 'confirm') {
    return (
      <form onSubmit={onConfirm} className="stack stack-5">
        <div>
          <h1 className="h2">Set a new password</h1>
          <p className="small muted" style={{ marginTop: 6 }}>
            If <strong>{email}</strong> has a {BRAND.name} account, a six-digit code is on its way to it.
            It is valid for ten minutes.
          </p>
        </div>

        <ErrorNote message={error} />
        {sent ? (
          <div className="notice notice-info" role="status">
            {sent}
          </div>
        ) : null}

        <CodeField error={fields.code} />

        <PasswordField
          id="newPassword"
          name="newPassword"
          label="New password"
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          hint={`At least ${PASSWORD_MIN_LENGTH} characters. Longer beats complicated.`}
          error={fields.newPassword}
          autoFocus={false}
        />

        <Submit pending={pending}>Change password</Submit>

        <ResendButton onResend={resend} pending={pending}>
          Send another code
        </ResendButton>

        <p className="small muted" style={{ textAlign: 'center' }}>
          <button
            type="button"
            className="op-linkish"
            onClick={() => {
              setPhase('request');
              setError(null);
              setSent(null);
            }}
          >
            Use a different address
          </button>
        </p>
      </form>
    );
  }

  return (
    <form onSubmit={onRequest} className="stack stack-5">
      <div>
        <h1 className="h2">Recover your account</h1>
        <p className="small muted" style={{ marginTop: 6 }}>
          Enter the email on your {BRAND.name} and we will send a six-digit code.
        </p>
      </div>

      <ErrorNote message={error} />

      <div className="field">
        <label className="label" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          className="input"
          autoComplete="email"
          required
          autoFocus
          defaultValue={email}
        />
        <FieldNote message={fields.email} />
      </div>

      <Submit pending={pending}>Send a code</Submit>

      <p className="small muted" style={{ textAlign: 'center' }}>
        <Link href="/sign-in">Back to sign in</Link>
      </p>

      <p className="tiny muted" style={{ textAlign: 'center' }}>
        The next screen appears whether or not that address has an account. Confirming which
        addresses are registered would hand an attacker a list.
      </p>
    </form>
  );
}
