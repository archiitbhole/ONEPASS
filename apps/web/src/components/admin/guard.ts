/**
 * The one door into every page of the Control console.
 *
 * This is the third isolation boundary in the app, and it is built to hold like
 * the other two. A `platform.*` permission is never held through a membership —
 * `authorize()` computes it from `actor.platformRoles` and additionally requires
 * `isPlatformStaff` — so a partner owner and a consumer are refused here by the
 * same code path, and refused with the *same answer* they would get for a route
 * that does not exist. That is deliberate: a 403 on /control tells whoever probed
 * it that a platform console is there to be attacked.
 *
 * The guard is the translation of `authorize()`'s thrown error into what a page
 * can actually do, which is render something rather than return a status code.
 * The permission set it returns is for deciding what to *draw* — every page
 * authorizes for itself, and no page treats this layout guard as its own check.
 */
import { notFound, redirect } from 'next/navigation';
import { authorize, platformPermissions, type AuthorizedContext } from '@/lib/authz/authorize';
import type { Permission } from '@/lib/authz/permissions';
import { AppError } from '@/lib/errors';

export interface PlatformContext extends AuthorizedContext {
  /** What this actor may do across the platform, for deciding what to render. */
  permissions: Set<Permission>;
}

/**
 * Authorize a Control page, or leave.
 *
 * Signed out is a redirect to sign in, exactly as in the consumer and partner
 * shells. Anything else — not platform staff, staff without this permission, a
 * suspended account — is a 404, because "you may not" and "there is nothing here"
 * must be indistinguishable from outside.
 */
export async function requirePlatform(
  permission: Permission,
  backTo = '/control',
): Promise<PlatformContext> {
  let ctx: AuthorizedContext;

  try {
    ctx = await authorize({ permission });
  } catch (err) {
    if (err instanceof AppError) {
      if (err.code === 'UNAUTHENTICATED' || err.code === 'REAUTH_REQUIRED') {
        redirect(`/sign-in?next=${encodeURIComponent(backTo)}`);
      }
      notFound();
    }
    throw err;
  }

  return { ...ctx, permissions: platformPermissions(ctx.actor) };
}
