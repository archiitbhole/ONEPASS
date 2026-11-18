import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { VerifyCodeForm } from '@/components/auth/forms';
import { verifyPurpose } from '@/lib/auth/contracts';

export const metadata: Metadata = { title: 'Enter your code' };

function safeNext(value: string | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/';
  return value;
}

export default async function VerifyCodePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const destination = typeof params.email === 'string' ? params.email : '';

  // Parsed against the same enum the endpoint validates with, rather than passed
  // through as a string. A purpose the API will reject is a form that can only
  // fail, and a value from the query string is not a value this page chose.
  const purpose = verifyPurpose.catch('EMAIL_VERIFY').parse(
    typeof params.purpose === 'string' ? params.purpose : 'EMAIL_VERIFY',
  );

  // Without an address there is nothing to verify against; sending someone back
  // to sign in beats rendering a form that can only fail.
  if (!destination) redirect('/sign-in');

  return (
    <VerifyCodeForm
      destination={destination}
      purpose={purpose}
      next={safeNext(typeof params.next === 'string' ? params.next : undefined)}
    />
  );
}
