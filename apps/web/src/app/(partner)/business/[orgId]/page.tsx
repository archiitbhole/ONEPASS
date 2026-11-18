/**
 * `/business/[orgId]` has no content of its own — the console starts at the
 * dashboard. Redirecting rather than rendering keeps one canonical URL per screen,
 * which matters for a tool people bookmark.
 */
import { redirect } from 'next/navigation';

export default async function BusinessIndex({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  redirect(`/business/${orgId}/dashboard`);
}
