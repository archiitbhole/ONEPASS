/**
 * Live events — the browser side of the same outbox that feeds webhooks.
 *
 * Worth its own page rather than a section of the API reference, because the
 * interesting part is not the endpoint (there is one, it takes no parameters)
 * but the reasoning: why SSE, why channels are not a request parameter, and
 * what "at least once" means for code that renders on every event.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { Code } from '@/components/developers/code';
import { EndpointBlock } from '@/components/developers/endpoint';
import { endpoint } from '@/lib/api-catalog';
import { appHost } from '../host';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = {
  title: 'Live events',
  description:
    `Server-sent events for a signed-in ${BRAND.name} client: one connection, channels derived from the session, and the same transactional outbox that drives webhooks.`,
};

const CLIENT = `const stream = new EventSource('/api/events/stream');

// Named events, not onmessage: every frame carries an event type, and
// onmessage only fires for frames that have none.
stream.addEventListener('TICKET_ADMITTED', (frame) => {
  const message = JSON.parse(frame.data);
  // \`id\` is stable across a reconnect replay — key on it, or a re-delivered
  // admission will be counted twice.
  applyOnce(message.id, message.payload);
});

// EventSource reconnects on its own. Do not add your own retry loop on top;
// two of them fight, and the result is a reconnect storm after an outage.
stream.onerror = () => {
  /* Left empty on purpose. The browser is already retrying. */
};`;

export default async function RealtimePage() {
  const host = await appHost();
  const stream = endpoint('events-stream')!;

  return (
    <>
      <section className="stack stack-4">
        <p className="eyebrow">Reference</p>
        <h1 className="display h1">Live events</h1>
        <p className="lede">
          One long-lived connection per signed-in client. Everything travels server to client, so
          server-sent events rather than WebSockets: it reconnects on its own, crosses proxies
          without an upgrade, and needs no second protocol to reason about.
        </p>
      </section>

      <section className="card stack stack-4">
        <h2 className="h3 anchored">In the browser</h2>
        <Code language="plain">{CLIENT}</Code>
      </section>

      <section className="stack stack-4">
        <h2 className="h2 anchored">Three things that are not obvious</h2>

        <div className="card stack stack-3">
          <h3 className="h3">You cannot choose your channels</h3>
          <p className="muted" style={{ maxWidth: '70ch' }}>
            There is no <span className="mono">?channel=</span> parameter. Subscribing is a read,
            and an organization channel carries another tenant&rsquo;s activity — so the channel
            list is derived from the session and from nothing else. There is no request a client can
            construct that reaches a channel its session does not already entitle it to, which means
            this cannot become the one route that forgot to check.
          </p>
          <p className="muted" style={{ maxWidth: '70ch' }}>
            You get your own user channel, an organization channel for each membership you hold, and
            the platform channel if you are staff.
          </p>
        </div>

        <div className="card stack stack-3">
          <h3 className="h3">Events are written in the same transaction as the data</h3>
          <p className="muted" style={{ maxWidth: '70ch' }}>
            Writes append to an outbox table inside the transaction that makes the change; a
            publisher then reads that table and fans out over Redis to every connected stream. So an
            event can never describe a write that rolled back, and a write can never silently fail
            to produce its event because a network call happened to fail at the wrong moment.
          </p>
          <p className="muted" style={{ maxWidth: '70ch' }}>
            The cost of that guarantee is the one you have to code for:{' '}
            <strong>delivery is at least once</strong>. Key on{' '}
            <span className="mono">id</span> and make handlers idempotent.
          </p>
        </div>

        <div className="card stack stack-3">
          <h3 className="h3">This is not a server-to-server API</h3>
          <p className="muted" style={{ maxWidth: '70ch' }}>
            The stream authenticates with a session cookie, so it is a browser API. For delivery to
            your own systems, register a <Link href="/developers/webhooks">webhook</Link> — same
            outbox, same events, signed and retried.
          </p>
          <p className="muted" style={{ maxWidth: '70ch' }}>
            A comment frame arrives every 25 seconds, which sits under the usual 30–60 second proxy
            idle timeout. If you terminate TLS somewhere with a shorter one, that is the number to
            raise.
          </p>
        </div>
      </section>

      <section className="stack stack-4">
        <h2 className="h2 anchored">The endpoint</h2>
        <EndpointBlock endpoint={stream} host={host} />
      </section>
    </>
  );
}
