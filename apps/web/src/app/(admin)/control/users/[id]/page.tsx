/**
 * One person, seen from the platform side.
 *
 * ── What is deliberately not on this page ─────────────────────
 * `users.passwordHash`, `users.mfaSecretCipher`, `users.sessionGeneration`,
 * `sessions.tokenHash`, `sessions.ipHash`, `passes.secretCipher`,
 * `passes.passRef` and `devices.handle` are never selected. Not hidden with CSS,
 * not fetched and dropped in the component — never named in a query. An admin
 * screen has no use for any of them, and the only defence that survives someone
 * adding a column is building the view field by field.
 *
 * Contact details are masked, as everywhere in this console. What an
 * administrator actually needs is whether a factor is *verified*, which is a
 * boolean, and it is given plainly.
 *
 * The security section is behind `platform.security:read` rather than the page's
 * own permission: platform support can look up an account to answer a ticket
 * without being handed that account's security history.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, count, desc, eq, gt, isNull } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  consentDefinitions,
  consentGrants,
  consentVersions,
  devices,
  organizationMembers,
  organizations,
  partnerConnections,
  passes,
  securityEvents,
  sessions,
  userProfiles,
  users,
} from '@/db/schema';
import {
  Badge,
  Card,
  CardHead,
  DefinitionList,
  Empty,
  Notice,
  StatusBadge,
  TableScroll,
  formatDate,
  formatDateTime,
  formatRelative,
} from '@/components/ui';
import { PageHeader, Summary } from '@/components/partner/shell';
import { requirePlatform } from '@/components/admin/guard';
import { ActionOutcome, MetadataTable, Withheld, YesNo } from '@/components/admin/parts';
import { firstParam, maskEmail, maskMobile } from '@/components/admin/redact';
import { isUlid } from '@/lib/ids';
import { setUserStatus } from './actions';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = { title: 'User' };
export const dynamic = 'force-dynamic';

export default async function ControlUserPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const ctx = await requirePlatform('platform.user:read', '/control/users');

  // A malformed id is "not found" rather than "invalid", so the page never
  // becomes a cheap way to test which id shapes exist.
  if (!isUlid(id)) notFound();

  const [row] = await db
    .select({
      id: users.id,
      status: users.status,
      email: users.email,
      mobile: users.mobile,
      emailVerifiedAt: users.emailVerifiedAt,
      mobileVerifiedAt: users.mobileVerifiedAt,
      isPlatformStaff: users.isPlatformStaff,
      mfaEnabled: users.mfaEnabled,
      failedLogins: users.failedLogins,
      lockedUntil: users.lockedUntil,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
      deletedAt: users.deletedAt,
      displayName: userProfiles.displayName,
      city: userProfiles.city,
      region: userProfiles.region,
      countryCode: userProfiles.countryCode,
      locale: userProfiles.locale,
    })
    .from(users)
    .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
    .where(eq(users.id, id))
    .limit(1);

  if (!row) notFound();

  const user = {
    id: row.id,
    status: row.status,
    displayName: row.displayName ?? BRAND.fallbackPersonName,
    email: maskEmail(row.email),
    mobile: maskMobile(row.mobile),
    emailVerified: row.emailVerifiedAt !== null,
    mobileVerified: row.mobileVerifiedAt !== null,
    isPlatformStaff: row.isPlatformStaff,
    mfaEnabled: row.mfaEnabled,
    failedLogins: row.failedLogins,
    lockedUntil: row.lockedUntil,
    lastLoginAt: row.lastLoginAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
    place: [row.city, row.region, row.countryCode].filter(Boolean).join(', ') || null,
    locale: row.locale,
  };

  const now = new Date();

  const sessionRows = await db
    .select({
      id: sessions.id,
      createdAt: sessions.createdAt,
      lastActiveAt: sessions.lastActiveAt,
      expiresAt: sessions.expiresAt,
      revokedAt: sessions.revokedAt,
      revokedReason: sessions.revokedReason,
      elevatedAt: sessions.elevatedAt,
      userAgent: sessions.userAgent,
      deviceLabel: devices.label,
      devicePlatform: devices.platform,
    })
    .from(sessions)
    .leftJoin(devices, eq(devices.id, sessions.deviceId))
    .where(eq(sessions.userId, id))
    .orderBy(desc(sessions.createdAt))
    .limit(25);

  // Counted in the database rather than by filtering the 25 rows above, so the
  // figure is the whole truth even when the table below is only a window on it.
  const [liveSessionCount] = await db
    .select({ total: count() })
    .from(sessions)
    .where(and(eq(sessions.userId, id), isNull(sessions.revokedAt), gt(sessions.expiresAt, now)));
  const liveSessions = liveSessionCount?.total ?? 0;

  const deviceRows = await db
    .select({
      id: devices.id,
      label: devices.label,
      platform: devices.platform,
      trusted: devices.trusted,
      lastSeenAt: devices.lastSeenAt,
      revokedAt: devices.revokedAt,
      createdAt: devices.createdAt,
    })
    .from(devices)
    .where(eq(devices.userId, id))
    .orderBy(desc(devices.lastSeenAt))
    .limit(25);

  const connectionRows = await db
    .select({
      id: partnerConnections.id,
      state: partnerConnections.state,
      partnerRef: partnerConnections.partnerRef,
      connectedAt: partnerConnections.connectedAt,
      disconnectedAt: partnerConnections.disconnectedAt,
      lastUsedAt: partnerConnections.lastUsedAt,
      organizationId: organizations.id,
      organizationName: organizations.name,
      organizationStatus: organizations.status,
    })
    .from(partnerConnections)
    .innerJoin(organizations, eq(organizations.id, partnerConnections.organizationId))
    .where(eq(partnerConnections.userId, id))
    .orderBy(desc(partnerConnections.connectedAt))
    .limit(50);

  const consentRows = await db
    .select({
      id: consentGrants.id,
      state: consentGrants.state,
      purpose: consentGrants.purpose,
      grantedAt: consentGrants.grantedAt,
      expiresAt: consentGrants.expiresAt,
      revokedAt: consentGrants.revokedAt,
      scopeKey: consentDefinitions.key,
      scopeLabel: consentDefinitions.label,
      sensitive: consentDefinitions.sensitive,
      version: consentVersions.version,
      organizationName: organizations.name,
    })
    .from(consentGrants)
    .innerJoin(consentVersions, eq(consentVersions.id, consentGrants.consentVersionId))
    .innerJoin(consentDefinitions, eq(consentDefinitions.id, consentVersions.definitionId))
    .innerJoin(organizations, eq(organizations.id, consentGrants.organizationId))
    .where(eq(consentGrants.userId, id))
    .orderBy(desc(consentGrants.grantedAt))
    .limit(50);

  const memberships = await db
    .select({
      membershipId: organizationMembers.id,
      status: organizationMembers.status,
      joinedAt: organizationMembers.joinedAt,
      organizationId: organizations.id,
      organizationName: organizations.name,
      organizationStatus: organizations.status,
    })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(eq(organizationMembers.userId, id))
    .limit(50);

  // Status and issue date only. The TOTP secret is sealed with the platform key
  // and is not readable from any console, which is the point of sealing it.
  const passRows = await db
    .select({
      id: passes.id,
      status: passes.status,
      issuedAt: passes.issuedAt,
      revokedAt: passes.revokedAt,
    })
    .from(passes)
    .where(eq(passes.userId, id))
    .orderBy(desc(passes.issuedAt))
    .limit(5);

  const mayReadSecurity = ctx.permissions.has('platform.security:read');
  const securityRows = mayReadSecurity
    ? await db
        .select({
          id: securityEvents.id,
          kind: securityEvents.kind,
          severity: securityEvents.severity,
          summary: securityEvents.summary,
          metadata: securityEvents.metadata,
          acknowledgedAt: securityEvents.acknowledgedAt,
          createdAt: securityEvents.createdAt,
        })
        .from(securityEvents)
        .where(eq(securityEvents.userId, id))
        .orderBy(desc(securityEvents.id))
        .limit(20)
    : null;

  const maySuspend = ctx.permissions.has('platform.user:suspend');
  const suspended = user.status === 'SUSPENDED';
  const isSelf = ctx.actor.userId === user.id;
  const locked = user.lockedUntil !== null && user.lockedUntil.getTime() > now.getTime();

  return (
    <div className="stack stack-5">
      <PageHeader
        eyebrow="Platform · Users"
        title={user.displayName}
        lede="Everything on this page is read field by field. Password hashes, session tokens, MFA secrets and pass secrets are not selected by any query behind it."
        actions={
          <span className="row-wrap" style={{ gap: 8 }}>
            <StatusBadge status={user.status} />
            {user.isPlatformStaff ? <Badge tone="accent">platform staff</Badge> : null}
            {locked ? <Badge tone="warn">locked</Badge> : null}
            <Link className="btn btn-sm" href="/control/users">
              Back to directory
            </Link>
          </span>
        }
      />

      <ActionOutcome error={firstParam(query.error)} done={firstParam(query.done)} />

      <div className="split split-lead">
        <Card>
          <CardHead title="Identity" />
          <DefinitionList
            items={[
              ['User id', <span key="id" className="mono break-all">{user.id}</span>],
              [
                'Email',
                <span key="email" className="row-wrap" style={{ gap: 6, justifyContent: 'flex-end' }}>
                  <span className="mono">{user.email ?? 'none on file'}</span>
                  <YesNo value={user.emailVerified} yes="verified" no="unverified" noTone="warn" />
                </span>,
              ],
              [
                'Mobile',
                <span key="mobile" className="row-wrap" style={{ gap: 6, justifyContent: 'flex-end' }}>
                  <span className="mono">{user.mobile ?? 'none on file'}</span>
                  <YesNo value={user.mobileVerified} yes="verified" no="unverified" noTone="warn" />
                </span>,
              ],
              ['Second factor', <YesNo key="mfa" value={user.mfaEnabled} yes="enabled" no="not enabled" noTone="warn" />],
              ['Failed sign-ins', <span key="fails" className="mono">{user.failedLogins}</span>],
              ['Locked until', user.lockedUntil ? formatDateTime(user.lockedUntil) : 'Not locked'],
              ['Last signed in', user.lastLoginAt ? formatDateTime(user.lastLoginAt) : 'Never'],
              ['Joined', formatDate(user.createdAt)],
              ['Last changed', formatRelative(user.updatedAt)],
              ['Place', user.place ?? 'Not given'],
              ['Locale', <span key="locale" className="mono">{user.locale ?? 'en-IN'}</span>],
              ['Closed', user.deletedAt ? formatDateTime(user.deletedAt) : 'No'],
            ]}
          />
        </Card>

        <Card>
          <CardHead title={suspended ? 'Restore this account' : 'Suspend this account'} />
          {!maySuspend ? (
            <p className="small muted">
              Changing an account&rsquo;s status needs <span className="mono">platform.user:suspend</span>,
              which your platform role does not hold. This page is read-only for you.
            </p>
          ) : isSelf ? (
            <Notice tone="info">
              <p>
                This is your own account. Suspending yourself would lock the platform team out one
                seat at a time, so the API refuses it — and so does this form.
              </p>
            </Notice>
          ) : (
            <form action={setUserStatus} className="stack stack-3">
              <input type="hidden" name="userId" value={user.id} />
              <input type="hidden" name="action" value={suspended ? 'RESTORE' : 'SUSPEND'} />
              <div className="field">
                <label className="label" htmlFor="reason">
                  Reason
                </label>
                <textarea
                  id="reason"
                  className="textarea"
                  name="reason"
                  minLength={3}
                  maxLength={240}
                  required
                  placeholder={
                    suspended
                      ? 'Why this account is being restored'
                      : 'Why this account is being suspended'
                  }
                />
                <p className="hint">
                  Written to the audit trail and sent to the person in the notification, so write it
                  for them to read.
                </p>
              </div>
              <button type="submit" className={`btn ${suspended ? 'btn-primary' : 'btn-danger'}`}>
                {suspended ? 'Restore access' : 'Suspend account'}
              </button>
              <p className="tiny muted">
                {suspended
                  ? 'Restoring returns the account to ACTIVE only if a factor was ever verified; otherwise it goes back to waiting for one.'
                  : 'Suspending revokes every session immediately and moves the session generation, so nothing can be replayed if the account is later restored.'}{' '}
                This action needs a recent sign-in.
              </p>
            </form>
          )}
        </Card>
      </div>

      <Card>
        <CardHead
          title="Sessions"
          action={
            <span className="small muted">
              {liveSessions} live · {sessionRows.length} most recent shown
            </span>
          }
        />
        {sessionRows.length === 0 ? (
          <Empty title="No sessions" body="This account has never signed in on any device." />
        ) : (
          <>
            <TableScroll>
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Session</th>
                    <th scope="col">Device</th>
                    <th scope="col">Browser</th>
                    <th scope="col">Started</th>
                    <th scope="col">Last active</th>
                    <th scope="col">State</th>
                  </tr>
                </thead>
                <tbody>
                  {sessionRows.map((session) => {
                    const live = session.revokedAt === null && session.expiresAt.getTime() > now.getTime();
                    return (
                      <tr key={session.id}>
                        <td className="tiny mono break-all">{session.id}</td>
                        <td className="small">
                          {session.deviceLabel ?? <span className="muted">unnamed</span>}
                          {session.devicePlatform ? (
                            <span className="muted"> · {session.devicePlatform}</span>
                          ) : null}
                        </td>
                        <td className="tiny muted truncate" style={{ maxWidth: 220 }}>
                          {session.userAgent ?? 'not recorded'}
                        </td>
                        <td className="small">{formatDateTime(session.createdAt)}</td>
                        <td className="small">{formatRelative(session.lastActiveAt)}</td>
                        <td>
                          <span className="row-wrap" style={{ gap: 6 }}>
                            {live ? (
                              <Badge tone="ok" dot>live</Badge>
                            ) : session.revokedAt ? (
                              <Badge tone="bad" dot>revoked</Badge>
                            ) : (
                              <Badge tone="neutral" dot>expired</Badge>
                            )}
                            {session.revokedReason ? (
                              <span className="tiny muted">{session.revokedReason}</span>
                            ) : null}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableScroll>
            <p className="tiny muted" style={{ marginTop: 10 }}>
              The session token is stored only as a SHA-256 hash and the client IP only as a peppered
              hash. Neither column is selected by this page, so neither can appear on it.
            </p>
          </>
        )}
      </Card>

      <div className="grid grid-2">
        <Card>
          <CardHead title="Devices" />
          {deviceRows.length === 0 ? (
            <Empty title="No devices" body="No device has ever registered a handle for this account." />
          ) : (
            <TableScroll>
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Device</th>
                    <th scope="col">Platform</th>
                    <th scope="col">Last seen</th>
                    <th scope="col">State</th>
                  </tr>
                </thead>
                <tbody>
                  {deviceRows.map((device) => (
                    <tr key={device.id}>
                      <td className="small">{device.label ?? <span className="muted">unnamed</span>}</td>
                      <td className="small muted">{device.platform ?? '—'}</td>
                      <td className="small">{formatRelative(device.lastSeenAt)}</td>
                      <td>
                        <span className="row-wrap" style={{ gap: 6 }}>
                          {device.revokedAt ? (
                            <Badge tone="bad" dot>revoked</Badge>
                          ) : (
                            <Badge tone="ok" dot>active</Badge>
                          )}
                          {device.trusted ? <Badge tone="info">trusted</Badge> : null}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          )}
        </Card>

        <Card>
          <CardHead title="Pass" />
          {passRows.length === 0 ? (
            <Empty title="No pass issued" body={`This account has never been issued a ${BRAND.name}.`} />
          ) : (
            <>
              <TableScroll>
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Status</th>
                      <th scope="col">Issued</th>
                      <th scope="col">Revoked</th>
                    </tr>
                  </thead>
                  <tbody>
                    {passRows.map((pass) => (
                      <tr key={pass.id}>
                        <td><StatusBadge status={pass.status} /></td>
                        <td className="small">{formatDate(pass.issuedAt)}</td>
                        <td className="small">{pass.revokedAt ? formatDate(pass.revokedAt) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
              <p className="tiny muted" style={{ marginTop: 10 }}>
                The pass reference and the sealed TOTP secret are not selected here. The secret is
                encrypted with a key held in the environment and is not readable from any console.
              </p>
            </>
          )}
        </Card>
      </div>

      <Card>
        <CardHead
          title="Connected businesses"
          action={<span className="small muted">{connectionRows.length} connections</span>}
        />
        {connectionRows.length === 0 ? (
          <Empty title="No connections" body={`This person has not connected their ${BRAND.name} to any business.`} />
        ) : (
          <TableScroll>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Business</th>
                  <th scope="col">Partner reference</th>
                  <th scope="col">State</th>
                  <th scope="col">Connected</th>
                  <th scope="col">Last used</th>
                </tr>
              </thead>
              <tbody>
                {connectionRows.map((connection) => (
                  <tr key={connection.id}>
                    <td>
                      <Link href={`/control/partners?q=${encodeURIComponent(connection.organizationName)}`}>
                        {connection.organizationName}
                      </Link>{' '}
                      <StatusBadge status={connection.organizationStatus} />
                    </td>
                    <td className="tiny mono">{connection.partnerRef}</td>
                    <td><StatusBadge status={connection.state} /></td>
                    <td className="small">{formatDate(connection.connectedAt)}</td>
                    <td className="small">
                      {connection.lastUsedAt ? formatRelative(connection.lastUsedAt) : <span className="muted">never</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Card>

      <Card>
        <CardHead
          title="Consents"
          action={
            <span className="small muted">
              {consentRows.filter((grant) => grant.state === 'GRANTED').length} live of {consentRows.length}
            </span>
          }
        />
        {consentRows.length === 0 ? (
          <Empty title="No consents" body="This person has not granted any scope to any business." />
        ) : (
          <TableScroll>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Scope</th>
                  <th scope="col">Business</th>
                  <th scope="col">Purpose</th>
                  <th scope="col">State</th>
                  <th scope="col">Granted</th>
                  <th scope="col">Ends</th>
                </tr>
              </thead>
              <tbody>
                {consentRows.map((grant) => (
                  <tr key={grant.id}>
                    <td>
                      <span className="mono small">{grant.scopeKey}</span>
                      {grant.sensitive ? <> <Badge tone="warn">sensitive</Badge></> : null}
                      <div className="tiny muted">
                        {grant.scopeLabel} · v{grant.version}
                      </div>
                    </td>
                    <td className="small">{grant.organizationName}</td>
                    <td className="tiny muted" style={{ maxWidth: 260 }}>{grant.purpose}</td>
                    <td><StatusBadge status={grant.state} /></td>
                    <td className="small">{formatDate(grant.grantedAt)}</td>
                    <td className="small">
                      {grant.revokedAt
                        ? `revoked ${formatDate(grant.revokedAt)}`
                        : grant.expiresAt
                          ? formatDate(grant.expiresAt)
                          : 'no end date'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Card>

      <Card>
        <CardHead title="Memberships" />
        {memberships.length === 0 ? (
          <Empty
            title="Not a member of any organization"
            body="This account holds no partner membership, so it holds no partner permission anywhere."
          />
        ) : (
          <TableScroll>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Organization</th>
                  <th scope="col">Organization status</th>
                  <th scope="col">Membership</th>
                  <th scope="col">Joined</th>
                </tr>
              </thead>
              <tbody>
                {memberships.map((membership) => (
                  <tr key={membership.membershipId}>
                    <td className="small">{membership.organizationName}</td>
                    <td><StatusBadge status={membership.organizationStatus} /></td>
                    <td><StatusBadge status={membership.status} /></td>
                    <td className="small">
                      {membership.joinedAt ? formatDate(membership.joinedAt) : <span className="muted">invited</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Card>

      {securityRows === null ? (
        <Withheld what="This account's security history" permission="platform.security:read" />
      ) : (
        <Card>
          <CardHead
            title="Security events"
            action={<span className="small muted">{securityRows.length} most recent</span>}
          />
          {securityRows.length === 0 ? (
            <Empty
              title="Nothing recorded"
              body="No security event has ever named this account."
            />
          ) : (
            <div className="stack stack-3">
              {securityRows.map((event) => (
                <div key={event.id} className="card-flat stack stack-3">
                  <div className="row-between">
                    <div>
                      <p className="row-wrap" style={{ gap: 8 }}>
                        <Badge
                          tone={
                            event.severity === 'CRITICAL' || event.severity === 'HIGH'
                              ? 'bad'
                              : event.severity === 'MEDIUM'
                                ? 'warn'
                                : 'neutral'
                          }
                          dot
                        >
                          {event.severity.toLowerCase()}
                        </Badge>
                        <span className="mono small">{event.kind}</span>
                      </p>
                      <p className="small" style={{ marginTop: 4 }}>{event.summary}</p>
                    </div>
                    <span className="tiny muted">{formatDateTime(event.createdAt)}</span>
                  </div>
                  <MetadataTable metadata={event.metadata} />
                  <p className="tiny muted">
                    {event.acknowledgedAt
                      ? `Acknowledged ${formatRelative(event.acknowledgedAt)}.`
                      : 'Not yet acknowledged.'}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      <Summary
        items={[
          { label: 'Live sessions', value: liveSessions },
          { label: 'Devices', value: deviceRows.length },
          { label: 'Connections', value: connectionRows.length },
          { label: 'Consents', value: consentRows.length },
          { label: 'Memberships', value: memberships.length },
          { label: 'Security events', value: securityRows === null ? 'withheld' : securityRows.length },
        ]}
      />
    </div>
  );
}
