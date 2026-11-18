/**
 * The home loading state.
 *
 * ⚠️ WHY THIS IS HERE AND NOT ON THE ROUTE GROUP.
 *
 * A `loading.tsx` wraps its segment in a Suspense boundary, and a Suspense
 * boundary makes the response stream. Once streaming has begun the HTTP status
 * has already been sent — so a `notFound()` thrown further down can still swap
 * the *content* for the 404 page, but it can no longer change the **status from
 * 200 to 404**.
 *
 * That is fatal in this codebase specifically. ONEPASS uses `notFound()` as its
 * authorization refusal: `requirePartner` and `requirePlatform` both answer a
 * request for somebody else's tenant with a 404 rather than a 403, so that a URL
 * cannot be used to discover which organizations exist. A group-level
 * `loading.tsx` over the consoles turned every one of those refusals into a
 * 200, and the isolation suite caught it — `/control/security` answered 200 to a
 * support-role account that must not see it.
 *
 * So loading boundaries go only on pages that can never call `notFound()`.
 * Home is one: it reads the signed-in person's own rows and renders whatever it
 * finds, including nothing.
 *
 * Before adding one of these to a page, check the page for `notFound()` — and
 * remember that a guard can throw it on your behalf.
 */
import { LoadingState, Skeleton } from '@/components/system';
import { BRAND } from '@/lib/brand';

export default function HomeLoading() {
  return (
    <div className="wrap section-tight">
      <LoadingState label={`Loading your ${BRAND.name}`}>
        <div className="stack stack-5">
          <Skeleton variant="card" />
          <div className="grid grid-3">
            <Skeleton variant="stat" />
            <Skeleton variant="stat" />
            <Skeleton variant="stat" />
          </div>
          <Skeleton variant="text" lines={3} />
        </div>
      </LoadingState>
    </div>
  );
}
