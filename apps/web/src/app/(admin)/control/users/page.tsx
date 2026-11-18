/**
 * The platform user directory.
 *
 * The query is the one from `GET /api/admin/users` — same status filter, same
 * escaped ILIKE term, same "an exact id is the common case from a support ticket"
 * shortcut, same ULID cursor ordering. It is the same search because it answers
 * the same question, and two implementations of a privacy-sensitive search is one
 * more than can be kept in agreement.
 *
 * ── Privacy by default ────────────────────────────────────────
 * Contact details are rendered masked and there is no parameter that unmasks
 * them. Searching *by* an address still works, because support is handed the
 * value by the person on the phone and confirming a value you already hold is a
 * different act from being given the directory.
 *
 * Every column below is named in the select. `passwordHash`, `sessionGeneration`
 * and `mfaSecretCipher` live on this table too, and the only defence that
 * survives a schema change is refusing to select the row.
 *
 * The filter state is in the URL, so a support conversation can be handed a link.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { and, desc, eq, ilike, or, type SQL } from 'drizzle-orm';
import { db } from '@/db/client';
import { userProfiles, users } from '@/db/schema';
import {
  Badge,
  Card,
  Empty,
  StatusBadge,
  TableScroll,
  formatDate,
  formatRelative,
} from '@/components/ui';
import { PageHeader, Summary } from '@/components/partner/shell';
import { requirePlatform } from '@/components/admin/guard';
import { YesNo } from '@/components/admin/parts';
import { firstParam, likeTerm, maskEmail, maskMobile, oneOf } from '@/components/admin/redact';
import { isUlid } from '@/lib/ids';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = { title: 'Users' };
export const dynamic = 'force-dynamic';

const STATUSES = [
  'PENDING_VERIFICATION',
  'ACTIVE',
  'SUSPENDED',
  'DEACTIVATED',
  'DELETION_PENDING',
] as const;

/** A page is a page. The console reads a screenful, not the table. */
const LIMIT = 50;

export default async function ControlUsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePlatform('platform.user:read', '/control/users');
  const query = await searchParams;

  const q = firstParam(query.q)?.slice(0, 120) ?? null;
  const status = oneOf(query.status, STATUSES);

  const where: (SQL | undefined)[] = [];
  if (status) where.push(eq(users.status, status));
  if (q) {
    const term = likeTerm(q);
    where.push(
      or(
        // An exact id is the common case from a support ticket or an audit row.
        isUlid(q) ? eq(users.id, q) : undefined,
        ilike(users.email, term),
        ilike(users.mobile, term),
        ilike(userProfiles.displayName, term),
      ),
    );
  }

  const rows = await db
    .select({
      id: users.id,
      status: users.status,
      email: users.email,
      mobile: users.mobile,
      emailVerifiedAt: users.emailVerifiedAt,
      mobileVerifiedAt: users.mobileVerifiedAt,
      isPlatformStaff: users.isPlatformStaff,
      mfaEnabled: users.mfaEnabled,
      lockedUntil: users.lockedUntil,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
      displayName: userProfiles.displayName,
    })
    .from(users)
    .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
    .where(where.length ? and(...where) : undefined)
    // Ids are ULIDs, so newest-first is `id desc`.
    .orderBy(desc(users.id))
    .limit(LIMIT);

  const now = Date.now();
  const list = rows.map((row) => ({
    id: row.id,
    status: row.status,
    displayName: row.displayName ?? BRAND.fallbackPersonName,
    email: maskEmail(row.email),
    mobile: maskMobile(row.mobile),
    emailVerified: row.emailVerifiedAt !== null,
    mobileVerified: row.mobileVerifiedAt !== null,
    mfaEnabled: row.mfaEnabled,
    isPlatformStaff: row.isPlatformStaff,
    locked: row.lockedUntil !== null && row.lockedUntil.getTime() > now,
    lastLoginAt: row.lastLoginAt,
    createdAt: row.createdAt,
  }));

  const verified = list.filter((row) => row.emailVerified || row.mobileVerified).length;
  const staff = list.filter((row) => row.isPlatformStaff).length;

  return (
    <div className="stack stack-5">
      <PageHeader
        eyebrow="Platform"
        title="Users"
        lede="Search by name, email address, mobile number or user id. Contact details are shown masked here and on every other screen in this console — an address you were given can be confirmed, but the directory cannot be read out of it."
      />

      <Card>
        <div className="stack stack-4">
          <form method="get" action="/control/users" className="row-wrap" style={{ gap: 12 }}>
            <div className="field grow" style={{ minWidth: 240 }}>
              <label className="label" htmlFor="user-search">
                Search
              </label>
              <input
                id="user-search"
                className="input"
                type="search"
                name="q"
                defaultValue={q ?? ''}
                placeholder="Name, email, mobile or user id"
                maxLength={120}
              />
            </div>
            <div className="field" style={{ minWidth: 200 }}>
              <label className="label" htmlFor="user-status">
                Status
              </label>
              <select id="user-status" className="select" name="status" defaultValue={status ?? ''}>
                <option value="">Any status</option>
                {STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {value.replace(/_/g, ' ').toLowerCase()}
                  </option>
                ))}
              </select>
            </div>
            <div className="row" style={{ gap: 8, alignSelf: 'flex-end', paddingBottom: 2 }}>
              <button type="submit" className="btn btn-primary">
                Search
              </button>
              {q || status ? (
                <Link className="btn" href="/control/users">
                  Clear
                </Link>
              ) : null}
            </div>
          </form>

          <Summary
            items={[
              { label: 'Shown', value: `${list.length}${list.length === LIMIT ? ' (capped)' : ''}` },
              { label: 'A factor verified', value: `${verified}/${list.length}` },
              { label: 'Platform staff', value: staff },
            ]}
          />
        </div>
      </Card>

      <Card>
        {list.length === 0 ? (
          <Empty
            title={q || status ? 'Nothing matched that search' : 'No users yet'}
            body={
              q || status
                ? 'No account on the platform matches those terms. A search by address matches only an exact address.'
                : 'Accounts appear here as people register.'
            }
            action={
              q || status ? (
                <Link className="btn btn-sm" href="/control/users">
                  Clear the search
                </Link>
              ) : null
            }
          />
        ) : (
          <TableScroll>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Person</th>
                  <th scope="col">Status</th>
                  <th scope="col">Verified</th>
                  <th scope="col">Contact (masked)</th>
                  <th scope="col">Last signed in</th>
                  <th scope="col">Joined</th>
                </tr>
              </thead>
              <tbody>
                {list.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Link href={`/control/users/${row.id}`} style={{ fontWeight: 600 }}>
                        {row.displayName}
                      </Link>
                      <div className="tiny muted mono">{row.id}</div>
                    </td>
                    <td>
                      <span className="row-wrap" style={{ gap: 6 }}>
                        <StatusBadge status={row.status} />
                        {row.locked ? <Badge tone="warn">locked</Badge> : null}
                        {row.isPlatformStaff ? <Badge tone="accent">staff</Badge> : null}
                      </span>
                    </td>
                    <td>
                      <span className="row-wrap" style={{ gap: 6 }}>
                        <YesNo value={row.emailVerified} yes="email" no="email unverified" noTone="warn" />
                        <YesNo value={row.mobileVerified} yes="mobile" no="mobile unverified" noTone="warn" />
                        {row.mfaEnabled ? <Badge tone="ok">mfa</Badge> : null}
                      </span>
                    </td>
                    <td className="small mono">
                      <div>{row.email ?? <span className="muted">no email</span>}</div>
                      <div className="muted">{row.mobile ?? 'no mobile'}</div>
                    </td>
                    <td className="small">
                      {row.lastLoginAt ? formatRelative(row.lastLoginAt) : <span className="muted">never</span>}
                    </td>
                    <td className="small">{formatDate(row.createdAt)}</td>
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
