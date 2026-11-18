/**
 * Loading state for /notifications.
 *
 * Safe here because this page never calls `notFound()` — it reads the signed-in
 * person's own rows and renders whatever it finds, including nothing. See the
 * long note in home/loading.tsx for why that matters: a Suspense boundary fixes
 * the HTTP status at 200, and this codebase answers unauthorized with 404.
 */
import { LoadingState, Skeleton } from '@/components/system';

export default function Loading() {
  return (
    <div className="wrap section-tight">
      <LoadingState label="Loading your notifications">
        <div className="stack stack-5">
          <Skeleton variant="text" lines={2} />
          <Skeleton variant="row" />
          <Skeleton variant="table" lines={6} />
        </div>
      </LoadingState>
    </div>
  );
}
