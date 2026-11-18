/**
 * Running the detectors, and clearing what has been dealt with.
 *
 * `computeInsights` upserts on (organization, method, window), so pressing
 * Recompute twice produces the same rows rather than duplicates — which is why
 * it is safe to put behind a button at all.
 *
 * Every one of these takes its organization from `requirePartner`, never from the
 * posted form: the id in the URL is a request to look at a tenant, and the guard
 * is what decides whether it is the caller's.
 */
'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { actOnInsight, computeInsights, dismissInsight } from '@/lib/insights/merchant';
import { requirePartner } from '@/components/partner/guard';
import { AppError } from '@/lib/errors';

/** Re-run every detector over this organization's rows. */
export async function recomputeInsights(orgId: string): Promise<void> {
  const ctx = await requirePartner('partner.analytics:read', orgId, `/business/${orgId}/insights`);
  const base = `/business/${ctx.organizationId}/insights`;

  let found = 0;
  try {
    const findings = await computeInsights(ctx.organizationId);
    found = findings.length;
  } catch (err) {
    if (err instanceof AppError) redirect(`${base}?error=${encodeURIComponent(err.message)}`);
    throw err;
  }

  revalidatePath(base);
  redirect(`${base}?computed=${found}`);
}

/** Mark a finding as acted on, so the same advice is not repeated at you. */
export async function markInsightActed(orgId: string, formData: FormData): Promise<void> {
  const ctx = await requirePartner('partner.analytics:read', orgId, `/business/${orgId}/insights`);
  const base = `/business/${ctx.organizationId}/insights`;
  const id = String(formData.get('insightId') ?? '');

  try {
    // The tenant is the guard's, so an id from another organization is "not found"
    // inside the service rather than a row this page can touch.
    await actOnInsight(id, ctx.organizationId);
  } catch (err) {
    if (err instanceof AppError) redirect(`${base}?error=${encodeURIComponent(err.message)}`);
    throw err;
  }

  revalidatePath(base);
  redirect(`${base}?acted=1`);
}

/** Hide a finding. `listInsights` filters dismissed rows out; nothing is deleted. */
export async function dismissInsightAction(orgId: string, formData: FormData): Promise<void> {
  const ctx = await requirePartner('partner.analytics:read', orgId, `/business/${orgId}/insights`);
  const base = `/business/${ctx.organizationId}/insights`;
  const id = String(formData.get('insightId') ?? '');

  try {
    await dismissInsight(id, ctx.organizationId);
  } catch (err) {
    if (err instanceof AppError) redirect(`${base}?error=${encodeURIComponent(err.message)}`);
    throw err;
  }

  revalidatePath(base);
  redirect(`${base}?dismissed=1`);
}
