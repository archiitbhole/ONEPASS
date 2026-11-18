/**
 * Loading state for /settings.
 *
 * Safe here because this page never calls `notFound()` — it reads the signed-in
 * person's own account. See the long note in home/loading.tsx for why a loading
 * boundary over a page that can refuse is a bug in this codebase.
 */
import { LoadingState, Skeleton } from '@/components/system';

export default function Loading() {
  return (
    <div className="wrap-narrow section-tight">
      <LoadingState label="Loading your settings">
        <div className="stack stack-5">
          <Skeleton variant="text" lines={2} />
          <Skeleton variant="card" />
          <Skeleton variant="card" />
        </div>
      </LoadingState>
    </div>
  );
}
