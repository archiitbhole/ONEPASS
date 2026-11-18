/**
 * Loading state for /tickets.
 *
 * Safe here because this page never calls `notFound()`. See the long note in
 * home/loading.tsx: a Suspense boundary starts the response, which fixes the
 * HTTP status at 200 and stops a later `notFound()` from answering 404 — and
 * this codebase uses 404 as its authorization refusal.
 */
import { LoadingState, Skeleton } from '@/components/system';

export default function Loading() {
  return (
    <div className="wrap section-tight">
      <LoadingState>
        <div className="stack stack-5">
          <Skeleton variant="text" lines={2} />
          <Skeleton variant="table" lines={5} />
        </div>
      </LoadingState>
    </div>
  );
}
