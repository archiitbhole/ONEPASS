/**
 * How a Control server action performs a platform mutation.
 *
 * Suspending a user, approving a partner and acknowledging a security event are
 * already implemented, once, in `src/app/api/admin/…`. Those handlers own the
 * state machine ("only an active organization can be suspended"), the audit
 * entry, the notification to the person affected, the session revocation and the
 * elevation requirement. Re-implementing any of that behind a form is how a
 * console and its API start disagreeing about what happened — so the action does
 * not re-implement it. It calls the handler.
 *
 * What this module builds is the request the handler expects. The session cookie
 * is read from the ambient request by `getActor()` exactly as it would be for a
 * fetch, so the caller is the signed-in administrator and nothing here can
 * elevate them; the `origin` header is set to APP_URL because `route()` refuses a
 * cookie-authenticated write without one, and a Server Action has already had its
 * own origin checked by Next before this code runs.
 *
 * The result is the handler's own response, unpacked: its status, and for a
 * refusal the sentence it wrote. Those sentences are written for a person —
 * "Only an active organization can be suspended" — so the console shows them as
 * they are rather than inventing its own.
 */
import { headers } from 'next/headers';
import { NextRequest } from 'next/server';
import { getEnv } from '@/lib/env';

type RouteHandler = (
  req: NextRequest,
  segment: { params: Promise<Record<string, string>> },
) => Promise<Response>;

export interface RouteCall {
  handler: RouteHandler;
  method: 'POST' | 'PATCH';
  /** The path the handler would have been reached at, for its own logging. */
  path: string;
  params?: Record<string, string>;
  body: unknown;
}

export interface RouteResult {
  ok: boolean;
  status: number;
  /** The handler's sentence when it refused, or null when it succeeded. */
  message: string | null;
  code: string | null;
}

interface ErrorShape {
  error?: { code?: string; message?: string };
}

export async function callAdminRoute(call: RouteCall): Promise<RouteResult> {
  const appUrl = getEnv().APP_URL;
  const incoming = await headers();

  const requestHeaders = new Headers({ 'content-type': 'application/json', origin: appUrl });
  // Carried through so the audit entry the handler writes names the browser and
  // the request that actually caused it, not this synthesised one.
  for (const name of ['user-agent', 'x-forwarded-for', 'x-real-ip', 'x-request-id']) {
    const value = incoming.get(name);
    if (value) requestHeaders.set(name, value);
  }

  const req = new NextRequest(new URL(call.path, appUrl), {
    method: call.method,
    headers: requestHeaders,
    body: JSON.stringify(call.body ?? {}),
  });

  const res = await call.handler(req, { params: Promise.resolve(call.params ?? {}) });

  if (res.ok) return { ok: true, status: res.status, message: null, code: null };

  let body: ErrorShape = {};
  try {
    body = (await res.json()) as ErrorShape;
  } catch {
    // A handler that did not answer in the shape it promises is still a refusal;
    // the status is the honest part of it.
  }

  return {
    ok: false,
    status: res.status,
    message: body.error?.message ?? 'That did not go through. Nothing was changed.',
    code: body.error?.code ?? null,
  };
}
