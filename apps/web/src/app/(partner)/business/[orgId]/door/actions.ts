/**
 * The door action.
 *
 * `admitTicket` returns a rejection rather than throwing one, which is exactly
 * what a door console needs: "expired at 21:00" is a result to render in red, not
 * an exception. So this action passes the service's own `reason` and `message`
 * straight through — the console never invents its own wording, because the
 * wording is a security decision (NOT_FOUND and WRONG_ORG deliberately read the
 * same, so a scanner cannot be used to confirm that a code is a live ticket at
 * some other partner).
 *
 * Authorization happens here, on every submission, with the organization id
 * resolved from the caller's own membership. The `orgId` bound into the action is
 * a routing hint, never a grant.
 */
'use server';

import { revalidatePath } from 'next/cache';
import { admitTicket } from '@/lib/commerce/tickets';
import { requirePartner } from '@/components/partner/guard';
import type { DoorState } from '@/components/partner/door-state';
import { AppError } from '@/lib/errors';

/** References are minted lowercase (`tkt_…`); a scanner or a tired thumb may not be. */
function normalise(raw: string): string {
  return raw.trim().replace(/\s+/g, '').toLowerCase();
}

export async function admitAction(orgId: string, _prev: DoorState, formData: FormData): Promise<DoorState> {
  const presented = normalise(String(formData.get('reference') ?? ''));
  const at = new Date().toISOString();

  if (presented.length < 4 || presented.length > 64) {
    return {
      phase: 'error',
      result: null,
      error: 'Enter the ticket reference exactly as it appears on the pass, for example tkt_4h2k9wq7c.',
      presented: presented || null,
      at,
    };
  }

  const ctx = await requirePartner('partner.pass:verify', orgId, `/business/${orgId}/door`);

  try {
    const result = await admitTicket({
      publicRef: presented,
      // The tenant the guard resolved. A ticket belonging to another organization
      // comes back as WRONG_ORG, which is worded identically to NOT_FOUND.
      organizationId: ctx.organizationId,
      staffUserId: ctx.actor.userId,
    });

    revalidatePath(`/business/${ctx.organizationId}/door`);
    return { phase: 'result', result, error: null, presented, at };
  } catch (err) {
    // Reaching here means something genuinely broke — a normal rejection is a
    // returned result, not an exception.
    return {
      phase: 'error',
      result: null,
      error:
        err instanceof AppError
          ? err.message
          : 'The door could not reach the ticket service. Try again.',
      presented,
      at,
    };
  }
}
