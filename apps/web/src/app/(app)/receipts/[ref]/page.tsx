/**
 * One receipt, in full — and as the object it is.
 *
 * The printed record is on the left: merchant, date, what was bought, what it
 * cost. Everything you can *do* with it is on the right — the cover it
 * produced, the window it can be returned in, the cases already open. That
 * split is the point: a receipt is a record first and a form second, and the
 * form should not be the first thing on the screen.
 *
 * The money is the receipt's own four figures — subtotal, discount, tax, total
 * — read from the row that was written when the arithmetic was checked against
 * the lines. Nothing is recomputed here. A detail screen that re-derives a
 * total is a screen that can disagree with the merchant's copy, which is
 * exactly the disagreement `computeReceiptTotals` exists to make impossible.
 *
 * The return form is offered per line, and only where the service would
 * actually accept one: the line has to be returnable, the receipt's own
 * denormalised window still open, and some quantity left unclaimed by existing
 * cases. The claimed quantity is read with the same predicate `requestReturn`
 * enforces, so the page never shows a form that is going to be refused.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  DefinitionList,
  Money,
  Notice,
  Stack,
  StatusBadge,
  formatDate,
  formatDateTime,
  formatMoney,
} from '@/components/ui';
import { Receipt } from '@/components/objects';
import { Glyph } from '@/components/icons';
import { daysUntilIsoDate, describeDays, venueLine } from '@/components/consumer/format';
import { RETURN_REASONS, RESOLUTIONS, labelResolution } from '@/components/consumer/return-vocab';
import { getReceipt, isWithinReturnWindow, returnWindowClosesAt } from '@/lib/commerce/receipts';
import { claimedReturnQuantities, currentActor } from '../../_queries';
import { requestReturnAction } from './actions';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ ref: string }> }): Promise<Metadata> {
  const { ref } = await params;
  return { title: `Receipt ${ref}` };
}

export default async function ReceiptPage({
  params,
  searchParams,
}: {
  params: Promise<{ ref: string }>;
  searchParams: Promise<{ error?: string; opened?: string }>;
}) {
  const actor = await currentActor();
  const [{ ref }, query] = await Promise.all([params, searchParams]);

  const found = await getReceipt({ publicRef: ref, userId: actor.userId });
  if (!found) notFound();

  const { receipt, organization, venue, lines, warranties, openReturns } = found;
  const now = new Date();

  const claimed = await claimedReturnQuantities(receipt.id);

  const windowOpen = isWithinReturnWindow(receipt, now);
  const closesAt = returnWindowClosesAt(receipt);

  const returnableLines = lines.filter((line) => {
    const remaining = Math.max(0, line.quantity - (claimed.get(line.id) ?? 0));
    return line.isReturnable && windowOpen && remaining > 0;
  });

  return (
    <div className="wrap stack stack-5">
      <p className="small">
        <Link href="/receipts">← All receipts</Link>
      </p>

      {query.error ? <Notice tone="bad">{query.error}</Notice> : null}
      {query.opened ? (
        <Notice tone="ok">
          <span>
            Return <span className="mono">{query.opened}</span> is open with {organization?.name ?? 'the merchant'}.{' '}
            <Link href="/returns">Track it in your returns</Link>.
          </span>
        </Notice>
      ) : null}

      <div className="object-detail">
        {/* ── the record ── */}
        <div className="stack stack-4">
          <h1 className="sr-only">
            Receipt from {organization?.name ?? 'a merchant'}, {formatDateTime(receipt.issuedAt)}
          </h1>
          <Receipt label={`Receipt ${receipt.publicRef}`}>
            <Receipt.Head merchant={organization?.name ?? 'Receipt'}>
              <span className="receipt-muted">
                {venue ? `${venueLine(venue)} · ` : ''}
                {formatDateTime(receipt.issuedAt)}
              </span>
              <span className="receipt-muted">{receipt.publicRef}</span>
            </Receipt.Head>

            <Receipt.Lines>
              {lines.map((line) => (
                <Receipt.Line
                  key={line.id}
                  label={
                    <>
                      {line.description}
                      <span className="receipt-muted" style={{ display: 'block' }}>
                        {line.quantity} × {formatMoney(line.unitPriceMinor, receipt.currency)}
                        {line.taxRateBp > 0
                          ? ` · ${(line.taxRateBp / 100).toFixed(line.taxRateBp % 100 === 0 ? 0 : 2)}% tax`
                          : ' · no tax'}
                        {line.serialNumber ? ` · serial ${line.serialNumber}` : ''}
                      </span>
                    </>
                  }
                  value={formatMoney(line.lineTotalMinor, receipt.currency)}
                />
              ))}
            </Receipt.Lines>

            <div className="receipt-lines" style={{ borderBottom: 0 }}>
              <Receipt.Line label="Subtotal" value={formatMoney(receipt.subtotalMinor, receipt.currency)} muted />
              {receipt.discountMinor > 0 ? (
                <Receipt.Line
                  label="Discount"
                  value={`−${formatMoney(receipt.discountMinor, receipt.currency)}`}
                  muted
                />
              ) : null}
              <Receipt.Line label="Tax" value={formatMoney(receipt.taxMinor, receipt.currency)} muted />
            </div>

            <Receipt.Total value={formatMoney(receipt.totalMinor, receipt.currency)} />
            <p className="receipt-muted" style={{ textAlign: 'center', marginTop: 10 }}>
              {receipt.paymentLabel ?? 'Payment method not recorded'}
              {receipt.gstin ? ` · GSTIN ${receipt.gstin}` : ''}
              {receipt.merchantReceiptNo ? ` · no. ${receipt.merchantReceiptNo}` : ''}
            </p>
          </Receipt>

          {/* ── returning something ── */}
          {returnableLines.length > 0 ? (
            <Card className="stack stack-4">
              <div className="stack stack-1">
                <h2 className="h3">Send something back</h2>
                <p className="small muted">
                  Goes to {organization?.name ?? 'the merchant'} for a decision — nothing is refunded until they make
                  one. The window closes {formatDate(closesAt)}.
                </p>
              </div>

              {returnableLines.map((line) => {
                const remaining = Math.max(0, line.quantity - (claimed.get(line.id) ?? 0));
                return (
                  <details className="disclose" key={line.id}>
                    <summary>
                      <Glyph name="returns" size={16} />
                      <span>{line.description}</span>
                    </summary>
                    <form
                      action={requestReturnAction.bind(null, receipt.publicRef)}
                      className="stack stack-4"
                      style={{ marginTop: 12 }}
                    >
                      <input type="hidden" name="receiptLineId" value={line.id} />

                      <div className="grid grid-3">
                        <div className="field">
                          <label className="label" htmlFor={`qty-${line.id}`}>
                            How many
                          </label>
                          <select className="select" id={`qty-${line.id}`} name="quantity" defaultValue="1">
                            {Array.from({ length: remaining }, (_, i) => i + 1).map((n) => (
                              <option key={n} value={n}>
                                {n}
                              </option>
                            ))}
                          </select>
                          <p className="hint">
                            {remaining} of {line.quantity} still available to return.
                          </p>
                        </div>

                        <div className="field">
                          <label className="label" htmlFor={`reason-${line.id}`}>
                            Why
                          </label>
                          <select className="select" id={`reason-${line.id}`} name="reasonCode" defaultValue="">
                            <option value="" disabled>
                              Choose a reason
                            </option>
                            {RETURN_REASONS.map((r) => (
                              <option key={r.code} value={r.code}>
                                {r.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="field">
                          <label className="label" htmlFor={`resolution-${line.id}`}>
                            What you would like
                          </label>
                          <select
                            className="select"
                            id={`resolution-${line.id}`}
                            name="requestedResolution"
                            defaultValue="REFUND"
                          >
                            {RESOLUTIONS.map((r) => (
                              <option key={r.value} value={r.value}>
                                {r.label}
                              </option>
                            ))}
                          </select>
                          <p className="hint">The merchant decides; this is what you are asking for.</p>
                        </div>
                      </div>

                      <div className="field">
                        <label className="label" htmlFor={`note-${line.id}`}>
                          Anything to add <span className="muted">(optional)</span>
                        </label>
                        <textarea
                          className="textarea"
                          id={`note-${line.id}`}
                          name="reasonNote"
                          maxLength={500}
                          placeholder="What happened, in your own words."
                        />
                      </div>

                      <div className="row-wrap">
                        <Button type="submit" variant="primary">
                          Open the return
                        </Button>
                      </div>
                    </form>
                  </details>
                );
              })}
            </Card>
          ) : null}
        </div>

        {/* ── what you can do with it ── */}
        <aside className="object-detail-aside">
          <Card className="stack stack-3">
            <div className="row-wrap">
              <Badge tone="neutral">{receipt.channel.replace(/_/g, ' ').toLowerCase()}</Badge>
              {windowOpen ? (
                <Badge tone="ok">Returnable until {formatDate(closesAt)}</Badge>
              ) : receipt.returnWindowDays > 0 ? (
                <Badge tone="neutral">Return window closed {formatDate(closesAt)}</Badge>
              ) : (
                <Badge tone="neutral">No returns on this purchase</Badge>
              )}
            </div>
            <DefinitionList
              items={[
                ['Total paid', <Money key="t" minor={receipt.totalMinor} currency={receipt.currency} />],
                ['Items', String(lines.length)],
                ['Issued', formatDateTime(receipt.issuedAt)],
                ['Reference', <span key="r" className="mono">{receipt.publicRef}</span>],
              ]}
            />
          </Card>

          {warranties.length > 0 ? (
            <Card className="stack stack-3">
              <h2 className="h3">Cover this purchase produced</h2>
              <ul className="ledger">
                {warranties.map((w) => {
                  const line = lines.find((l) => l.id === w.receiptLineId);
                  return (
                    <li key={w.id}>
                      <span className="ledger-main">
                        <Link className="ledger-title" href={`/warranties/${w.publicRef}`}>
                          {line?.description ?? w.productName}
                        </Link>
                        <span className="ledger-meta">
                          {w.months} months, to {formatDate(w.expiresOn)} ·{' '}
                          {describeDays(daysUntilIsoDate(w.expiresOn, now))}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
              <ButtonLink href="/warranties" size="sm">
                Warranty shelf
              </ButtonLink>
            </Card>
          ) : null}

          {openReturns.length > 0 ? (
            <Card className="stack stack-3">
              <h2 className="h3">Returns on this receipt</h2>
              <ul className="ledger">
                {openReturns.map((r) => (
                  <li key={r.id}>
                    <span className="ledger-main">
                      <Link className="ledger-title mono" href="/returns">
                        {r.publicRef}
                      </Link>
                      <span className="ledger-meta">
                        {r.quantity} unit{r.quantity === 1 ? '' : 's'} · asked for{' '}
                        {labelResolution(r.requestedResolution).toLowerCase()} · opened {formatDate(r.createdAt)}
                      </span>
                    </span>
                    <StatusBadge status={r.state} />
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Card className="card-flat">
            <Stack gap={2}>
              <p className="eyebrow">Return policy</p>
              <p className="small">
                {receipt.returnWindowDays > 0
                  ? `${receipt.returnWindowDays} day${receipt.returnWindowDays === 1 ? '' : 's'} from purchase — until ${formatDateTime(closesAt)}.`
                  : 'This merchant does not accept returns on this purchase.'}
              </p>
              {receipt.returnPolicyNote ? <p className="small muted">{receipt.returnPolicyNote}</p> : null}
              <p className="tiny muted">
                These are the terms as they stood on the day of purchase, copied onto the receipt. A later change to
                the merchant&apos;s policy cannot close a window you were promised.
              </p>
            </Stack>
          </Card>
        </aside>
      </div>
    </div>
  );
}
