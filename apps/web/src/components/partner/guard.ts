/**
 * The one door into every partner console page.
 *
 * `authorize()` is the security decision; this is the thin translation of its
 * result into what a *page* needs, which is different from what a route handler
 * needs in exactly one way: a page cannot return a status code, it has to render
 * something. So an `AppError` becomes Next's own `notFound()` or a redirect to
 * sign in, and the caller gets back a context whose `organizationId` is a plain
 * `string` rather than `string | null`.
 *
 * The important property is unchanged and is the whole point of the file: the
 * organization id every page filters its queries on is the one the guard resolved
 * from the caller's own membership. `params.orgId` is handed to the guard and then
 * dropped on the floor — no page reads it into a query.
 */
import { notFound, redirect } from 'next/navigation';
import { authorize, permissionsAt, type AuthorizedContext } from '@/lib/authz/authorize';
import type { Permission } from '@/lib/authz/permissions';
import { AppError } from '@/lib/errors';

export interface PartnerContext extends AuthorizedContext {
  /** Resolved by the guard. Every query on the page filters on this. */
  organizationId: string;
  /** What this actor may do *at this organization*, for deciding what to render. */
  permissions: Set<Permission>;
}

/**
 * Authorize a page, or leave.
 *
 * "Not yours" and "does not exist" both become a 404, deliberately — the same
 * reasoning as the API: a distinguishable refusal confirms the organization is
 * real to whoever guessed the id.
 */
export async function requirePartner(
  permission: Permission,
  orgId: string,
  backTo?: string,
): Promise<PartnerContext> {
  let ctx: AuthorizedContext;

  try {
    ctx = await authorize({ permission, organizationId: orgId });
  } catch (err) {
    if (err instanceof AppError) {
      if (err.code === 'UNAUTHENTICATED' || err.code === 'REAUTH_REQUIRED') {
        redirect(`/sign-in?next=${encodeURIComponent(backTo ?? `/business/${orgId}/dashboard`)}`);
      }
      notFound();
    }
    throw err;
  }

  // A partner permission always resolves an organization; this is belt and braces
  // so the type below is honest rather than asserted.
  if (!ctx.organizationId) notFound();

  return {
    ...ctx,
    organizationId: ctx.organizationId,
    permissions: permissionsAt(ctx.actor, ctx.organizationId),
  };
}
