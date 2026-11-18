/**
 * The developer page — keys, webhooks, usage, and the two endpoints that matter.
 *
 * WHAT IS NOT ON THIS PAGE, deliberately: an API key's secret and a webhook's
 * signing secret. `api_keys` stores a SHA-256 of the key and nothing reversible;
 * the plaintext is shown once, at creation, and cannot be recovered here or
 * anywhere else. The columns are therefore selected by name rather than with
 * `select()`, so a schema change cannot quietly start rendering a hash — see the
 * queries below.
 *
 * The integration section documents the real endpoints as they are implemented
 * in src/app/api/v1, with a curl example built from this request's own host and,
 * where this organization has issued one, one of its own credential references.
 * A copyable example that actually returns something is worth more than a page
 * of prose.
 */
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { apiKeys, apiUsage, credentials, webhookDeliveries, webhooks } from '@/db/schema';
import {
  Badge,
  Card,
  CardHead,
  Empty,
  Meter,
  Notice,
  Stat,
  TableScroll,
  formatDateTime,
  formatRelative,
} from '@/components/ui';
import { requirePartner } from '@/components/partner/guard';
import { PageHeader, Summary } from '@/components/partner/shell';
import { CreateApiKey, CreateWebhook, RedeliverButton } from '@/components/partner/developer-forms';
import { EVENT_TYPES } from '@/lib/webhooks/subscriptions';
import { MAX_ATTEMPTS } from '@/lib/webhooks/dispatch';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = { title: 'API' };
export const dynamic = 'force-dynamic';

const USAGE_DAYS = 30;

/** 'YYYY-MM-DD' — `api_usage.day` is a date column, bucketed daily. */
function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default async function ApiPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const ctx = await requirePartner('partner.apikey:read', orgId, `/business/${orgId}/api`);
  const organizationId = ctx.organizationId;
  const canSeeWebhooks = ctx.permissions.has('partner.webhook:read');
  const canWriteKeys = ctx.permissions.has('partner.apikey:write');
  const canWriteWebhooks = ctx.permissions.has('partner.webhook:write');

  /**
   * What this member may put on a key.
   *
   * Narrowed to what they hold themselves, so the form cannot offer a scope the
   * API would then refuse. The check that matters is the server's; this is only
   * about not presenting a choice that is not one.
   */
  const grantableScopes = (
    [
      'partner.credential:read',
      'partner.credential:issue',
      'partner.credential:revoke',
      'partner.credential-type:read',
      'partner.pass:verify',
      'partner.analytics:read',
      'partner.transaction:read',
      'partner.verification:read',
    ] as const
  ).filter((scope) => ctx.permissions.has(scope));

  const since = dayKey(new Date(Date.now() - (USAGE_DAYS - 1) * 86_400_000));

  /** Columns named one by one. `keyHash` is not among them and never will be. */
  const keys = await db
    .select({
      id: apiKeys.id,
      label: apiKeys.label,
      prefix: apiKeys.prefix,
      scopes: apiKeys.scopes,
      lastUsedAt: apiKeys.lastUsedAt,
      expiresAt: apiKeys.expiresAt,
      revokedAt: apiKeys.revokedAt,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    // The guard's id, never params.orgId.
    .where(eq(apiKeys.organizationId, organizationId))
    .orderBy(desc(apiKeys.createdAt))
    .limit(50);

  /** Same rule: the URL and the events, never `secretCipher`. */
  const hooks = canSeeWebhooks
    ? await db
        .select({
          id: webhooks.id,
          url: webhooks.url,
          events: webhooks.events,
          active: webhooks.active,
          createdAt: webhooks.createdAt,
        })
        .from(webhooks)
        .where(eq(webhooks.organizationId, organizationId))
        .orderBy(desc(webhooks.createdAt))
        .limit(25)
    : [];

  const deliveries =
    hooks.length > 0
      ? await db
          .select({
            webhookId: webhookDeliveries.webhookId,
            attempts: sql<number>`count(*)::int`,
            delivered: sql<number>`cast(count(*) filter (where ${webhookDeliveries.deliveredAt} is not null) as int)`,
            failed: sql<number>`cast(count(*) filter (where ${webhookDeliveries.deliveredAt} is null and ${webhookDeliveries.error} is not null) as int)`,
            lastAt: sql<Date | null>`max(${webhookDeliveries.createdAt})`,
          })
          .from(webhookDeliveries)
          .where(
            inArray(
              webhookDeliveries.webhookId,
              hooks.map((hook) => hook.id),
            ),
          )
          .groupBy(webhookDeliveries.webhookId)
      : [];

  const deliveryBy = new Map(deliveries.map((row) => [row.webhookId, row]));

  /*
    The deliveries the platform has stopped trying to send.

    `attempt >= MAX_ATTEMPTS` and nothing scheduled: the drain will never pick
    these up again, and until now a partner whose endpoint was down for an
    afternoon had no way to ask for them. Capped, because this is a list to act
    on rather than an archive to browse — the audit log is the archive.
  */
  const abandoned =
    hooks.length === 0
      ? []
      : await db
          .select({
            id: webhookDeliveries.id,
            webhookId: webhookDeliveries.webhookId,
            eventType: webhookDeliveries.eventType,
            attempt: webhookDeliveries.attempt,
            responseCode: webhookDeliveries.responseCode,
            error: webhookDeliveries.error,
            createdAt: webhookDeliveries.createdAt,
          })
          .from(webhookDeliveries)
          .where(
            and(
              inArray(
                webhookDeliveries.webhookId,
                hooks.map((hook) => hook.id),
              ),
              isNull(webhookDeliveries.deliveredAt),
              isNull(webhookDeliveries.nextRetryAt),
              sql`${webhookDeliveries.attempt} >= ${MAX_ATTEMPTS}`,
            ),
          )
          .orderBy(desc(webhookDeliveries.createdAt))
          .limit(25);

  const hookUrl = new Map(hooks.map((hook) => [hook.id, hook.url]));

  const [byDay, byEndpoint] = await Promise.all([
    db
      .select({
        day: apiUsage.day,
        calls: sql<number>`coalesce(sum(${apiUsage.calls}), 0)::int`,
        errors: sql<number>`coalesce(sum(${apiUsage.errors}), 0)::int`,
        totalMs: sql<number>`coalesce(sum(${apiUsage.totalMs}), 0)::int`,
      })
      .from(apiUsage)
      .where(and(eq(apiUsage.organizationId, organizationId), gte(apiUsage.day, since)))
      .groupBy(apiUsage.day)
      .orderBy(desc(apiUsage.day))
      .limit(USAGE_DAYS),
    db
      .select({
        endpoint: apiUsage.endpoint,
        calls: sql<number>`coalesce(sum(${apiUsage.calls}), 0)::int`,
        errors: sql<number>`coalesce(sum(${apiUsage.errors}), 0)::int`,
        totalMs: sql<number>`coalesce(sum(${apiUsage.totalMs}), 0)::int`,
      })
      .from(apiUsage)
      .where(and(eq(apiUsage.organizationId, organizationId), gte(apiUsage.day, since)))
      .groupBy(apiUsage.endpoint)
      .orderBy(sql`coalesce(sum(${apiUsage.calls}), 0) desc`)
      .limit(20),
  ]);

  /** An organization's own credential, so the example below returns a real answer. */
  const [sample] = await db
    .select({ publicRef: credentials.publicRef })
    .from(credentials)
    .where(eq(credentials.organizationId, organizationId))
    .orderBy(desc(credentials.createdAt))
    .limit(1);

  const requestHeaders = await headers();
  const host = requestHeaders.get('host') ?? 'localhost:3000';
  const scheme = host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https';
  const origin = `${scheme}://${host}`;
  const exampleRef = sample?.publicRef ?? 'crd_example_reference';
  const examplePrefix = keys.find((key) => key.revokedAt === null)?.prefix ?? 'op_live_xxxxxxxx';

  const totalCalls = byDay.reduce((sum, row) => sum + row.calls, 0);
  const totalErrors = byDay.reduce((sum, row) => sum + row.errors, 0);
  const totalMs = byDay.reduce((sum, row) => sum + row.totalMs, 0);
  const peak = byDay.reduce((max, row) => Math.max(max, row.calls), 0);
  const activeKeys = keys.filter((key) => key.revokedAt === null).length;

  const verifyExample = [
    `curl -X POST ${origin}/api/v1/verify \\`,
    `  -H 'content-type: application/json' \\`,
    `  -H 'authorization: Bearer ${examplePrefix}...' \\`,
    `  -d '{"reference":"${exampleRef}"}'`,
  ].join('\n');

  const credentialExample = `curl ${origin}/api/v1/credentials/${exampleRef}`;

  return (
    <div className="stack stack-5">
      <PageHeader
        eyebrow="Develop"
        title="API"
        lede="Keys, webhooks and metered usage for this organization. Secrets are not on this page and cannot be recovered from it — only a SHA-256 of each key is stored."
      />

      <div className="grid grid-4">
        <Stat label="Active keys" value={activeKeys} hint={`${keys.length} issued in total`} />
        <Stat label={`Calls, ${USAGE_DAYS} days`} value={totalCalls} hint={`peak ${peak} in a day`} />
        <Stat
          label="Errors"
          value={totalErrors}
          hint={totalCalls > 0 ? `${((totalErrors / totalCalls) * 100).toFixed(1)}% of calls` : 'No calls recorded'}
          tone={totalErrors > 0 ? 'warn' : undefined}
        />
        <Stat
          label="Mean response"
          value={totalCalls > 0 ? `${Math.round(totalMs / totalCalls)} ms` : '—'}
          hint="Derived from stored duration sums, not a running average"
        />
      </div>

      <Card>
        <CardHead
          title="API keys"
          action={<span className="small muted">Prefix and last use only</span>}
        />
        {keys.length === 0 ? (
          <Empty
            title="No API keys"
            body="A key's plaintext is returned exactly once, when it is created. This page can show which keys exist and when each was last used — it cannot show you a key."
          />
        ) : (
          <>
            <TableScroll>
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Label</th>
                    <th scope="col">Prefix</th>
                    <th scope="col">Scopes</th>
                    <th scope="col">Created</th>
                    <th scope="col">Last used</th>
                    <th scope="col">State</th>
                  </tr>
                </thead>
                <tbody>
                  {keys.map((key) => {
                    const expired = key.expiresAt !== null && key.expiresAt.getTime() <= Date.now();
                    return (
                      <tr key={key.id}>
                        <td style={{ fontWeight: 600 }}>{key.label}</td>
                        <td className="mono nowrap">
                          {key.prefix}
                          <span className="muted">…</span>
                        </td>
                        <td className="row-wrap" style={{ gap: 4 }}>
                          {key.scopes.map((scope) => (
                            <Badge key={scope} tone="neutral">
                              {scope}
                            </Badge>
                          ))}
                        </td>
                        <td className="small muted nowrap">
                          {formatDateTime(key.createdAt)}
                        </td>
                        <td className="small nowrap">
                          {key.lastUsedAt ? (
                            formatRelative(key.lastUsedAt)
                          ) : (
                            <span className="muted">never used</span>
                          )}
                        </td>
                        <td>
                          {key.revokedAt ? (
                            <Badge tone="bad" dot>
                              revoked
                            </Badge>
                          ) : expired ? (
                            <Badge tone="warn" dot>
                              expired
                            </Badge>
                          ) : (
                            <Badge tone="ok" dot>
                              active
                            </Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableScroll>
            <Notice tone="info">
              <span>
                The full key is shown once, when it is created. What is stored is a SHA-256 of it,
                so {BRAND.name} cannot show it to you again and cannot show it to anyone who compromises
                this console. A key you cannot find is a key to revoke and reissue.
              </span>
            </Notice>
          </>
        )}
      </Card>

      {canWriteKeys && grantableScopes.length > 0 ? (
        <Card>
          <CardHead
            title="Create an API key"
            action={<span className="small muted">Shown once, then only its hash is kept</span>}
          />
          <CreateApiKey orgId={organizationId} scopes={grantableScopes} />
        </Card>
      ) : null}

      {canSeeWebhooks ? (
        <Card>
          <CardHead
            title="Webhooks"
            action={<span className="small muted">Signing secrets are sealed and not shown</span>}
          />
          {hooks.length === 0 ? (
            <Empty
              title="No webhooks configured"
              body="An endpoint registered here receives this organization's events as they happen, signed over the exact bytes sent. The signing secret is shown once and sealed at rest."
            />
          ) : (
            <TableScroll>
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Endpoint</th>
                    <th scope="col">Events</th>
                    <th scope="col">State</th>
                    <th scope="col" className="table-num">Attempts</th>
                    <th scope="col" className="table-num">Delivered</th>
                    <th scope="col" className="table-num">Failed</th>
                    <th scope="col">Last attempt</th>
                  </tr>
                </thead>
                <tbody>
                  {hooks.map((hook) => {
                    const stats = deliveryBy.get(hook.id);
                    return (
                      <tr key={hook.id}>
                        <td className="mono small break-all" style={{ maxWidth: 320 }}>
                          {hook.url}
                        </td>
                        <td className="row-wrap" style={{ gap: 4 }}>
                          {hook.events.map((event) => (
                            <Badge key={event} tone="neutral">
                              {event}
                            </Badge>
                          ))}
                        </td>
                        <td>
                          {hook.active ? (
                            <Badge tone="ok" dot>
                              active
                            </Badge>
                          ) : (
                            <Badge tone="neutral">paused</Badge>
                          )}
                        </td>
                        <td className="table-num">{stats?.attempts ?? 0}</td>
                        <td className="table-num">{stats?.delivered ?? 0}</td>
                        <td className="table-num">{stats?.failed ?? 0}</td>
                        <td className="small muted nowrap">
                          {stats?.lastAt ? formatRelative(new Date(stats.lastAt)) : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableScroll>
          )}
        </Card>
      ) : null}

      {hooks.length > 0 ? (
        <Card>
          <CardHead
            title="Given up on"
            action={
              <span className="small muted">
                {abandoned.length === 0
                  ? `Nothing abandoned`
                  : `${abandoned.length} ${abandoned.length === 1 ? 'delivery' : 'deliveries'}, newest first`}
              </span>
            }
          />
          {abandoned.length === 0 ? (
            <Empty
              title="Nothing has been abandoned"
              body={`A delivery is retried ${MAX_ATTEMPTS} times over about an hour. Anything still unsent after that stops and appears here, where it can be sent again.`}
            />
          ) : (
            <div className="stack stack-3">
              <TableScroll>
                <table className="table">
                  <caption className="sr-only">Webhook deliveries the platform stopped retrying</caption>
                  <thead>
                    <tr>
                      <th scope="col">Event</th>
                      <th scope="col">Endpoint</th>
                      <th scope="col">Last response</th>
                      <th scope="col">Queued</th>
                      {canWriteWebhooks ? <th scope="col">Action</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {abandoned.map((row) => (
                      <tr key={row.id}>
                        <td className="mono small nowrap">{row.eventType}</td>
                        <td className="mono small break-all" style={{ maxWidth: 260 }}>
                          {hookUrl.get(row.webhookId) ?? '—'}
                        </td>
                        <td className="small">
                          {row.responseCode ? (
                            <Badge tone="bad">HTTP {row.responseCode}</Badge>
                          ) : (
                            <Badge tone="bad">no response</Badge>
                          )}
                          {row.error ? (
                            <span className="tiny muted stacked">{row.error}</span>
                          ) : null}
                        </td>
                        <td className="small muted nowrap">{formatRelative(new Date(row.createdAt))}</td>
                        {canWriteWebhooks ? (
                          <td>
                            <RedeliverButton
                              orgId={organizationId}
                              webhookId={row.webhookId}
                              deliveryId={row.id}
                            />
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
              <p className="tiny muted measure">
                Sending again queues the delivery; the drain sends it with everything else, signed afresh at
                the moment it goes. The payload is the original event — your handler should treat a repeated
                event id as one it has already seen.
              </p>
            </div>
          )}
        </Card>
      ) : null}

      {canWriteWebhooks ? (
        <Card>
          <CardHead
            title="Register an endpoint"
            action={<span className="small muted">Signing secret shown once</span>}
          />
          <CreateWebhook orgId={organizationId} eventTypes={EVENT_TYPES} />
        </Card>
      ) : null}

      <div className="split">
        <Card>
          <CardHead
            title={`Daily usage, last ${USAGE_DAYS} days`}
            action={<span className="small muted">{byDay.length} days with traffic</span>}
          />
          {byDay.length === 0 ? (
            <Empty
              title="No metered calls"
              body="Usage is bucketed daily per key and endpoint. A day with no calls has no row rather than a zero, so nothing here is filled in."
            />
          ) : (
            <TableScroll>
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Day</th>
                    <th scope="col" style={{ minWidth: 120 }}>Share of peak</th>
                    <th scope="col" className="table-num">Calls</th>
                    <th scope="col" className="table-num">Errors</th>
                    <th scope="col" className="table-num">Mean ms</th>
                  </tr>
                </thead>
                <tbody>
                  {byDay.map((row) => (
                    <tr key={String(row.day)}>
                      <td className="mono small nowrap">
                        {String(row.day)}
                      </td>
                      <td>
                        <Meter
                          value={row.calls}
                          max={peak}
                          label={`${row.calls} calls on ${String(row.day)}, against a peak of ${peak}`}
                          tone={row.errors > 0 ? 'warn' : 'accent'}
                        />
                      </td>
                      <td className="table-num">{row.calls}</td>
                      <td className="table-num">{row.errors}</td>
                      <td className="table-num">
                        {row.calls > 0 ? Math.round(row.totalMs / row.calls) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          )}
        </Card>

        <Card>
          <CardHead title="By endpoint" action={<span className="small muted">Same window</span>} />
          {byEndpoint.length === 0 ? (
            <Empty title="Nothing called yet" body="Endpoints appear here once a key is used against one." />
          ) : (
            <TableScroll>
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Endpoint</th>
                    <th scope="col" className="table-num">Calls</th>
                    <th scope="col" className="table-num">Errors</th>
                    <th scope="col" className="table-num">Mean ms</th>
                  </tr>
                </thead>
                <tbody>
                  {byEndpoint.map((row) => (
                    <tr key={row.endpoint}>
                      <td className="mono small">{row.endpoint}</td>
                      <td className="table-num">{row.calls}</td>
                      <td className="table-num">{row.errors}</td>
                      <td className="table-num">
                        {row.calls > 0 ? Math.round(row.totalMs / row.calls) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          )}
        </Card>
      </div>

      <Card>
        <CardHead
          title="Integrate"
          action={<Summary items={[{ label: 'Base URL', value: <span className="tiny">{origin}</span> }]} />}
        />

        <div className="stack stack-5">
          <section className="stack stack-3">
            <div className="row-wrap" style={{ gap: 8 }}>
              <Badge tone="accent">POST</Badge>
              <span className="mono" style={{ fontWeight: 600 }}>
                /api/v1/verify
              </span>
              <Badge tone="neutral">no account required</Badge>
            </div>
            <p className="small muted measure">
              Answers whether a presented credential reference is genuine, who issued it, and what it
              asserts. Deliberately open: an employer checking a degree has no {BRAND.name} account and
              should not need one. It is rate limited per IP, and references are random rather than
              sequential so there is nothing to enumerate even at full rate.
            </p>
            <dl className="dl">
              <div>
                <dt>Body</dt>
                <dd className="mono tiny">{`{ "reference": "string, 4–64 chars" }`}</dd>
              </div>
              <div>
                <dt>Authorization</dt>
                <dd>
                  Optional. <span className="mono tiny">Bearer &lt;api key&gt;</span> — it changes
                  attribution only: a verification made with a key is recorded against your
                  organization, which is what powers your &ldquo;who is checking these?&rdquo; view.
                </dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>
                  200 for every resolved verdict, including <span className="mono">REVOKED</span> and{' '}
                  <span className="mono">NOT_FOUND</span> — the call succeeded and the answer is the
                  point. Only a malformed request is a 4xx.
                </dd>
              </div>
              <div>
                <dt>Returns</dt>
                <dd className="mono tiny">
                  {`{ outcome, summary, checks[], credential | null }`}
                </dd>
              </div>
            </dl>
            <pre className="card-flat mono tiny break-all" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
              {verifyExample}
            </pre>
          </section>

          <hr className="divider" />

          <section className="stack stack-3">
            <div className="row-wrap" style={{ gap: 8 }}>
              <Badge tone="accent">GET</Badge>
              <span className="mono" style={{ fontWeight: 600 }}>
                /api/v1/credentials/[ref]
              </span>
              <Badge tone="neutral">what a QR scan lands on</Badge>
            </div>
            <p className="small muted measure">
              The same verification, addressed by reference in the path. A scan is a verification
              whether it arrived as a POST or as someone opening a link, and it is recorded either
              way. Same disclosure rules: what the credential asserts and who asserts it — never the
              holder&rsquo;s email, mobile or user id.
            </p>
            <pre className="card-flat mono tiny break-all" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
              {credentialExample}
            </pre>
            <p className="tiny muted">
              {sample
                ? 'The reference above is one this organization has actually issued, so the command returns a real verdict.'
                : 'This organization has not issued a credential yet, so the reference above is a placeholder — the command will answer NOT_FOUND, which is itself a valid response.'}
            </p>
          </section>

          <Notice tone="info">
            <span>
              Integrity is not taken on trust from our database. Every credential carries a SHA-256
              of its canonical claims and an Ed25519 signature over that hash by the issuing
              organization&rsquo;s key, and verification recomputes both. Your public key is
              published on your organization profile, so a third party can check a signature without
              trusting {BRAND.name} at all.
            </span>
          </Notice>
        </div>
      </Card>
    </div>
  );
}
