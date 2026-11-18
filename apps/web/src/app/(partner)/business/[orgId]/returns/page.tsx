/**
 * Returns — the queue, and the decision.
 *
 * A case is a conversation with a customer who already has your money. The queue
 * is therefore ordered by what needs a human first: cases nobody has picked up,
 * then cases decided but not yet settled, then everything finished.
 *
 * There are no customer names here. `listOrganizationReturns` returns the case,
 * the line and the venue and deliberately never joins `users`; who the person is
 * appears on Customers, and only where they granted it.
 *
 * MONEY: approving a refund records the amount agreed. Nothing on this page moves
 * money — the payments module reads the approved case and settles it. The ceiling
 * shown on the form is what was charged for the units actually coming back, not
 * the whole line, which is why a one-of-three return cannot be approved for three.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Badge,
  Card,
  CardHead,
  Empty,
  Notice,
  StatusBadge,
  TableScroll,
  formatDateTime,
  formatMoney,
  formatRelative,
} from '@/components/ui';
import { requirePartner } from '@/components/partner/guard';
import { ConsentNote, FilterLinks, PageHeader, Summary } from '@/components/partner/shell';
import { ReturnStepper } from '@/components/partner/return-stepper';
import {
  RETURN_TRANSITIONS,
  listOrganizationReturns,
  type ReturnState,
} from '@/lib/commerce/returns';
import { decideReturn, moveReturn } from './actions';

export const metadata: Metadata = { title: 'Returns' };
export const dynamic = 'force-dynamic';

const STATES = Object.keys(RETURN_TRANSITIONS) as ReturnState[];
const AWAITING: ReturnState[] = ['REQUESTED', 'UNDER_REVIEW'];
const IN_PROGRESS: ReturnState[] = ['APPROVED', 'IN_TRANSIT'];

const RESOLUTIONS = ['REFUND', 'REPLACEMENT', 'STORE_CREDIT', 'REPAIR'] as const;

function parseState(value: string | string[] | undefined): ReturnState | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  const upper = raw.toUpperCase() as ReturnState;
  return STATES.includes(upper) ? upper : null;
}

function first(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw ?? null;
}

export default async function ReturnsPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { orgId } = await params;
  const query = await searchParams;
  const ctx = await requirePartner('partner.transaction:read', orgId, `/business/${orgId}/returns`);
  const canDecide = ctx.permissions.has('partner.transaction:refund');

  const state = parseState(query.state);
  const rows = await listOrganizationReturns({
    // The guard's id, never params.orgId.
    organizationId: ctx.organizationId,
    state: state ?? undefined,
    limit: 200,
  });

  const base = `/business/${ctx.organizationId}/returns`;
  const error = first(query.error);
  const decided = first(query.decided);
  const moved = first(query.moved);

  const awaiting = rows.filter((row) => AWAITING.includes(row.request.state));
  const inProgress = rows.filter((row) => IN_PROGRESS.includes(row.request.state));
  const settled = rows.filter(
    (row) => !AWAITING.includes(row.request.state) && !IN_PROGRESS.includes(row.request.state),
  );
  const agreed = rows.reduce((sum, row) => sum + (row.request.refundMinor ?? 0), 0);

  /** What may be refunded for the units actually coming back. Mirrors reviewReturn. */
  const refundableMinor = (row: (typeof rows)[number]): number | null => {
    if (!row.line) return null;
    return Math.min(row.line.unitPriceMinor * row.request.quantity, row.line.lineTotalMinor);
  };

  return (
    <div className="stack stack-5">
      <PageHeader
        eyebrow="Relationships"
        title="Returns"
        lede="Cases opened against receipts this organization issued. Deciding one records the outcome and the amount agreed; the reversal itself is the payments module's job."
      />

      {error ? (
        <Notice tone="bad">
          <span role="alert">{error}</span>
        </Notice>
      ) : null}
      {decided ? (
        <Notice tone={decided === 'APPROVED' ? 'ok' : 'info'}>
          <span>
            Recorded as {decided.toLowerCase()}. The customer has been notified with the note you
            wrote.
          </span>
        </Notice>
      ) : null}
      {moved ? (
        <Notice tone="ok">
          <span>Moved to {moved.replace(/_/g, ' ').toLowerCase()}.</span>
        </Notice>
      ) : null}

      <Card>
        <div className="stack stack-4">
          <FilterLinks
            label="Filter returns by state"
            current={state}
            options={[
              { href: base, label: 'All', value: null },
              ...STATES.map((value) => ({
                href: `${base}?state=${value.toLowerCase()}`,
                label: value.replace(/_/g, ' ').toLowerCase(),
                value,
              })),
            ]}
          />
          <Summary
            items={[
              { label: 'Cases', value: rows.length },
              { label: 'Awaiting a decision', value: awaiting.length },
              { label: 'Decided, not settled', value: inProgress.length },
              { label: 'Refund agreed', value: formatMoney(agreed) },
            ]}
          />
          {!canDecide ? (
            <p className="tiny muted">
              Your role can read this queue but not decide it. Approving or declining a return needs
              the refund permission.
            </p>
          ) : null}
        </div>
      </Card>

      {rows.length === 0 ? (
        <Card>
          <Empty
            title={state ? `No ${state.replace(/_/g, ' ').toLowerCase()} returns` : 'No returns'}
            body={
              state
                ? 'Nothing in this organization currently sits in that state.'
                : 'A case appears here the moment a customer opens one against a receipt you issued, and stays until it is closed.'
            }
            action={
              state ? (
                <Link className="btn btn-sm" href={base}>
                  Clear the filter
                </Link>
              ) : null
            }
          />
        </Card>
      ) : null}

      {awaiting.length > 0 ? (
        <section className="stack stack-4">
          <CardHead
            title="Awaiting a decision"
            action={<span className="small muted">{awaiting.length} open</span>}
          />
          {awaiting.map((row) => {
            const ceiling = refundableMinor(row);
            const closed = row.request.windowClosesAt.getTime() < Date.now();

            return (
              <Card key={row.request.id} as="article">
                <div className="row-between" style={{ alignItems: 'flex-start' }}>
                  <div className="grow">
                    <p className="eyebrow">
                      <span className="mono">{row.request.publicRef}</span>
                      {row.receipt ? (
                        <>
                          {' · receipt '}
                          <span className="mono">{row.receipt.publicRef}</span>
                        </>
                      ) : null}
                    </p>
                    <h2 className="h3" style={{ marginTop: 4 }}>
                      {row.line?.description ?? 'Purchased item'}
                    </h2>
                    <p className="small muted" style={{ marginTop: 4 }}>
                      {row.request.quantity} of {row.line?.quantity ?? '?'} ·{' '}
                      {row.request.reasonCode.replace(/_/g, ' ').toLowerCase()} · wants{' '}
                      {row.request.requestedResolution.replace(/_/g, ' ').toLowerCase()}
                      {row.venue?.name ? ` · ${row.venue.name}` : ''}
                    </p>
                  </div>
                  <div className="stack stack-2" style={{ alignItems: 'flex-end' }}>
                    <StatusBadge status={row.request.state} />
                    <span className="tiny muted">opened {formatRelative(row.request.createdAt)}</span>
                  </div>
                </div>

                {row.request.reasonNote ? (
                  <div className="card-flat" style={{ marginTop: 14 }}>
                    <p className="eyebrow">What the customer said</p>
                    <p className="small" style={{ marginTop: 6 }}>
                      {row.request.reasonNote}
                    </p>
                  </div>
                ) : null}

                <div style={{ marginTop: 14 }}>
                  <ReturnStepper state={row.request.state} />
                </div>

                <dl className="dl" style={{ marginTop: 14 }}>
                  <div>
                    <dt>Line total</dt>
                    <dd className="mono">
                      {row.line ? formatMoney(row.line.lineTotalMinor) : <span className="muted">—</span>}
                    </dd>
                  </div>
                  <div>
                    <dt>Refundable for {row.request.quantity} unit(s)</dt>
                    <dd className="mono">
                      {ceiling === null ? <span className="muted">—</span> : formatMoney(ceiling)}
                    </dd>
                  </div>
                  <div>
                    <dt>Return window</dt>
                    <dd>
                      {closed ? (
                        <Badge tone="warn">closed {formatDateTime(row.request.windowClosesAt)}</Badge>
                      ) : (
                        <span className="small">closes {formatDateTime(row.request.windowClosesAt)}</span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Returnable</dt>
                    <dd>
                      {row.line?.isReturnable === false ? (
                        <Badge tone="bad">marked non-returnable</Badge>
                      ) : (
                        <Badge tone="ok">yes</Badge>
                      )}
                    </dd>
                  </div>
                </dl>

                {canDecide ? (
                  <form
                    action={decideReturn.bind(null, ctx.organizationId)}
                    className="stack stack-3"
                    style={{ marginTop: 16 }}
                  >
                    <input type="hidden" name="returnId" value={row.request.id} />
                    <hr className="divider" />

                    <div className="grid grid-2">
                      <div className="field">
                        <label className="label" htmlFor={`res-${row.request.id}`}>
                          Resolution if approved
                        </label>
                        <select
                          id={`res-${row.request.id}`}
                          name="grantedResolution"
                          className="select"
                          defaultValue={row.request.requestedResolution}
                        >
                          {RESOLUTIONS.map((resolution) => (
                            <option key={resolution} value={resolution}>
                              {resolution.replace(/_/g, ' ').toLowerCase()}
                            </option>
                          ))}
                        </select>
                        <p className="hint">Defaults to what the customer asked for.</p>
                      </div>

                      <div className="field">
                        <label className="label" htmlFor={`ref-${row.request.id}`}>
                          Refund, in rupees
                        </label>
                        <input
                          id={`ref-${row.request.id}`}
                          name="refundRupees"
                          className="input input-mono"
                          type="number"
                          min={0}
                          step="0.01"
                          max={ceiling === null ? undefined : ceiling / 100}
                          placeholder={ceiling === null ? '' : String(ceiling / 100)}
                        />
                        <p className="hint">
                          Required when the resolution is a refund. Cannot exceed{' '}
                          {ceiling === null ? 'the units returned' : formatMoney(ceiling)} — the
                          service refuses more.
                        </p>
                      </div>
                    </div>

                    <div className="field">
                      <label className="label" htmlFor={`note-${row.request.id}`}>
                        Note to the customer
                      </label>
                      <textarea
                        id={`note-${row.request.id}`}
                        name="merchantNote"
                        className="textarea"
                        maxLength={500}
                        required
                        placeholder="What you decided and why. The customer is shown this."
                      />
                    </div>

                    <div className="row-wrap">
                      <button type="submit" name="decision" value="APPROVED" className="btn btn-primary">
                        Approve
                      </button>
                      <button type="submit" name="decision" value="REJECTED" className="btn btn-danger">
                        Reject
                      </button>
                      <span className="tiny muted">
                        A case sitting in requested is walked through under review, so the audit
                        trail shows both moves.
                      </span>
                    </div>
                  </form>
                ) : null}
              </Card>
            );
          })}
        </section>
      ) : null}

      {inProgress.length > 0 ? (
        <section className="stack stack-4">
          <CardHead
            title="Decided, not yet settled"
            action={<span className="small muted">{inProgress.length} open</span>}
          />
          {inProgress.map((row) => (
            <Card key={row.request.id} as="article">
              <div className="row-between" style={{ alignItems: 'flex-start' }}>
                <div className="grow">
                  <p className="eyebrow mono">{row.request.publicRef}</p>
                  <h2 className="h3" style={{ marginTop: 4 }}>
                    {row.line?.description ?? 'Purchased item'}
                  </h2>
                  <p className="small muted" style={{ marginTop: 4 }}>
                    {row.request.grantedResolution
                      ? `granted ${row.request.grantedResolution.replace(/_/g, ' ').toLowerCase()}`
                      : 'no resolution recorded'}
                    {row.request.refundMinor !== null
                      ? ` · ${formatMoney(row.request.refundMinor)} agreed`
                      : ''}
                    {row.request.decidedAt ? ` · decided ${formatRelative(row.request.decidedAt)}` : ''}
                  </p>
                </div>
                <StatusBadge status={row.request.state} />
              </div>

              {row.request.merchantNote ? (
                <p className="small muted" style={{ marginTop: 10 }}>
                  “{row.request.merchantNote}”
                </p>
              ) : null}

              <div style={{ marginTop: 14 }}>
                <ReturnStepper state={row.request.state} />
              </div>

              {canDecide ? (
                <div className="row-wrap" style={{ marginTop: 14, gap: 6 }}>
                  {RETURN_TRANSITIONS[row.request.state].map((to) => (
                    <form key={to} action={moveReturn.bind(null, ctx.organizationId)}>
                      <input type="hidden" name="returnId" value={row.request.id} />
                      <input type="hidden" name="to" value={to} />
                      <button type="submit" className="btn btn-sm">
                        {to.replace(/_/g, ' ').toLowerCase()}
                      </button>
                    </form>
                  ))}
                </div>
              ) : null}
            </Card>
          ))}
        </section>
      ) : null}

      {settled.length > 0 ? (
        <Card>
          <CardHead title="Finished" action={<span className="small muted">{settled.length} cases</span>} />
          <TableScroll>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Case</th>
                  <th scope="col">Item</th>
                  <th scope="col" className="table-num">Qty</th>
                  <th scope="col">State</th>
                  <th scope="col">Resolution</th>
                  <th scope="col" className="table-num">Refund agreed</th>
                  <th scope="col">Decided</th>
                </tr>
              </thead>
              <tbody>
                {settled.map((row) => (
                  <tr key={row.request.id}>
                    <td className="mono nowrap">
                      {row.request.publicRef}
                    </td>
                    <td>{row.line?.description ?? <span className="muted">—</span>}</td>
                    <td className="table-num">{row.request.quantity}</td>
                    <td>
                      <StatusBadge status={row.request.state} />
                    </td>
                    <td className="small">
                      {row.request.grantedResolution ? (
                        row.request.grantedResolution.replace(/_/g, ' ').toLowerCase()
                      ) : (
                        <span className="muted">none granted</span>
                      )}
                    </td>
                    <td className="table-num">
                      {row.request.refundMinor === null ? (
                        <span className="muted">—</span>
                      ) : (
                        formatMoney(row.request.refundMinor)
                      )}
                    </td>
                    <td className="small muted nowrap">
                      {row.request.decidedAt ? formatRelative(row.request.decidedAt) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
          <ConsentNote>
            A return is identified by its reference and the receipt line it was raised against. The
            customer&rsquo;s name is not part of this query and is not readable from it.
          </ConsentNote>
        </Card>
      ) : null}
    </div>
  );
}
