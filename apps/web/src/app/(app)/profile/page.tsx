/**
 * Profile: the account, who can see it, and what is signed in.
 *
 * The rule this screen is built around is the brief's: a control that does nothing
 * is worse than no control. So there is a button wherever the API has a route —
 * disconnecting a partner, revoking a scope, signing a device out, reissuing the
 * pass — and plain text everywhere it does not. The profile fields have no write
 * endpoint reachable from here (`/api/me/profile` is a PATCH, and nothing in this
 * app sends one), so they are shown and not offered for editing; notification
 * preferences have no write route at all, so they are read back exactly as stored.
 *
 * Consent is rendered under the partner it was granted to, because "connected to
 * Croma" and "Croma can read your name and mobile" are the same fact to the person
 * reading it, and splitting them across two lists is how a privacy screen becomes
 * something nobody checks.
 *
 * `profileSnapshot` copies the user row field by field rather than spreading it —
 * that row carries a password hash and a sealed MFA secret.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Badge,
  ButtonLink,
  Card,
  CardHead,
  DefinitionList,
  Empty,
  Notice,
  PageHead,
  Stack,
  Stat,
  StatusBadge,
  TableScroll,
  formatDate,
  formatDateTime,
  formatRelative,
} from '@/components/ui';
import { Glyph } from '@/components/icons';
import { PostAction } from '@/components/consumer/post-action';
import { currentActor, profileSnapshot } from '../_queries';

export const metadata: Metadata = {
  title: 'Profile',
  description: 'Your account, the partners you are connected to, and the devices signed in.',
};

export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  const actor = await currentActor();
  const snapshot = await profileSnapshot(actor.userId);

  const { account, profile, connections, consents, sessions, preferences, unreadNotifications } = snapshot;

  const activeConnections = connections.filter((c) => c.state === 'ACTIVE');
  const liveConsents = consents.filter((c) => c.state === 'GRANTED');

  // Grants are shown under the partner that holds them. A grant whose organization
  // has no connection row still has to appear somewhere, so it is collected below.
  const consentsByOrg = new Map<string, typeof consents>();
  for (const grant of consents) {
    const existing = consentsByOrg.get(grant.organizationId);
    if (existing) existing.push(grant);
    else consentsByOrg.set(grant.organizationId, [grant]);
  }
  const connectedOrgIds = new Set(connections.map((c) => c.organizationId));
  const orphanConsents = consents.filter((c) => !connectedOrgIds.has(c.organizationId));

  const currentSessionId = actor.session.sessionId;
  const otherSessions = sessions.filter((s) => s.id !== currentSessionId);

  return (
    <div className="wrap stack stack-6">
      <PageHead
        eyebrow="Your account"
        title={profile?.displayName ?? actor.displayName}
        lede={
          <span className="row-wrap">
            {account ? <StatusBadge status={account.status} /> : null}
            {account?.mfaEnabled ? <Badge tone="ok">Two-factor on</Badge> : <Badge tone="warn">No second factor</Badge>}
            {actor.isPlatformStaff ? <Badge tone="info">Platform staff</Badge> : null}
          </span>
        }
        actions={
          <ButtonLink href="/settings" size="sm">
            <Glyph name="settings" size={16} />
            Settings
          </ButtonLink>
        }
      />

      <section className="stat-row" aria-label="Account at a glance">
          <Stat
            label="Connected partners"
            value={activeConnections.length}
            hint={
              connections.length > activeConnections.length
                ? `${connections.length - activeConnections.length} disconnected, kept as history.`
                : 'Businesses that can recognise your pass.'
            }
          />
          <Stat
            label="Live consent scopes"
            value={liveConsents.length}
            hint={
              consents.length > liveConsents.length
                ? `${consents.length - liveConsents.length} revoked or expired, kept on the record.`
                : 'What partners may read about you.'
            }
          />
          <Stat
            label="Signed-in devices"
            value={sessions.length}
            hint={unreadNotifications > 0 ? `${unreadNotifications} unread notification${unreadNotifications === 1 ? '' : 's'}.` : 'Sessions that have not expired or been revoked.'}
          />
        </section>

        {/* ── the account ── */}
        <section className="stack stack-3" aria-labelledby="account-heading">
          <div className="section-head">
            <h2 id="account-heading">Account</h2>
          </div>
          <Card>
            <Stack gap={4}>
              <DefinitionList
                items={[
                  ['Display name', profile?.displayName ?? actor.displayName],
                  ...(profile?.givenName || profile?.familyName
                    ? ([['Name', [profile?.givenName, profile?.familyName].filter(Boolean).join(' ')]] as [
                        React.ReactNode,
                        React.ReactNode,
                      ][])
                    : []),
                  [
                    'Email',
                    account?.email ? (
                      <span key="e" className="row-wrap" style={{ justifyContent: 'flex-end' }}>
                        <span>{account.email}</span>
                        {account.emailVerified ? (
                          <Badge tone="ok">verified</Badge>
                        ) : (
                          <Badge tone="warn">unverified</Badge>
                        )}
                      </span>
                    ) : (
                      'Not on this account'
                    ),
                  ],
                  [
                    'Mobile',
                    account?.mobile ? (
                      <span key="m" className="row-wrap" style={{ justifyContent: 'flex-end' }}>
                        <span className="mono">{account.mobile}</span>
                        {account.mobileVerified ? (
                          <Badge tone="ok">verified</Badge>
                        ) : (
                          <Badge tone="warn">unverified</Badge>
                        )}
                      </span>
                    ) : (
                      'Not on this account'
                    ),
                  ],
                  [
                    'Where you are',
                    [profile?.city, profile?.region, profile?.countryCode].filter(Boolean).join(', ') || 'Not recorded',
                  ],
                  ['Language', profile?.locale ?? 'Not recorded'],
                  ...(profile?.birthYear
                    ? ([['Year of birth', String(profile.birthYear)]] as [React.ReactNode, React.ReactNode][])
                    : []),
                  ['Member since', account ? formatDate(account.createdAt) : '—'],
                  [
                    'Last sign-in',
                    account?.lastLoginAt
                      ? `${formatDateTime(account.lastLoginAt)} · ${formatRelative(account.lastLoginAt)}`
                      : 'Not recorded',
                  ],
                  ['Two-factor', account?.mfaEnabled ? 'On' : 'Off'],
                ]}
              />
              <p className="tiny muted">
                Your display name and city are editable in <Link href="/settings">Settings</Link>. The rest are shown
                as stored: your email address and mobile number each carry a verification state, so changing either is
                a verification flow rather than an edit, and there is no endpoint for it in this build.
              </p>
            </Stack>
          </Card>
        </section>

        {/* ── the pass ── */}
        <section>
          <CardHead title="Your pass" action={<Link className="small" href="/pass">Show it</Link>} />
          <Card>
            <Stack gap={4}>
              <p className="small muted">
                Reissuing replaces the secret behind your pass. Every code ever shown from the old one stops verifying
                immediately, and the pass reference changes — which is the answer to &ldquo;someone photographed my
                QR&rdquo;.
              </p>
              <PostAction
                path="/api/me/pass/rotate"
                body={{}}
                label="Reissue my pass"
                pendingLabel="Reissuing…"
                successMessage="Your pass has been reissued. Open it to show the new code."
                variant="danger"
                confirm="Reissue your pass? Every code shown from the old one stops working straight away."
              />
            </Stack>
          </Card>
        </section>

        {/* ── partners and what they can read ── */}
        <section>
          <CardHead
            title="Connected businesses"
            action={
              <Link className="small" href="/disclosures">
                What they have seen
              </Link>
            }
          />
          {/*
            This list answers "what can they read about me *now*", so it shows
            each scope as it is defined today — which is the right answer to that
            question and the wrong one to "what did I agree to". A definition is
            editable, so the words here can differ from the words that were on
            screen on the day. The receipt that froze those is one link away.
          */}
          <p className="small muted measure" style={{ marginTop: 8 }}>
            These are the permissions as they stand today. The wording you actually agreed to, on the
            day you agreed to it, is kept in your{' '}
            <Link href="/disclosures">consent history</Link>.
          </p>
          {connections.length > 0 ? (
            <ul className="stack stack-4">
              {connections.map((connection) => {
                const grants = consentsByOrg.get(connection.organizationId) ?? [];
                const live = grants.filter((g) => g.state === 'GRANTED');

                return (
                  <Card as="li" key={connection.id}>
                    <Stack gap={4}>
                      <div className="row-between" style={{ alignItems: 'flex-start' }}>
                        <div className="grow">
                          <h3 className="h3">{connection.organization?.name ?? 'Business'}</h3>
                          <p className="small muted" style={{ marginTop: 2 }}>
                            Connected {formatDate(connection.connectedAt)}
                            {connection.lastUsedAt ? ` · last used ${formatRelative(connection.lastUsedAt)}` : ' · not used yet'}
                          </p>
                          <p className="tiny mono muted" style={{ marginTop: 4 }}>
                            They know you as {connection.partnerRef}
                          </p>
                        </div>
                        <StatusBadge status={connection.state} />
                      </div>

                      <div>
                        <p className="eyebrow">What they may read</p>
                        {live.length > 0 ? (
                          <ul className="stack stack-3" style={{ marginTop: 8 }}>
                            {live.map((grant) => (
                              <li key={grant.id} className="card-flat">
                                <div className="row-between" style={{ alignItems: 'flex-start' }}>
                                  <div className="grow">
                                    <div className="row-wrap">
                                      <Badge tone={grant.version?.definition?.sensitive ? 'warn' : 'accent'}>
                                        {grant.version?.definition?.label ?? 'Scope'}
                                      </Badge>
                                      {grant.version?.definition?.sensitive ? (
                                        <span className="tiny muted">sensitive</span>
                                      ) : null}
                                    </div>
                                    {grant.version?.definition?.description ? (
                                      <p className="tiny muted" style={{ marginTop: 6 }}>
                                        {grant.version.definition.description}
                                      </p>
                                    ) : null}
                                    {grant.version?.definition?.fields?.length ? (
                                      <p className="tiny mono muted" style={{ marginTop: 4 }}>
                                        {grant.version.definition.fields.join(' · ')}
                                      </p>
                                    ) : null}
                                    <p className="tiny muted" style={{ marginTop: 6 }}>
                                      For {grant.purpose} · granted {formatDate(grant.grantedAt)}
                                      {grant.expiresAt ? ` · expires ${formatDate(grant.expiresAt)}` : ''}
                                    </p>
                                  </div>
                                  <PostAction
                                    path={`/api/me/consents/${grant.id}`}
                                    method="DELETE"
                                    label="Revoke"
                                    pendingLabel="Revoking…"
                                    successMessage="Revoked. This business can no longer read that."
                                    variant="ghost"
                                    size="sm"
                                    confirm={`Revoke "${grant.version?.definition?.label ?? 'this scope'}" from ${connection.organization?.name ?? 'this business'}?`}
                                  />
                                </div>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="small muted" style={{ marginTop: 6 }}>
                            {grants.length > 0
                              ? 'Every scope this business held has been revoked or has expired. The record of them is kept.'
                              : 'Nothing. This business can recognise your pass and no more.'}
                          </p>
                        )}
                      </div>

                      {connection.state === 'ACTIVE' ? (
                        <div>
                          <PostAction
                            path={`/api/me/connections/${connection.id}`}
                            method="DELETE"
                            label="Disconnect"
                            pendingLabel="Disconnecting…"
                            successMessage="Disconnected, and every scope they held was revoked with it."
                            variant="danger"
                            size="sm"
                            confirm={`Disconnect from ${connection.organization?.name ?? 'this business'}? Everything they were allowed to read is revoked at the same time.`}
                          />
                        </div>
                      ) : (
                        <p className="tiny muted">
                          Disconnected{connection.disconnectedAt ? ` ${formatDate(connection.disconnectedAt)}` : ''}. The
                          record is kept rather than deleted.
                        </p>
                      )}
                    </Stack>
                  </Card>
                );
              })}
            </ul>
          ) : (
            <Card>
              <Empty
                title="No businesses connected"
                body="A connection is created the first time you use your pass at a partner. Until then, nobody holds a handle for you."
                action={
                  <ButtonLink href="/explore" variant="primary">
                    Explore partners
                  </ButtonLink>
                }
              />
            </Card>
          )}
        </section>

        {/* ── grants with no connection row ── */}
        {orphanConsents.length > 0 ? (
          <section className="stack stack-3" aria-labelledby="other-consent-on-the-record-heading">
            <div className="section-head">
              <h2 id="other-consent-on-the-record-heading">Other consent on the record</h2>
            </div>
            <Card>
              <Stack gap={3}>
                <p className="small muted">
                  These grants are not attached to a live connection — they were made to a business you have never
                  connected to, or one whose connection row has gone.
                </p>
                <ul className="checklist">
                  {orphanConsents.map((grant) => (
                    <li key={grant.id} className="checkline">
                      <span className="grow row-between">
                        <span>
                          <strong className="small">{grant.organization?.name ?? 'Business'}</strong>
                          <span className="tiny muted" style={{ display: 'block' }}>
                            {grant.version?.definition?.label ?? 'Scope'} · {grant.purpose}
                          </span>
                        </span>
                        <StatusBadge status={grant.state} />
                      </span>
                    </li>
                  ))}
                </ul>
              </Stack>
            </Card>
          </section>
        ) : null}

        {/* ── devices ── */}
        <section className="stack stack-3" aria-labelledby="signed-in-heading">
          <div className="section-head">
            <h2 id="signed-in-heading">Signed in</h2>
          </div>
          {sessions.length > 0 ? (
            <Card>
              <Stack gap={4}>
                <TableScroll>
                  <table className="table">
                    <caption className="sr-only">Sessions on this account, most recently active first</caption>
                    <thead>
                      <tr>
                        <th scope="col">Device</th>
                        <th scope="col">Last active</th>
                        <th scope="col">Expires</th>
                        <th scope="col">
                          <span className="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {sessions.map((session) => {
                        const isCurrent = session.id === currentSessionId;
                        return (
                          <tr key={session.id}>
                            <td>
                              <span className="row-wrap">
                                <strong>{session.device?.label ?? 'Unnamed device'}</strong>
                                {isCurrent ? <Badge tone="accent">this device</Badge> : null}
                                {session.device?.trusted ? <Badge tone="ok">trusted</Badge> : null}
                              </span>
                              <span className="tiny muted" style={{ display: 'block' }}>
                                {session.device?.platform ?? 'Platform not recorded'}
                                {session.userAgent ? ` · ${session.userAgent.slice(0, 60)}` : ''}
                              </span>
                            </td>
                            <td>
                              {formatDateTime(session.lastActiveAt)}
                              <span className="tiny muted" style={{ display: 'block' }}>
                                {formatRelative(session.lastActiveAt)}
                              </span>
                            </td>
                            <td>{formatDateTime(session.expiresAt)}</td>
                            <td>
                              <PostAction
                                path={`/api/me/sessions/${session.id}`}
                                method="DELETE"
                                label={isCurrent ? 'Sign out here' : 'Sign out'}
                                pendingLabel="Signing out…"
                                successMessage={
                                  isCurrent
                                    ? 'Signed out on this device.'
                                    : 'That device has been signed out.'
                                }
                                variant="ghost"
                                size="sm"
                                {...(isCurrent
                                  ? {
                                      confirm:
                                        'Sign out on this device? You will need to sign in again.',
                                      // Only the current device's sign-out sweeps
                                      // local storage: ending a session on another
                                      // phone cannot and must not clear this one.
                                      clearsDevice: true,
                                    }
                                  : {})}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </TableScroll>

                {otherSessions.length > 0 ? (
                  <div>
                    <PostAction
                      path="/api/me/sessions/revoke-all"
                      body={{ reason: 'signed out from the profile screen' }}
                      label={`Sign out the other ${otherSessions.length} device${otherSessions.length === 1 ? '' : 's'}`}
                      pendingLabel="Signing out…"
                      successMessage="Every other device has been signed out. This one stays signed in."
                      variant="danger"
                      size="sm"
                      confirm="Sign out every other device? This one stays signed in."
                    />
                  </div>
                ) : (
                  <p className="tiny muted">This is the only device signed in.</p>
                )}
              </Stack>
            </Card>
          ) : (
            <Card>
              <Empty title="No live sessions" body="Nothing is signed in — which is odd, given you are reading this." />
            </Card>
          )}
        </section>

        {/* ── notifications ── */}
        <section className="stack stack-3" aria-labelledby="notification-preferences-heading">
          <div className="section-head">
            <h2 id="notification-preferences-heading">Notification preferences</h2>
          </div>
          <Card>
            <Stack gap={4}>
              {preferences.length > 0 ? (
                <>
                  <TableScroll>
                    <table className="table">
                      <caption className="sr-only">Notification preferences as stored</caption>
                      <thead>
                        <tr>
                          <th scope="col">About</th>
                          <th scope="col">Channel</th>
                          <th scope="col">State</th>
                          <th scope="col">Changed</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preferences.map((preference) => (
                          <tr key={preference.id}>
                            <td>{preference.category.replace(/_/g, ' ').toLowerCase()}</td>
                            <td>{preference.channel.replace(/_/g, ' ').toLowerCase()}</td>
                            <td>
                              {preference.enabled ? <Badge tone="ok">on</Badge> : <Badge tone="neutral">off</Badge>}
                            </td>
                            <td className="tiny muted">{formatDate(preference.updatedAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </TableScroll>
                  <p className="tiny muted">
                    Shown as stored. <Link href="/settings">Settings</Link> is where these are changed. Security
                    notices are never switched off, and the endpoint refuses to do it.
                  </p>
                </>
              ) : (
                <Empty
                  title="No preferences stored"
                  body="Preference rows are written when an account is registered. This account has none, so notifications follow the platform defaults."
                />
              )}
            </Stack>
          </Card>
        </section>

      <Notice tone="info">
        <span>
          Signing out, disconnecting a business and revoking a scope all take effect immediately and are written to
          the security record. Asking for a copy of your data and closing your account are in{' '}
          <Link href="/settings">Settings</Link>, which also says exactly how far each of them goes.
        </span>
      </Notice>
    </div>
  );
}
