/**
 * Customers — the consented view, and nothing else.
 *
 * This page reads `business_customer_view` (src/db/isolation.sql) and mirrors it
 * field for field. That view is the *only* route from a business connection to a
 * consumer's identity: the `onepass_business` role has no SELECT on `users` or
 * `user_profiles` at all, so an injected read of those tables fails at the
 * database rather than at a WHERE clause somebody forgot.
 *
 * What the view decides, and therefore what this page shows:
 *   · `customer_ref` — always. It is the partner-facing handle from
 *     `partner_connections`, stable per organization, and it is never the user id.
 *   · `display_name` — only while a GRANTED, unexpired consent covering
 *     `identity.basic` exists for this organization.
 *   · `email` and `mobile` — only under a *separate* grant covering
 *     `contact.basic`. Identity does not imply contact, and the view models that
 *     as two independent joins rather than one flag.
 *
 * A field the view withheld is rendered as "Not shared" with the reason, because
 * a blank cell reads as missing data and invites someone to go looking for it in
 * a table they cannot read.
 */
import type { Metadata } from 'next';
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  Badge,
  Card,
  CardHead,
  Empty,
  Notice,
  StatusBadge,
  TableScroll,
  formatDateTime,
  formatRelative,
} from '@/components/ui';
import { customerFieldsShown, recordCustomerListDisclosure } from '@/lib/privacy/disclosures';
import { requirePartner } from '@/components/partner/guard';
import { ConsentNote, PageHeader, Summary } from '@/components/partner/shell';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = { title: 'Customers' };
export const dynamic = 'force-dynamic';

/**
 * One row of `business_customer_view`, as the view defines it.
 *
 * The nullable fields are nullable *because* the view withholds them: a null
 * `display_name` is a missing consent, not a customer without a name. The index
 * signature is what `db.execute` requires of a row type.
 */
interface CustomerViewRow extends Record<string, unknown> {
  customer_ref: string;
  display_name: string | null;
  email: string | null;
  mobile: string | null;
  connection_state: string;
  connected_at: Date;
  last_used_at: Date | null;
}

/** A field the consent view withheld. Never a blank cell. */
function NotShared({ reason }: { reason: string }) {
  return (
    <span className="row-wrap">
      <Badge tone="neutral">Not shared</Badge>
      <span className="tiny muted">{reason}</span>
    </span>
  );
}

export default async function CustomersPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const ctx = await requirePartner('partner.customer:read', orgId, `/business/${orgId}/customers`);
  const organizationId = ctx.organizationId;

  /**
   * The view is queried directly rather than reconstructed from `partner_connections`
   * and `consent_grants` here — reimplementing its join conditions in TypeScript is
   * exactly how a consent check drifts. DISTINCT because a consumer may hold more
   * than one live grant of the same kind (a re-grant after a revoke), which
   * multiplies rows in the view without changing what is disclosed.
   *
   * `user_id` is in the view and is deliberately not selected: a partner is
   * identified to a customer by `customer_ref`, and the platform user id is not a
   * partner's to hold.
   */
  const rows = await db.execute<CustomerViewRow>(sql`
    select distinct
      customer_ref,
      display_name,
      email,
      mobile,
      connection_state,
      connected_at,
      last_used_at
    from business_customer_view
    where organization_id = ${organizationId}
    order by connected_at desc
    limit 200
  `);

  const list = rows as unknown as CustomerViewRow[];

  // Rendering this list *is* the disclosure: the names and contact details the
  // view returned are about to reach a member of staff. So the person's history
  // learns about it here, from what the view actually returned — a field that
  // came back null was withheld and is not recorded (D-006). The handle is
  // resolved to a person inside the privacy module; this page never holds a
  // user id.
  await recordCustomerListDisclosure({
    organizationId,
    viewerUserId: ctx.actor.userId,
    rows: list.map((row) => ({ customerRef: row.customer_ref, fields: customerFieldsShown(row) })),
  });
  const named = list.filter((row) => row.display_name !== null).length;
  const contactable = list.filter((row) => row.email !== null || row.mobile !== null).length;

  return (
    <div className="stack stack-5">
      <PageHeader
        eyebrow="Relationships"
        title="Customers"
        lede={`People who have connected their ${BRAND.name} to this business. What you can see about each of them is decided by their consent, not by your role.`}
      />

      <Card>
        <div className="stack stack-4">
          <Summary
            items={[
              { label: 'Connections', value: list.length },
              { label: 'Name shared', value: `${named}/${list.length}` },
              { label: 'Contact shared', value: `${contactable}/${list.length}` },
            ]}
          />
          <p className="tiny muted measure-wide">
            Every column below comes from <span className="mono">business_customer_view</span>, the
            only path from this console to a consumer&rsquo;s identity. The database role this app
            uses for business queries cannot read the <span className="mono">users</span> table at
            all, so a field shown as <Badge tone="neutral">Not shared</Badge> is not merely hidden
            from the page — it is not readable from here.
          </p>
        </div>
      </Card>

      <Card>
        {list.length === 0 ? (
          <Empty
            title="No connected customers"
            body={`A customer appears here after they connect their ${BRAND.name} to this business. Their name and contact details appear only if they separately grant those.`}
          />
        ) : (
          <>
            <TableScroll>
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Customer</th>
                    <th scope="col">Name</th>
                    <th scope="col">Email</th>
                    <th scope="col">Mobile</th>
                    <th scope="col">Connection</th>
                    <th scope="col">Connected</th>
                    <th scope="col">Last used</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((row) => (
                    <tr key={row.customer_ref}>
                      <td className="mono nowrap">
                        {row.customer_ref}
                      </td>
                      <td>
                        {row.display_name ?? (
                          <NotShared reason="no live identity.basic consent" />
                        )}
                      </td>
                      <td className="small">
                        {row.email ?? <NotShared reason="no live contact.basic consent" />}
                      </td>
                      <td className="small mono">
                        {row.mobile ?? <NotShared reason="no live contact.basic consent" />}
                      </td>
                      <td>
                        <StatusBadge status={row.connection_state} />
                      </td>
                      <td className="small nowrap">
                        {formatDateTime(row.connected_at)}
                      </td>
                      <td className="small muted nowrap">
                        {row.last_used_at ? formatRelative(row.last_used_at) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>

            <ConsentNote>
              A customer reference is always disclosed — it is how this business names the
              relationship, and it is not the person&rsquo;s {BRAND.name} identity. A name appears only
              while a grant covering <span className="mono">identity.basic</span> is live. An email
              or mobile needs a second grant covering <span className="mono">contact.basic</span>:
              knowing who someone is does not entitle anyone to contact them. Withdrawing either
              consent removes the field from this table on the next page load, with no action
              required by you.
            </ConsentNote>
          </>
        )}
      </Card>

      <Card>
        <CardHead title="Why a field says “Not shared”" />
        <dl className="dl">
          <div>
            <dt>Name withheld</dt>
            <dd>
              No <span className="mono">identity.basic</span> grant is currently GRANTED and
              unexpired for this organization.
            </dd>
          </div>
          <div>
            <dt>Contact withheld</dt>
            <dd>
              No <span className="mono">contact.basic</span> grant is live. This is a separate
              consent from identity and is refused separately.
            </dd>
          </div>
          <div>
            <dt>Nothing here to appeal</dt>
            <dd>
              The gate is a join condition inside a database view your connection cannot bypass, not
              a setting on this console.
            </dd>
          </div>
        </dl>
        <Notice tone="info">
          <span>
            Bookings, receipts and returns are listed by their own references elsewhere in this
            console and never carry a customer name — the same rule, applied at the query rather
            than at the screen.
          </span>
        </Notice>
      </Card>
    </div>
  );
}
