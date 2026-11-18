/**
 * Liveness.
 *
 * The only question this answers is "is this process still able to serve a
 * request" — which is the question an orchestrator restarts on. It therefore
 * touches nothing: no database, no Redis, no session lookup. A liveness probe
 * that depends on Postgres turns one slow query into a rolling restart of every
 * otherwise healthy instance, which is how a brief dependency wobble becomes a
 * real outage. Readiness is where dependencies are checked; see /api/ready.
 *
 * It is public, so it says the minimum. No dependency versions, no runtime
 * version, no connection details, no host names — an unauthenticated caller
 * learning which library versions are deployed is free reconnaissance. The
 * application's own build version is the one identifier here, because a deploy
 * needs to be able to confirm what it just shipped.
 */
import { json, route } from '@/lib/api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Stamped by the deployment; absent locally, where the honest answer is "dev". */
const VERSION = process.env.APP_VERSION?.slice(0, 40) || 'dev';

export const GET = route(
  // loadActor: false is what keeps this handler free of a database round trip.
  { loadActor: false },
  async () =>
    json(
      { status: 'ok', uptime: Math.round(process.uptime()), version: VERSION },
      { headers: { 'cache-control': 'no-store' } },
    ),
);
