/**
 * The ONEPASS API, from the phone.
 *
 * There is no second backend and no second auth scheme: this talks to exactly
 * the routes the web app talks to, and sessions are the same opaque httpOnly
 * cookie. React Native's networking stack keeps cookies per host, so a
 * successful sign-in leaves the session where every later call will find it.
 *
 * The host is configuration, not a constant. `EXPO_PUBLIC_API_URL` is read at
 * build time; the fallback is the Android emulator's alias for the host machine,
 * which is the address that is wrong the least often during development.
 */
const BASE = (process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:3000').replace(/\/$/, '');

export interface ApiError {
  code: string;
  message: string;
  requestId?: string;
}

export class OnepassError extends Error {
  readonly code: string;
  readonly requestId?: string;
  constructor(error: ApiError) {
    super(error.message);
    this.code = error.code;
    this.requestId = error.requestId;
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      // The API rejects a cross-origin write without an Origin it recognises.
      origin: BASE,
      ...(init.headers ?? {}),
    },
  });

  const text = await res.text();
  const body = text ? (JSON.parse(text) as unknown) : null;

  if (!res.ok) {
    const err = (body as { error?: ApiError } | null)?.error;
    throw new OnepassError(
      err ?? { code: 'INTERNAL', message: `Request failed with status ${res.status}.` },
    );
  }
  return body as T;
}

export interface MintedPass {
  passRef: string;
  token: string;
  expiresInSeconds: number;
  stepSeconds: number;
}

export interface Me {
  user: { id: string; email: string | null; status: string };
  profile: { displayName: string | null } | null;
}

export const api = {
  baseUrl: BASE,
  signIn: (email: string, password: string) =>
    call<{ ok?: boolean }>('/api/auth/sign-in', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  signOut: () => call<unknown>('/api/auth/sign-out', { method: 'POST' }),
  me: () => call<Me>('/api/me'),
  pass: () => call<MintedPass>('/api/me/pass'),
};
