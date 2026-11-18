/**
 * Who am I? The one call the client makes on load to decide what to render.
 *
 * Returns the actor's own view of themselves: identity, roles, memberships. It
 * never returns a permission set the client could be tempted to trust — the UI
 * uses this to decide what to *show*, and the server decides what is *allowed*.
 */
import { route, json } from '@/lib/api';
import { getActor } from '@/lib/authz/authorize';

export const GET = route({ rateLimit: { name: 'auth:session:list' } }, async (ctx) => {
  const actor = ctx.actor ?? (await getActor());
  if (!actor) return json({ signedIn: false }, { status: 200 });

  return json({
    signedIn: true,
    user: {
      id: actor.userId,
      displayName: actor.displayName,
      email: actor.email,
      status: actor.status,
      isPlatformStaff: actor.isPlatformStaff,
    },
    platformRoles: actor.platformRoles,
    memberships: actor.memberships.map((m) => ({
      organizationId: m.organizationId,
      organizationName: m.organizationName,
      organizationSlug: m.organizationSlug,
      organizationStatus: m.organizationStatus,
      roles: m.roles,
    })),
    elevated: actor.elevated,
  });
});
