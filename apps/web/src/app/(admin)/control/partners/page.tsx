/**
 * The partner approval queue, and the partner directory behind it.
 *
 * The queue is first on the page because it is the only part of this console with
 * a service-level expectation attached: a business that has applied cannot trade
 * until somebody here decides, and until this screen existed that decision needed
 * psql. Everything a review actually turns on is on the card — legal name,
 * registration number, city, the website, the connector they intend to use, and
 * how long the application has been waiting.
 *
 * The query is the one from `GET /api/admin/partners`, including its escaped
 * ILIKE search and its masking of the support address. An administrator's job
 * here is to decide whether a business is real, not to correspond with it from
 * the console.
 *
 * Approving is what switches a partner on — `authorize()` refuses every
 * `partner.*` permission at an organization that is not ACTIVE — so the two
 * buttons on each card are the most consequential controls in the platform. They
 * are shown only to a role that holds the permission behind them.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { and, desc, eq, ilike, isNull, or, type SQL } from 'drizzle-orm';
import { db } from '@/db/client';
import { organizations, userProfiles } from '@/db/schema';
import {
  Badge,
  Card,
  CardHead,
  Empty,
  StatusBadge,
  TableScroll,
  formatDate,
  formatRelative,
} from '@/components/ui';
import { FilterLinks, PageHeader, Summary } from '@/components/partner/shell';
import { requirePlatform } from '@/components/admin/guard';
import { ActionOutcome, Detail } from '@/components/admin/parts';
import { firstParam, likeTerm, maskEmail, oneOf, withParam } from '@/components/admin/redact';
import { isUlid } from '@/lib/ids';
import { decidePartner } from './actions';

export const metadata: Metadata = { title: 'Partners' };
export const dynamic = 'force-dynamic';

const STATUSES = ['PENDING_REVIEW', 'ACTIVE', 'SUSPENDED', 'REJECTED'] as const;
const BASE = '/control/partners';
const LIMIT = 50;

export default async function ControlPartnersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requirePlatform('platform.partner:read', BASE);
  const query = await searchParams;

  const q = firstParam(query.q)?.slice(0, 120) ?? null;
  const status = oneOf(query.status, STATUSES);

  const mayApprove = ctx.permissions.has('platform.partner:approve');
  const maySuspend = ctx.permissions.has('platform.partner:suspend');

  const columns = {
    id: organizations.id,
    slug: organizations.slug,
    name: organizations.name,
    kind: organizations.kind,
    status: organizations.status,
    legalName: organizations.legalName,
    registrationNo: organizations.registrationNo,
    city: organizations.city,
    countryCode: organizations.countryCode,
    websiteUrl: organizations.websiteUrl,
    supportEmail: organizations.supportEmail,
    connectorKind: organizations.connectorKind,
    reviewedAt: organizations.reviewedAt,
    reviewNote: organizations.reviewNote,
    createdAt: organizations.createdAt,
    reviewerName: userProfiles.displayName,
  } as const;

  // The queue is always the whole queue, whatever the directory below is filtered
  // to. An application that scrolled out of a filtered view is an application
  // nobody answers.
  const pending = await db
    .select(columns)
    .from(organizations)
    .leftJoin(userProfiles, eq(userProfiles.userId, organizations.reviewedByUserId))
    .where(and(eq(organizations.status, 'PENDING_REVIEW'), isNull(organizations.deletedAt)))
    .orderBy(organizations.createdAt)
    .limit(LIMIT);

  const where: (SQL | undefined)[] = [isNull(organizations.deletedAt)];
  if (status) where.push(eq(organizations.status, status));
  if (q) {
    const term = likeTerm(q);
    where.push(
      or(
        isUlid(q) ? eq(organizations.id, q) : undefined,
        ilike(organizations.name, term),
        ilike(organizations.slug, term),
        ilike(organizations.legalName, term),
        ilike(organizations.registrationNo, term),
      ),
    );
  }

  const directory = await db
    .select(columns)
    .from(organizations)
    .leftJoin(userProfiles, eq(userProfiles.userId, organizations.reviewedByUserId))
    .where(and(...where))
    .orderBy(desc(organizations.id))
    .limit(LIMIT);

  const current = { q, status };
  const counts = {
    active: directory.filter((org) => org.status === 'ACTIVE').length,
    suspended: directory.filter((org) => org.status === 'SUSPENDED').length,
    rejected: directory.filter((org) => org.status === 'REJECTED').length,
  };

  return (
    <div className="stack stack-5">
      <PageHeader
        eyebrow="Platform"
        title="Partners"
        lede="Applications waiting on a decision come first. Approving one is what lets that organization’s whole team into the business console; suspending one puts them all out again in a single write."
        actions={
          pending.length > 0 ? (
            <Badge tone="warn" dot>
              {pending.length} awaiting review
            </Badge>
          ) : (
            <Badge tone="ok" dot>
              queue clear
            </Badge>
          )
        }
      />

      <ActionOutcome error={firstParam(query.error)} done={firstParam(query.done)} />

      <Card>
        <CardHead
          title="Approval queue"
          action={<span className="small muted">Status PENDING_REVIEW, oldest first</span>}
        />
        {pending.length === 0 ? (
          <Empty
            title="Nothing awaiting review"
            body="Every organization that has applied has had a decision recorded against it."
          />
        ) : (
          <div className="stack stack-4">
            {pending.map((org) => (
              <div key={org.id} className="card-flat stack stack-4">
                <div className="row-between">
                  <div>
                    <h3 className="h3">{org.name}</h3>
                    <p className="tiny muted mono">
                      {org.slug} · {org.id}
                    </p>
                  </div>
                  <span className="row-wrap" style={{ gap: 8 }}>
                    <Badge tone="neutral">{org.kind.replace(/_/g, ' ').toLowerCase()}</Badge>
                    <Badge tone="warn" dot>
                      waiting {formatRelative(org.createdAt)}
                    </Badge>
                  </span>
                </div>

                <div className="grid grid-3">
                  <Detail term="Legal name">{org.legalName ?? <span className="muted">not given</span>}</Detail>
                  <Detail term="Registration">
                    <span className="mono">{org.registrationNo ?? '—'}</span>
                  </Detail>
                  <Detail term="Place">
                    {[org.city, org.countryCode].filter(Boolean).join(', ') || (
                      <span className="muted">not given</span>
                    )}
                  </Detail>
                  <Detail term="Website">
                    {org.websiteUrl ? (
                      <a href={org.websiteUrl} rel="noreferrer nofollow noopener" target="_blank">
                        {org.websiteUrl}
                      </a>
                    ) : (
                      <span className="muted">not given</span>
                    )}
                  </Detail>
                  <Detail term="Support address (masked)">
                    <span className="mono">{maskEmail(org.supportEmail) ?? '—'}</span>
                  </Detail>
                  <Detail term="Connector">{org.connectorKind ?? <span className="muted">none declared</span>}</Detail>
                </div>

                {mayApprove ? (
                  <form action={decidePartner} className="stack stack-3">
                    <input type="hidden" name="organizationId" value={org.id} />
                    <div className="field">
                      <label className="label" htmlFor={`note-${org.id}`}>
                        Decision note
                      </label>
                      <textarea
                        id={`note-${org.id}`}
                        className="textarea"
                        name="note"
                        maxLength={500}
                        style={{ minHeight: 64 }}
                        placeholder="Optional when approving. Required when rejecting — it is what the applicant is told."
                      />
                    </div>
                    <div className="row-wrap" style={{ gap: 8 }}>
                      <button type="submit" name="action" value="APPROVE" className="btn btn-primary">
                        Approve
                      </button>
                      <button type="submit" name="action" value="REJECT" className="btn btn-danger">
                        Reject
                      </button>
                      <span className="tiny muted">Both need a recent sign-in.</span>
                    </div>
                  </form>
                ) : (
                  <p className="tiny muted">
                    Deciding an application needs <span className="mono">platform.partner:approve</span>,
                    which your platform role does not hold.
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <div className="stack stack-4">
          <CardHead title="Directory" />
          <form method="get" action={BASE} className="row-wrap" style={{ gap: 12 }}>
            <div className="field grow" style={{ minWidth: 240 }}>
              <label className="label" htmlFor="partner-search">
                Search
              </label>
              <input
                id="partner-search"
                className="input"
                type="search"
                name="q"
                defaultValue={q ?? ''}
                placeholder="Name, slug, legal name, registration number or id"
                maxLength={120}
              />
            </div>
            {status ? <input type="hidden" name="status" value={status} /> : null}
            <div className="row" style={{ gap: 8, alignSelf: 'flex-end', paddingBottom: 2 }}>
              <button type="submit" className="btn btn-primary">
                Search
              </button>
              {q ? (
                <Link className="btn" href={withParam(BASE, current, { q: null })}>
                  Clear
                </Link>
              ) : null}
            </div>
          </form>

          <FilterLinks
            label="Filter organizations by status"
            current={status}
            options={[
              { href: withParam(BASE, current, { status: null }), label: 'All', value: null },
              ...STATUSES.map((value) => ({
                href: withParam(BASE, current, { status: value }),
                label: value.replace(/_/g, ' ').toLowerCase(),
                value,
              })),
            ]}
          />

          <Summary
            items={[
              { label: 'Shown', value: `${directory.length}${directory.length === LIMIT ? ' (capped)' : ''}` },
              { label: 'Active', value: counts.active },
              { label: 'Suspended', value: counts.suspended },
              { label: 'Rejected', value: counts.rejected },
            ]}
          />
        </div>
      </Card>

      <Card>
        {directory.length === 0 ? (
          <Empty
            title={q || status ? 'Nothing matched' : 'No organizations'}
            body={
              q || status
                ? 'No organization on the platform matches those terms.'
                : 'Organizations appear here as businesses apply.'
            }
            action={
              q || status ? (
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
                  <th scope="col">Organization</th>
                  <th scope="col">Kind</th>
                  <th scope="col">Status</th>
                  <th scope="col">Applied</th>
                  <th scope="col">Reviewed</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {directory.map((org) => (
                  <tr key={org.id}>
                    <td>
                      <span style={{ fontWeight: 600 }}>{org.name}</span>
                      <div className="tiny muted mono">{org.slug}</div>
                      {org.legalName ? <div className="tiny muted">{org.legalName}</div> : null}
                    </td>
                    <td className="small muted">{org.kind.replace(/_/g, ' ').toLowerCase()}</td>
                    <td><StatusBadge status={org.status} /></td>
                    <td className="small">{formatDate(org.createdAt)}</td>
                    <td className="small">
                      {org.reviewedAt ? (
                        <>
                          {formatDate(org.reviewedAt)}
                          <div className="tiny muted">
                            by {org.reviewerName ?? 'a platform administrator'}
                          </div>
                          {org.reviewNote ? (
                            <div className="tiny muted" style={{ maxWidth: 280 }}>
                              “{org.reviewNote}”
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <span className="muted">never</span>
                      )}
                    </td>
                    <td>
                      {org.status === 'ACTIVE' && maySuspend ? (
                        <form action={decidePartner} className="stack stack-2" style={{ minWidth: 200 }}>
                          <input type="hidden" name="organizationId" value={org.id} />
                          <input type="hidden" name="action" value="SUSPEND" />
                          <label className="sr-only" htmlFor={`suspend-note-${org.id}`}>
                            Reason for suspending {org.name}
                          </label>
                          <input
                            id={`suspend-note-${org.id}`}
                            className="input"
                            name="note"
                            maxLength={500}
                            required
                            minLength={3}
                            placeholder="Reason"
                            style={{ minHeight: 34, fontSize: 13 }}
                          />
                          <button type="submit" className="btn btn-sm btn-danger">
                            Suspend
                          </button>
                        </form>
                      ) : org.status === 'PENDING_REVIEW' ? (
                        <span className="tiny muted">In the queue above</span>
                      ) : (
                        <span className="tiny muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Card>
    </div>
  );
}
