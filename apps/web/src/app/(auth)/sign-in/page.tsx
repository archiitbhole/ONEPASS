import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getActor } from '@/lib/authz/authorize';
import { SignInForm } from '@/components/auth/forms';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = { title: 'Sign in' };

/** Only ever an in-app path — an open redirect here would be a phishing gift. */
function safeNext(value: string | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/';
  return value;
}

/**
 * The two screens that end here hand over a confirmation rather than leaving the
 * person to guess whether anything happened. The flag is a bare `1` in the query
 * string and the sentence lives on the server: a message rendered from arbitrary
 * query text is a defacement waiting to be linked to.
 */
function noticeFor(params: Record<string, string | string[] | undefined>): string | undefined {
  if (params.verified === '1') return `Email confirmed. Sign in to finish setting up your ${BRAND.name}.`;
  if (params.reset === '1') return 'Password changed. Sign in with the new one.';
  return undefined;
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = safeNext(typeof params.next === 'string' ? params.next : undefined);

  const actor = await getActor();
  if (actor) redirect(next);

  return <SignInForm next={next} notice={noticeFor(params)} />;
}
