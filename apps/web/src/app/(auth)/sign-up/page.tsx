import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getActor } from '@/lib/authz/authorize';
import { SignUpForm } from '@/components/auth/forms';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = { title: `Create your ${BRAND.name}` };

export default async function SignUpPage() {
  const actor = await getActor();
  if (actor) redirect('/');
  return <SignUpForm />;
}
