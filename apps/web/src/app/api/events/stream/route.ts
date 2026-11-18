/**
 * The server-sent event stream.
 *
 * One long-lived GET per signed-in client. Everything travels server → client, so
 * SSE rather than WebSockets: it reconnects on its own, crosses proxies without an
 * upgrade, and needs no second protocol to reason about.
 *
 * This is the one handler that does not go through route(). route() exists to
 * shape a request into one JSON response, and this response never ends — so the
 * few things it would have done (authentication, no-store, a request id) are done
 * here explicitly rather than borrowed from a wrapper that does not fit.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { PLATFORM_CHANNEL, orgChannel, userChannel } from '@/lib/audit';
import { getActor } from '@/lib/authz/authorize';
import { toErrorBody, unauthenticated } from '@/lib/errors';
import { requestId as newRequestId } from '@/lib/ids';
import { realtimeReady, sseComment, sseFrame, startOutboxPublisher, subscribe } from '@/lib/realtime';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Proxies and load balancers close a connection that has said nothing for a while,
 * and 25s sits comfortably under the usual 30–60s idle timeouts.
 */
const HEARTBEAT_MS = 25_000;

/**
 * Start the publisher when this module loads, so events written to the outbox
 * actually reach the streams this route serves. Correct for a single instance and
 * only that: at scale the publisher becomes a separate worker, which changes
 * nothing here or at any write site — that is what the outbox is for.
 */
startOutboxPublisher();

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = req.headers.get('x-request-id')?.slice(0, 40) || newRequestId();

  const actor = await getActor();
  if (!actor) {
    const err = unauthenticated();
    return NextResponse.json(toErrorBody(err, requestId), {
      status: err.status,
      headers: { 'cache-control': 'no-store, private', 'x-request-id': requestId },
    });
  }

  /**
   * Channels come from the session and from nowhere else.
   *
   * A `?channel=` parameter would be an authorization decision handed to the
   * caller: subscribing is a read, and `org:<id>` carries another tenant's
   * activity. Deriving the list here means there is no request a client can
   * construct that reaches a channel its session does not already entitle it to,
   * so the stream cannot become the one route that forgot to check.
   */
  const channels = [
    userChannel(actor.userId),
    ...actor.memberships
      .filter((membership) => membership.status === 'ACTIVE')
      .map((membership) => orgChannel(membership.organizationId)),
    // Platform operations, for platform staff only. Derived from the session like
    // every other channel here, so it is not something a request can ask for.
    ...(actor.isPlatformStaff ? [PLATFORM_CHANNEL] : []),
  ];

  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let unsubscribe: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    /*
      `async`, so the subscription is established before the stream says it is
      open.

      `subscribe()` attaches a local listener immediately, but nothing reaches
      that listener until this process has issued its Redis `psubscribe` — so a
      stream opened in the first moments after a deploy could miss an event
      published while that was still in flight. Narrow, real, and it cost the
      browser suite exactly one flake on a cold process.

      The cost is that the stream's *first* frame waits on the subscription
      rather than arriving instantly, which is the right way round: an open
      stream that silently drops the next event is worse than one that takes a
      few milliseconds longer to say it is open. `realtimeReady()` resolves
      immediately when no Redis is configured, so a Postgres-only deployment
      pays nothing for this.
    */
    async start(controller) {
      let open = true;

      const send = (chunk: string) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // The client went away between the last write and this one. Nothing to
          // report: closing down is the whole of the correct response.
          open = false;
        }
      };

      const close = () => {
        if (!open) return;
        open = false;
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = null;
        unsubscribe?.();
        unsubscribe = null;
        try {
          controller.close();
        } catch {
          /* already closed by the runtime */
        }
      };

      // A stream nobody is reading still holds a Redis subscription and a timer.
      // The abort is the only notice we get that the tab was closed, and it is
      // registered here — before the `await` below — so a tab closed while the
      // subscription is being established is still noticed.
      if (req.signal.aborted) {
        close();
        return;
      }
      req.signal.addEventListener('abort', close, { once: true });

      // Tell the browser how long to wait before reconnecting, before anything can
      // go wrong — a client that never received a retry falls back to 3s anyway,
      // but saying it makes the reconnect behaviour ours rather than the default's.
      send('retry: 3000\n\n');

      // Before the "open" comment, not after: the comment is what the client
      // takes as the signal that it is now hearing everything.
      await realtimeReady();

      // The tab may have gone while we waited. `close()` has already run in
      // that case, and enqueuing onto a closed controller throws.
      if (!open) return;

      send(sseComment(`stream open · ${channels.length} channel(s)`));

      unsubscribe = subscribe(channels, (message) => send(sseFrame(message)));

      // A comment frame is a no-op to an EventSource and a byte on the wire to
      // everything in between, which is exactly what an idle timeout needs to see.
      heartbeat = setInterval(() => send(sseComment('keep-alive')), HEARTBEAT_MS);
      heartbeat.unref?.();

    },

    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = null;
      unsubscribe?.();
      unsubscribe = null;
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      // no-transform matters as much as no-store: a proxy that "helpfully"
      // compresses or buffers this response breaks the stream rather than slows it.
      'cache-control': 'no-store, no-transform',
      connection: 'keep-alive',
      // Nginx buffers proxied responses by default, which holds every event until
      // the buffer fills. This is the header that turns that off.
      'x-accel-buffering': 'no',
      'x-request-id': requestId,
    },
  });
}
