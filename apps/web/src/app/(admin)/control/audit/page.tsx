/**
 * The platform audit trail.
 *
 * Read-only, and that is structural rather than polite: `src/lib/audit.ts` offers
 * no update and no delete, and `permissions.ts` holds no permission that would
 * allow one — there is deliberately no `platform.audit:write` for a role to be
 * given. So this page is the whole of the console's access to the table.
 *
 * `ipHash` is never selected. It is a peppered one-way hash whose only purpose is
 * correlation inside the database; rendered on a screen it becomes a tracking
 * identifier that outlives the investigation it was collected for.
 *
 * The filters are the ones an investigation actually starts from — who, what, and
 * when — and they live in the URL so a line of enquiry can be handed to a
 * colleague as a link. The actor box takes a user id when you have one from
 * another screen, and falls back to matching a display name when you do not.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { and, desc, eq, gte, ilike, lte, sql, type SQL } from 'drizzle-orm';
import { db } from '@/db/client';
import { auditLogs, organizations, userProfiles } from '@/db/schema';
import { Badge, Card, CardHead, Empty, TableScroll, formatDateTime } from '@/components/ui';
import { FilterLinks, PageHeader, Summary } from '@/components/partner/shell';
import { requirePlatform } from '@/components/admin/guard';
import { MetadataTable } from '@/components/admin/parts';
import { dayParam, firstParam, likeTerm, oneOf, withParam } from '@/components/admin/redact';
import { isUlid } from '@/lib/ids';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = { title: 'Audit' };
export const dynamic = 'force-dynamic';

const RESULTS = ['SUCCESS', 'DENIED', 'FAILED'] as const;
const BASE = '/control/audit';
const LIMIT = 100;

function resultTone(result: string): 'ok' | 'warn' | 'bad' | 'neutral' {
  if (result === 'SUCCESS') return 'ok';
  if (result === 'DENIED') return 'warn';
  if (result === 'FAILED') return 'bad';
  return 'neutral';
}

export default async function ControlAuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePlatform('platform.audit:read', BASE);
  const query = await searchParams;

  const actor = firstParam(query.actor)?.slice(0, 120) ?? null;
  const action = firstParam(query.action)?.slice(0, 80) ?? null;
  const result = oneOf(query.result, RESULTS);
  const fromRaw = firstParam(query.from);
  const toRaw = firstParam(query.to);
  const from = dayParam(query.from);
  const to = dayParam(query.to, true);

  const where: (SQL | undefined)[] = [];
  if (actor) {
    // An id from another screen is the precise case; a name is the human one.
    where.push(isUlid(actor) ? eq(auditLogs.actorUserId, actor) : ilike(userProfiles.displayName, likeTerm(actor)));
  }
  if (action) where.push(eq(auditLogs.action, action));
  if (result) where.push(eq(auditLogs.result, result));
  // Typed operators, never a Date interpolated into a `sql` template.
  if (from) where.push(gte(auditLogs.createdAt, from));
  if (to) where.push(lte(auditLogs.createdAt, to));
  const filter = where.length ? and(...where) : undefined;

  const rows = await db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      targetType: auditLogs.targetType,
      targetId: auditLogs.targetId,
      result: auditLogs.result,
      actorUserId: auditLogs.actorUserId,
      actorRole: auditLogs.actorRole,
      organizationId: auditLogs.organizationId,
      requestId: auditLogs.requestId,
      userAgent: auditLogs.userAgent,
      metadata: auditLogs.metadata,
      createdAt: auditLogs.createdAt,
      actorName: userProfiles.displayName,
      organizationName: organizations.name,
    })
    .from(auditLogs)
    .leftJoin(userProfiles, eq(userProfiles.userId, auditLogs.actorUserId))
    .leftJoin(organizations, eq(organizations.id, auditLogs.organizationId))
    .where(filter)
    // Ids are ULIDs, so newest-first is `id desc`.
    .orderBy(desc(auditLogs.id))
    .limit(LIMIT);

  // The action list is read from the trail itself rather than from a hard-coded
  // catalogue, so an action recorded by code written next month appears here
  // without this page being edited.
  const actions = await db
    .select({ action: auditLogs.action, total: sql<number>`cast(count(*) as int)` })
    .from(auditLogs)
    .groupBy(auditLogs.action)
    .orderBy(auditLogs.action)
    .limit(80);

  const current = { actor, action, result, from: fromRaw, to: toRaw };
  const denied = rows.filter((row) => row.result !== 'SUCCESS').length;

  return (
    <div className="stack stack-5">
      <PageHeader
        eyebrow="Platform"
        title="Audit"
        lede="Append-only. Nothing in this platform can update or delete a row in this table — there is no permission for it, so no role can hold one."
      />

      <Card>
        <div className="stack stack-4">
          <form method="get" action={BASE} className="row-wrap" style={{ gap: 12, alignItems: 'flex-end' }}>
            <div className="field grow" style={{ minWidth: 220 }}>
              <label className="label" htmlFor="audit-actor">
                Actor
              </label>
              <input
                id="audit-actor"
                className="input"
                type="search"
                name="actor"
                defaultValue={actor ?? ''}
                placeholder="User id, or part of a name"
                maxLength={120}
              />
            </div>
            <div className="field" style={{ minWidth: 240 }}>
              <label className="label" htmlFor="audit-action">
                Action
              </label>
              <select id="audit-action" className="select" name="action" defaultValue={action ?? ''}>
                <option value="">Any action</option>
                {actions.map((row) => (
                  <option key={row.action} value={row.action}>
                    {row.action} ({row.total})
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="label" htmlFor="audit-from">
                From
              </label>
              <input id="audit-from" className="input" type="date" name="from" defaultValue={fromRaw ?? ''} />
            </div>
            <div className="field">
              <label className="label" htmlFor="audit-to">
                To
              </label>
              <input id="audit-to" className="input" type="date" name="to" defaultValue={toRaw ?? ''} />
            </div>
            {result ? <input type="hidden" name="result" value={result} /> : null}
            <div className="row" style={{ gap: 8, paddingBottom: 2 }}>
              <button type="submit" className="btn btn-primary">
                Filter
              </button>
              {actor || action || from || to ? (
                <Link className="btn" href={withParam(BASE, current, { actor: null, action: null, from: null, to: null })}>
                  Clear
                </Link>
              ) : null}
            </div>
          </form>

          <FilterLinks
            label="Filter the audit trail by result"
            current={result}
            options={[
              { href: withParam(BASE, current, { result: null }), label: 'Any result', value: null },
              ...RESULTS.map((value) => ({
                href: withParam(BASE, current, { result: value }),
                label: value.toLowerCase(),
                value,
              })),
            ]}
          />

          <Summary
            items={[
              { label: 'Entries shown', value: `${rows.length}${rows.length === LIMIT ? ' (capped)' : ''}` },
              { label: 'Not a success', value: denied },
              { label: 'Distinct actions recorded', value: actions.length },
            ]}
          />
        </div>
      </Card>

      <Card>
        <CardHead title="Trail" action={<span className="small muted">Newest first</span>} />
        {rows.length === 0 ? (
          <Empty
            title={actor || action || result || from || to ? 'Nothing matches those filters' : 'The trail is empty'}
            body={
              actor || action || result || from || to
                ? 'No entry in the audit trail sits inside those filters.'
                : 'Entries appear here as people and services act on the platform.'
            }
            action={
              actor || action || result || from || to ? (
                <Link className="btn btn-sm" href={BASE}>
                  Clear the filters
                </Link>
              ) : null
            }
          />
        ) : (
          <TableScroll>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Actor</th>
                  <th scope="col">Action</th>
                  <th scope="col">Target</th>
                  <th scope="col">Result</th>
                  <th scope="col">Evidence</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="small">
                      {formatDateTime(row.createdAt)}
                      {row.requestId ? <div className="tiny muted mono">{row.requestId}</div> : null}
                    </td>
                    <td className="small">
                      {row.actorUserId ? (
                        <Link href={`/control/users/${row.actorUserId}`}>
                          {row.actorName ?? BRAND.fallbackPersonName}
                        </Link>
                      ) : (
                        <span className="muted">the platform itself</span>
                      )}
                      <div className="tiny muted">
                        {row.actorRole ?? 'no role recorded'}
                        {row.organizationName ? ` · ${row.organizationName}` : ''}
                      </div>
                    </td>
                    <td className="small mono">{row.action}</td>
                    <td className="small">
                      {row.targetType}
                      {row.targetId ? <div className="tiny muted mono break-all">{row.targetId}</div> : null}
                    </td>
                    <td>
                      <Badge tone={resultTone(row.result)} dot>
                        {row.result.toLowerCase()}
                      </Badge>
                    </td>
                    <td style={{ minWidth: 240 }}>
                      <details>
                        <summary className="small">evidence</summary>
                        <div style={{ marginTop: 8 }}>
                          <MetadataTable metadata={row.metadata} />
                          {row.userAgent ? (
                            <p className="tiny muted break-all" style={{ marginTop: 6 }}>
                              {row.userAgent}
                            </p>
                          ) : null}
                        </div>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
        <p className="tiny muted" style={{ marginTop: 10 }}>
          The client IP is stored only as a peppered hash and is not selected by this page. Metadata
          was stripped of anything credential-shaped when the entry was written.
        </p>
      </Card>
    </div>
  );
}
