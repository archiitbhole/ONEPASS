/**
 * Credentials across the platform, and who has been checking them.
 *
 * ── Aggregates only, deliberately ─────────────────────────────
 * There is no list of credentials on this page and no way to reach one from it.
 * `credentials.holderNameSnapshot` and `credentials.holderExternalRef` are a
 * person's name and the issuer's internal handle for them — a roll number, an
 * employee code — and a platform-wide roster of who holds what is not something
 * an operator needs in order to answer the questions this page exists for: is
 * issuance working, is anyone verifying, and is a verifier being refused
 * repeatedly. Every query below groups; none of them selects a holder column.
 *
 * `claims`, `claimsHash` and `issuerSignature` are not selected either. The first
 * is the credential's content, the other two are what make it tamper-evident, and
 * none of them belongs on an operations screen.
 *
 * "Who is checking what" is the verifier-by-issuer table: it answers whether an
 * organization's credentials are being verified by anyone outside it, which is
 * the number that predicts whether the issuer renews.
 */
import type { Metadata } from 'next';
import { count, desc, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '@/db/client';
import { credentialTypes, credentials, organizations, verifications } from '@/db/schema';
import {
  Badge,
  Card,
  CardHead,
  Empty,
  Stat,
  StatusBadge,
  TableScroll,
  formatDate,
  formatRelative,
} from '@/components/ui';
import { PageHeader, Summary } from '@/components/partner/shell';
import { requirePlatform } from '@/components/admin/guard';

export const metadata: Metadata = { title: 'Credentials' };
export const dynamic = 'force-dynamic';

const issuerOrg = alias(organizations, 'issuer_org');
const verifierOrg = alias(organizations, 'verifier_org');

export default async function ControlCredentialsPage() {
  await requirePlatform('platform.credential:read', '/control/credentials');

  const [totals] = await db
    .select({
      issued: count(),
      active: sql<number>`cast(count(*) filter (where ${credentials.status} = 'ACTIVE') as int)`,
      suspended: sql<number>`cast(count(*) filter (where ${credentials.status} = 'SUSPENDED') as int)`,
      revoked: sql<number>`cast(count(*) filter (where ${credentials.status} = 'REVOKED') as int)`,
      expired: sql<number>`cast(count(*) filter (where ${credentials.status} = 'EXPIRED') as int)`,
      draft: sql<number>`cast(count(*) filter (where ${credentials.status} = 'DRAFT') as int)`,
      claimed: sql<number>`cast(count(*) filter (where ${credentials.holderUserId} is not null) as int)`,
    })
    .from(credentials);

  const [checks] = await db
    .select({
      total: count(),
      verified: sql<number>`cast(count(*) filter (where ${verifications.outcome} = 'VERIFIED') as int)`,
      pending: sql<number>`cast(count(*) filter (where ${verifications.outcome} = 'PENDING') as int)`,
      revoked: sql<number>`cast(count(*) filter (where ${verifications.outcome} = 'REVOKED') as int)`,
      expired: sql<number>`cast(count(*) filter (where ${verifications.outcome} = 'EXPIRED') as int)`,
      invalid: sql<number>`cast(count(*) filter (where ${verifications.outcome} = 'INVALID') as int)`,
      notFound: sql<number>`cast(count(*) filter (where ${verifications.outcome} = 'NOT_FOUND') as int)`,
      anonymous: sql<number>`cast(count(*) filter (where ${verifications.verifierOrganizationId} is null) as int)`,
    })
    .from(verifications);

  // Issuance by organization. Counts and dates only — no holder column is named.
  const issuers = await db
    .select({
      organizationId: credentials.organizationId,
      organizationName: organizations.name,
      organizationStatus: organizations.status,
      issued: count(),
      active: sql<number>`cast(count(*) filter (where ${credentials.status} = 'ACTIVE') as int)`,
      revoked: sql<number>`cast(count(*) filter (where ${credentials.status} = 'REVOKED') as int)`,
      verificationCount: sql<number>`cast(coalesce(sum(${credentials.verificationCount}), 0) as int)`,
      lastIssuedAt: sql<Date | null>`max(${credentials.issuedAt})`,
    })
    .from(credentials)
    .innerJoin(organizations, eq(organizations.id, credentials.organizationId))
    .groupBy(credentials.organizationId, organizations.name, organizations.status)
    .orderBy(desc(count()))
    .limit(50);

  const types = await db
    .select({
      id: credentialTypes.id,
      key: credentialTypes.key,
      name: credentialTypes.name,
      category: credentialTypes.category,
      active: credentialTypes.active,
      discloseHolderName: credentialTypes.discloseHolderName,
      organizationName: organizations.name,
      issued: sql<number>`cast(count(${credentials.id}) as int)`,
    })
    .from(credentialTypes)
    .innerJoin(organizations, eq(organizations.id, credentialTypes.organizationId))
    .leftJoin(credentials, eq(credentials.credentialTypeId, credentialTypes.id))
    .groupBy(
      credentialTypes.id,
      credentialTypes.key,
      credentialTypes.name,
      credentialTypes.category,
      credentialTypes.active,
      credentialTypes.discloseHolderName,
      organizations.name,
    )
    .orderBy(desc(sql`count(${credentials.id})`))
    .limit(50);

  // Who is checking what: one row per verifier, issuer and channel.
  const checkers = await db
    .select({
      verifierId: verifications.verifierOrganizationId,
      verifierName: verifierOrg.name,
      issuerId: credentials.organizationId,
      issuerName: issuerOrg.name,
      channel: verifications.channel,
      total: count(),
      verified: sql<number>`cast(count(*) filter (where ${verifications.outcome} = 'VERIFIED') as int)`,
      refused: sql<number>`cast(count(*) filter (where ${verifications.outcome} in ('INVALID','NOT_FOUND','REVOKED','EXPIRED')) as int)`,
      lastAt: sql<Date | null>`max(${verifications.createdAt})`,
    })
    .from(verifications)
    .leftJoin(credentials, eq(credentials.id, verifications.credentialId))
    .leftJoin(issuerOrg, eq(issuerOrg.id, credentials.organizationId))
    .leftJoin(verifierOrg, eq(verifierOrg.id, verifications.verifierOrganizationId))
    .groupBy(
      verifications.verifierOrganizationId,
      verifierOrg.name,
      credentials.organizationId,
      issuerOrg.name,
      verifications.channel,
    )
    .orderBy(desc(count()))
    .limit(50);

  const issuedTotal = totals?.issued ?? 0;
  const checksTotal = checks?.total ?? 0;

  return (
    <div className="stack stack-5">
      <PageHeader
        eyebrow="Platform"
        title="Credentials"
        lede="Issuance and verification, in aggregate. No holder is named on this page: no query behind it selects a holder’s name, their issuer reference, the credential’s claims or its signature."
      />

      <div className="grid grid-4">
        <Stat
          label="Credentials issued"
          value={issuedTotal}
          hint={`${totals?.active ?? 0} active · ${totals?.revoked ?? 0} revoked`}
        />
        <Stat
          label="Claimed by a holder"
          value={totals?.claimed ?? 0}
          hint={
            issuedTotal > 0
              ? `${issuedTotal - (totals?.claimed ?? 0)} issued to someone who has not claimed yet`
              : 'Nothing issued yet'
          }
        />
        <Stat
          label="Verifications"
          value={checksTotal}
          hint={`${checks?.verified ?? 0} came back verified`}
        />
        <Stat
          label="Refused checks"
          value={
            (checks?.invalid ?? 0) + (checks?.notFound ?? 0) + (checks?.revoked ?? 0) + (checks?.expired ?? 0)
          }
          hint="Invalid, not found, revoked or expired"
          tone={
            (checks?.invalid ?? 0) + (checks?.notFound ?? 0) > 0 ? 'warn' : undefined
          }
        />
      </div>

      <Card>
        <CardHead title="Outcomes" action={<span className="small muted">Every verification ever attempted</span>} />
        {checksTotal === 0 ? (
          <Empty
            title="Nothing has been verified yet"
            body="A row appears here the moment a credential reference is presented for checking, including when the reference does not resolve."
          />
        ) : (
          <Summary
            items={[
              { label: 'Verified', value: checks?.verified ?? 0 },
              { label: 'Pending', value: checks?.pending ?? 0 },
              { label: 'Revoked', value: checks?.revoked ?? 0 },
              { label: 'Expired', value: checks?.expired ?? 0 },
              { label: 'Invalid', value: checks?.invalid ?? 0 },
              { label: 'Not found', value: checks?.notFound ?? 0 },
              { label: 'Anonymous checks', value: checks?.anonymous ?? 0 },
            ]}
          />
        )}
      </Card>

      <Card>
        <CardHead title="Issuers" action={<span className="small muted">Grouped by organization</span>} />
        {issuers.length === 0 ? (
          <Empty
            title="No credentials issued"
            body="An organization appears here once it issues its first credential against a credential type."
          />
        ) : (
          <TableScroll>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Organization</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="table-num">Issued</th>
                  <th scope="col" className="table-num">Active</th>
                  <th scope="col" className="table-num">Revoked</th>
                  <th scope="col" className="table-num">Checks against them</th>
                  <th scope="col">Last issued</th>
                </tr>
              </thead>
              <tbody>
                {issuers.map((row) => (
                  <tr key={row.organizationId}>
                    <td className="small" style={{ fontWeight: 600 }}>{row.organizationName}</td>
                    <td><StatusBadge status={row.organizationStatus} /></td>
                    <td className="table-num">{row.issued}</td>
                    <td className="table-num">{row.active}</td>
                    <td className="table-num">{row.revoked}</td>
                    <td className="table-num">{row.verificationCount}</td>
                    <td className="small">{row.lastIssuedAt ? formatDate(row.lastIssuedAt) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Card>

      <Card>
        <CardHead title="Credential types" action={<span className="small muted">What is being issued</span>} />
        {types.length === 0 ? (
          <Empty
            title="No credential types defined"
            body="A partner defines a type before it can issue against it. None has been defined on this platform yet."
          />
        ) : (
          <TableScroll>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Type</th>
                  <th scope="col">Issuer</th>
                  <th scope="col">Category</th>
                  <th scope="col">Discloses the holder’s name</th>
                  <th scope="col">State</th>
                  <th scope="col" className="table-num">Issued</th>
                </tr>
              </thead>
              <tbody>
                {types.map((row) => (
                  <tr key={row.id}>
                    <td className="small">
                      <span style={{ fontWeight: 600 }}>{row.name}</span>
                      <div className="tiny muted mono">{row.key}</div>
                    </td>
                    <td className="small">{row.organizationName}</td>
                    <td className="small muted">{row.category.replace(/_/g, ' ').toLowerCase()}</td>
                    <td>
                      {row.discloseHolderName ? (
                        <Badge tone="warn">name shown on a scan</Badge>
                      ) : (
                        <Badge tone="ok">claim only</Badge>
                      )}
                    </td>
                    <td>{row.active ? <Badge tone="ok" dot>active</Badge> : <Badge tone="neutral" dot>retired</Badge>}</td>
                    <td className="table-num">{row.issued}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Card>

      <Card>
        <CardHead
          title="Who is checking what"
          action={<span className="small muted">Verifier by issuer and channel</span>}
        />
        {checkers.length === 0 ? (
          <Empty
            title="Nobody has verified anything"
            body="This table fills in as credentials are presented for checking — including anonymous public checks, which are recorded with no verifier."
          />
        ) : (
          <>
            <TableScroll>
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Verifier</th>
                    <th scope="col">Issuer checked</th>
                    <th scope="col">Channel</th>
                    <th scope="col" className="table-num">Checks</th>
                    <th scope="col" className="table-num">Verified</th>
                    <th scope="col" className="table-num">Refused</th>
                    <th scope="col">Last check</th>
                  </tr>
                </thead>
                <tbody>
                  {checkers.map((row, index) => (
                    <tr key={`${row.verifierId ?? 'anon'}-${row.issuerId ?? 'none'}-${row.channel}-${index}`}>
                      <td className="small">
                        {row.verifierName ?? <span className="muted">anonymous public check</span>}
                      </td>
                      <td className="small">
                        {row.issuerName ?? <span className="muted">reference did not resolve</span>}
                      </td>
                      <td className="small mono">{row.channel}</td>
                      <td className="table-num">{row.total}</td>
                      <td className="table-num">{row.verified}</td>
                      <td className="table-num">{row.refused}</td>
                      <td className="small">{row.lastAt ? formatRelative(row.lastAt) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
            <p className="tiny muted" style={{ marginTop: 10 }}>
              A row whose issuer is blank is a reference that did not resolve to any credential. Those
              are kept deliberately: repeated failures against one reference, or from one source, are
              the signal the risk layer reads.
            </p>
          </>
        )}
      </Card>
    </div>
  );
}
