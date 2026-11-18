/**
 * Settings — who this organization is on the platform, and who is on the team.
 *
 * The team query joins `users` and `user_profiles`, which the Customers page must
 * never do. The difference is not a lapse: a teammate is a member of *this*
 * tenant, their membership row is the thing being administered, and the same
 * fields are already served by GET /api/partner/[orgId]/members under
 * `partner.member:read`. A consumer who bought a ticket is not a member of
 * anything, and their identity is governed by consent instead.
 *
 * A member is addressed by their membership id rather than by their platform user
 * id — the membership is what exists inside this tenant, and it is the only handle
 * the team routes accept.
 */
import type { Metadata } from 'next';
import { desc, eq, inArray } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  organizationMembers,
  organizations,
  roles as rolesTable,
  userProfiles,
  userRoles,
  users,
} from '@/db/schema';
import { ROLE_PERMISSIONS, type RoleName } from '@/lib/authz/permissions';
import {
  Badge,
  Card,
  CardHead,
  Empty,
  Notice,
  StatusBadge,
  TableScroll,
  formatDateTime,
} from '@/components/ui';
import { requirePartner } from '@/components/partner/guard';
import { PageHeader, Summary } from '@/components/partner/shell';
import { SigningKeys } from '@/components/partner/signing-keys';
import { publishedKeys } from '@/lib/credentials/keys';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = { title: 'Settings' };
export const dynamic = 'force-dynamic';

/** Roles are held per membership, so one member can carry more than one. */
async function rolesByMembership(membershipIds: string[]): Promise<Map<string, RoleName[]>> {
  const byMembership = new Map<string, RoleName[]>();
  if (membershipIds.length === 0) return byMembership;

  const rows = await db
    .select({ membershipId: userRoles.membershipId, name: rolesTable.name })
    .from(userRoles)
    .innerJoin(rolesTable, eq(rolesTable.id, userRoles.roleId))
    .where(inArray(userRoles.membershipId, membershipIds));

  for (const row of rows) {
    if (!row.membershipId) continue;
    const list = byMembership.get(row.membershipId) ?? [];
    list.push(row.name as RoleName);
    byMembership.set(row.membershipId, list);
  }
  return byMembership;
}

export default async function SettingsPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const ctx = await requirePartner('partner.org:read', orgId, `/business/${orgId}/settings`);
  const organizationId = ctx.organizationId;
  const canSeeTeam = ctx.permissions.has('partner.member:read');

  const [organization] = await db
    .select()
    .from(organizations)
    // The guard's id, never params.orgId.
    .where(eq(organizations.id, organizationId))
    .limit(1);

  const members = canSeeTeam
    ? await db
        .select({
          membershipId: organizationMembers.id,
          organizationId: organizationMembers.organizationId,
          status: organizationMembers.status,
          joinedAt: organizationMembers.joinedAt,
          invitedAt: organizationMembers.createdAt,
          email: users.email,
          displayName: userProfiles.displayName,
        })
        .from(organizationMembers)
        .innerJoin(users, eq(users.id, organizationMembers.userId))
        .leftJoin(userProfiles, eq(userProfiles.userId, organizationMembers.userId))
        .where(eq(organizationMembers.organizationId, organizationId))
        .orderBy(desc(organizationMembers.id))
        .limit(100)
    : [];

  // Belt and braces: the filter above is the boundary, this is the assertion that
  // it held for every row that came back.
  const scoped = members.filter((member) => member.organizationId === organizationId);
  const roles = await rolesByMembership(scoped.map((member) => member.membershipId));

  // Already a Buffer: the schema's bytea type normalises whatever the driver hands back.
  const publicKeyHex = organization?.signingPublicKey?.toString('hex') ?? null;
  // Read-only: a page render never adopts or rotates anything (D-005).
  const keyHistory = await publishedKeys(organizationId, undefined, { adopt: false });
  const canManageKeys = ctx.permissions.has('partner.signing-key:manage');

  const rolesInUse = [...new Set(scoped.flatMap((member) => roles.get(member.membershipId) ?? []))];

  return (
    <div className="stack stack-5">
      <PageHeader
        eyebrow="Develop"
        title="Settings"
        lede="The organization as the platform holds it, and the people who may act for it. The profile is read-only here — a correction goes through platform operations. An owner can rotate or revoke the credential signing key."
      />

      {!organization ? (
        <Card>
          <Empty
            title="Organization not readable"
            body="The guard resolved this tenant but its row could not be read. Nothing on this page is fabricated to fill the gap."
          />
        </Card>
      ) : (
        <>
          <Card>
            <CardHead
              title={organization.name}
              action={
                <span className="row-wrap">
                  <StatusBadge status={organization.status} />
                  <Badge tone="neutral">{organization.kind.replace(/_/g, ' ').toLowerCase()}</Badge>
                </span>
              }
            />
            <div className="grid grid-2">
              <dl className="dl">
                <div>
                  <dt>Trading name</dt>
                  <dd>{organization.name}</dd>
                </div>
                <div>
                  <dt>Legal name</dt>
                  <dd>{organization.legalName ?? <span className="muted">Not recorded</span>}</dd>
                </div>
                <div>
                  <dt>Slug</dt>
                  <dd className="mono">{organization.slug}</dd>
                </div>
                <div>
                  <dt>Registration number</dt>
                  <dd className="mono">
                    {organization.registrationNo ?? <span className="muted">Not recorded</span>}
                  </dd>
                </div>
                <div>
                  <dt>City</dt>
                  <dd>
                    {organization.city ?? <span className="muted">—</span>}
                    {organization.countryCode ? ` · ${organization.countryCode}` : ''}
                  </dd>
                </div>
              </dl>

              <dl className="dl">
                <div>
                  <dt>Support email</dt>
                  <dd className="break-all">
                    {organization.supportEmail ?? <span className="muted">Not recorded</span>}
                  </dd>
                </div>
                <div>
                  <dt>Website</dt>
                  <dd className="break-all">
                    {organization.websiteUrl ?? <span className="muted">Not recorded</span>}
                  </dd>
                </div>
                <div>
                  <dt>Connector</dt>
                  <dd>
                    {organization.connectorKind ?? <span className="muted">None configured</span>}
                  </dd>
                </div>
                <div>
                  <dt>Joined</dt>
                  <dd>{formatDateTime(organization.createdAt)}</dd>
                </div>
                <div>
                  <dt>Reviewed</dt>
                  <dd>
                    {organization.reviewedAt ? (
                      formatDateTime(organization.reviewedAt)
                    ) : (
                      <span className="muted">Not reviewed</span>
                    )}
                  </dd>
                </div>
              </dl>
            </div>
          </Card>

          <Card>
            <CardHead
              title="Issuing key"
              action={<Badge tone="neutral">signing with {organization.signingKeyId}</Badge>}
            />
            {publicKeyHex ? (
              <>
                <p className="small muted measure-wide">
                  The public half of this organization&rsquo;s Ed25519 signing key. Anyone can use it
                  to check the signature on a credential you issued without trusting {BRAND.name}. The
                  private half is sealed with the platform key and never leaves the server — it is
                  not readable from this console and there is no screen that shows it.
                </p>
                <pre
                  className="card-flat mono tiny break-all"
                  style={{ marginTop: 12, whiteSpace: 'pre-wrap' }}
                >
                  {publicKeyHex}
                </pre>
                <p className="small muted measure-wide">
                  Every version this organization has signed with. Each credential records the key
                  that signed it, so rotating is safe: old credentials keep verifying against their own
                  key, which verifiers can fetch from{' '}
                  <code className="mono">/api/v1/issuers/{organization.slug}/keys</code>.
                </p>
                <div style={{ marginTop: 12 }}>
                  <SigningKeys
                    orgId={organizationId}
                    keys={keyHistory.map((k) => ({
                      keyId: k.keyId,
                      status: k.status,
                      activatedAt: k.activatedAt,
                      retiredAt: k.retiredAt,
                      revokedAt: k.revokedAt,
                    }))}
                    canManage={canManageKeys}
                  />
                </div>
              </>
            ) : (
              <Empty
                title="No issuing key yet"
                body="A keypair is created the first time this organization issues a credential, so an organization that never issues anything never holds a key it cannot explain."
              />
            )}
          </Card>

          {canSeeTeam ? (
            <Card>
              <CardHead
                title="Team"
                action={<span className="small muted">{scoped.length} members</span>}
              />
              {scoped.length === 0 ? (
                <Empty
                  title="No members"
                  body="Everyone who can act for this organization appears here, with the role that decides what they may do."
                />
              ) : (
                <>
                  <TableScroll>
                    <table className="table">
                      <thead>
                        <tr>
                          <th scope="col">Member</th>
                          <th scope="col">Email</th>
                          <th scope="col">Roles</th>
                          <th scope="col">Status</th>
                          <th scope="col">Invited</th>
                          <th scope="col">Joined</th>
                        </tr>
                      </thead>
                      <tbody>
                        {scoped.map((member) => (
                          <tr key={member.membershipId}>
                            <td>
                              <span style={{ fontWeight: 600 }}>
                                {member.displayName ?? 'Invited teammate'}
                              </span>
                              <span className="tiny muted mono stacked">
                                {member.membershipId}
                              </span>
                            </td>
                            <td className="small break-all">
                              {member.email ?? <span className="muted">—</span>}
                            </td>
                            <td className="row-wrap" style={{ gap: 4 }}>
                              {(roles.get(member.membershipId) ?? []).map((role) => (
                                <Badge key={role} tone={role === 'PARTNER_OWNER' ? 'accent' : 'neutral'}>
                                  {role.replace('PARTNER_', '').toLowerCase()}
                                </Badge>
                              ))}
                            </td>
                            <td>
                              <StatusBadge status={member.status} />
                            </td>
                            <td className="small muted nowrap">
                              {formatDateTime(member.invitedAt)}
                            </td>
                            <td className="small muted nowrap">
                              {member.joinedAt ? formatDateTime(member.joinedAt) : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </TableScroll>
                  <Notice tone="info">
                    <span>
                      An invitation grants nothing until it is accepted: authorization only honours
                      an <span className="mono">ACTIVE</span> membership, so a row sitting at{' '}
                      <span className="mono">INVITED</span> can sign in and still do nothing here.
                    </span>
                  </Notice>
                </>
              )}
            </Card>
          ) : (
            <Card>
              <Empty
                title="Team hidden"
                body="Your role does not include reading the team. The section is not rendered rather than rendered empty, so it cannot be mistaken for an organization with no members."
              />
            </Card>
          )}

          {canSeeTeam && rolesInUse.length > 0 ? (
            <Card>
              <CardHead title="What each role in use may do" />
              <TableScroll>
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Role</th>
                      <th scope="col" className="table-num">Permissions</th>
                      <th scope="col">Notable</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rolesInUse.map((role) => {
                      const held = ROLE_PERMISSIONS[role] ?? [];
                      const notable = held.filter((permission) =>
                        [
                          'partner.org:write',
                          'partner.member:manage',
                          'partner.role:assign',
                          'partner.apikey:write',
                          'partner.transaction:refund',
                          'partner.analytics:read',
                          'partner.pass:verify',
                        ].includes(permission),
                      );
                      return (
                        <tr key={role}>
                          <td style={{ fontWeight: 600 }}>{role.replace('PARTNER_', '').toLowerCase()}</td>
                          <td className="table-num">{held.length}</td>
                          <td className="row-wrap" style={{ gap: 4 }}>
                            {notable.length === 0 ? (
                              <span className="muted small">read-only inside this organization</span>
                            ) : (
                              notable.map((permission) => (
                                <Badge key={permission} tone="neutral">
                                  {permission}
                                </Badge>
                              ))
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableScroll>
              <p className="tiny muted measure-wide">
                Permissions are held per membership, never globally: holding owner here grants
                nothing at any other organization. Promoting someone above counter staff needs the
                role-assignment permission <em>and</em> a recent re-authentication, so an admin
                cannot mint an owner through the back door of an invite form.
              </p>
            </Card>
          ) : null}

          <Card>
            <CardHead title="This session" />
            <Summary
              items={[
                { label: 'Signed in as', value: <span className="small">{ctx.actor.displayName}</span> },
                {
                  label: 'Your roles here',
                  value: (
                    <span className="small">
                      {(ctx.membership?.roles ?? []).map((role) => role.replace('PARTNER_', '').toLowerCase()).join(', ') ||
                        '—'}
                    </span>
                  ),
                },
                { label: 'Permissions here', value: ctx.permissions.size },
                { label: 'Organization id', value: <span className="tiny mono">{organizationId}</span> },
              ]}
            />
          </Card>
        </>
      )}
    </div>
  );
}
