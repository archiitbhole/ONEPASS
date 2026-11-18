import { headers } from 'next/headers';

/**
 * The origin this deployment is actually being read on.
 *
 * Every curl example on these pages is built against it, so what a reader
 * copies is a command that runs — rather than one containing
 * `https://your-onepass-host`, which they then have to notice and edit. Getting
 * that wrong is a small thing that wastes the first two minutes of every
 * integration.
 *
 * Preference order, and why:
 *  1. `APP_URL`, when this deployment has been told what it is. That is the
 *     value the CSRF origin check compares against, so an example built from it
 *     is an example that will pass that check.
 *  2. The request's own `host` header, with the protocol inferred from
 *     `x-forwarded-proto`. Correct behind a proxy, which is every real
 *     deployment.
 *  3. A placeholder, said plainly rather than guessed.
 *
 * The header is never trusted for anything but display text. A forged `host`
 * changes what a curl example says and nothing else — no redirect, no
 * signature, no link — and the reader is looking at the page on the real host
 * either way.
 */
export async function appHost(): Promise<string> {
  const configured = process.env.APP_URL;
  if (configured) return configured.replace(/\/+$/, '');

  const h = await headers();
  const host = h.get('host');
  if (!host) return 'https://your-onepass-host';

  const proto = h.get('x-forwarded-proto')?.split(',')[0]?.trim() ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}
