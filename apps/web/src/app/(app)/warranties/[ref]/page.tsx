/**
 * One warranty, drawn as the certificate it is.
 *
 * Exists because the reminder sweep links here: `warrantiesExpiringSoon` writes a
 * notification whose `linkPath` is `/warranties/<ref>`, and a reminder that lands
 * on a 404 is a reminder that reads as a bug rather than as cover running out.
 *
 * Every date is the one stored on the row — set when the receipt was issued, from
 * the merchant's terms as they stood that day. Nothing is recomputed from the
 * merchant's current policy; that is the whole reason a warranty is a row rather
 * than a view over `receipt_lines`.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import {
  Badge,
  ButtonLink,
  Card,
  DefinitionList,
  Notice,
  Stack,
  formatDate,
  formatMoney,
} from '@/components/ui';
import { Certificate } from '@/components/objects';
import { describeDays } from '@/components/consumer/format';
import { warrantyTerm } from '@/components/consumer/warranty-shape';
import { EXPIRING_SOON_DAYS, getWarranty } from '@/lib/commerce/warranties';
import { currentActor } from '../../_queries';
import { BRAND } from '@/lib/brand';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ ref: string }>;
}): Promise<Metadata> {
  const { ref } = await params;
  return { title: `Warranty ${ref}` };
}

export default async function WarrantyPage({ params }: { params: Promise<{ ref: string }> }) {
  const actor = await currentActor();
  const { ref } = await params;

  const found = await getWarranty({ publicRef: ref, userId: actor.userId });
  if (!found) notFound();

  const { warranty, receipt, organization } = found;
  const now = new Date();
  // The same arithmetic the shelf draws, from the same place: how much of the
  // term is gone reads faster as a bar than as two dates to subtract, and the
  // two dates are underneath it anyway.
  const term = warrantyTerm(warranty, now, describeDays);
  const { days, lapsed } = term;

  return (
    <div className="wrap stack stack-5">
      <p className="small">
        <Link href="/warranties">← Warranty shelf</Link>
      </p>

      <div className="object-detail">
        <div className="stack stack-4">
          <Certificate seed={warranty.publicRef}>
            <div className="stack stack-4">
              <div className="row" style={{ alignItems: 'flex-start' }}>
                <Certificate.Seal />
                <div className="stack stack-1" style={{ minWidth: 0 }}>
                  <p className="eyebrow">Warranty · {organization?.name ?? 'Merchant not recorded'}</p>
                  <h1 className="h2">{warranty.productName}</h1>
                  <p className="small muted">
                    {warranty.months} month{warranty.months === 1 ? '' : 's'} from {formatDate(warranty.purchasedOn)}
                  </p>
                </div>
              </div>

              <div className="stack stack-2">
                <div
                  className="timeline-bar"
                  data-tone={lapsed ? 'bad' : term.expiringSoon ? 'warn' : undefined}
                  role="meter"
                  aria-label="How much of the cover has been used"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={term.percentUsed}
                  aria-valuetext={`${term.percentUsed} per cent of the term used`}
                >
                  <span className="elapsed" style={{ width: `${term.percentUsed}%` }} />
                </div>
                <div className="row-between tiny muted">
                  <span>Bought {formatDate(warranty.purchasedOn)}</span>
                  <span>
                    {lapsed ? 'Lapsed' : 'Ends'} {formatDate(warranty.expiresOn)}
                  </span>
                </div>
              </div>

              <div className="row-wrap">
                <Badge tone={lapsed ? 'neutral' : days <= EXPIRING_SOON_DAYS ? 'warn' : 'ok'}>
                  {lapsed ? `Lapsed ${describeDays(days)}` : days === 0 ? 'Lapses today' : `${days} days left`}
                </Badge>
                {warranty.transferable ? <Badge tone="info">Moves with the item</Badge> : null}
                <span className="tiny mono muted">{warranty.publicRef}</span>
              </div>
            </div>
          </Certificate>

        {lapsed ? (
          <Notice tone="neutral">
            This cover ran out on {formatDate(warranty.expiresOn)}. The record is kept so you can show what was
            covered and for how long, but a claim made now is outside the term.
          </Notice>
        ) : days <= EXPIRING_SOON_DAYS ? (
          <Notice tone="warn">
            Cover ends on {formatDate(warranty.expiresOn)} — {describeDays(days)}. If something is wrong with this
            item, raise it with {organization?.name ?? 'the merchant'} before then.
          </Notice>
        ) : null}

        </div>

        <aside className="object-detail-aside">
          <Card>
          <DefinitionList
            items={[
              ['Reference', <span key="r" className="mono">{warranty.publicRef}</span>],
              ['Merchant', organization?.name ?? 'Not recorded'],
              ['Bought', formatDate(warranty.purchasedOn)],
              ['Cover', `${warranty.months} month${warranty.months === 1 ? '' : 's'}`],
              ['Expires', formatDate(warranty.expiresOn)],
              ['Serial number', warranty.serialNumber ? <span key="s" className="mono">{warranty.serialNumber}</span> : 'Not recorded'],
              ...(warranty.coverageNote
                ? ([['What it covers', warranty.coverageNote]] as [React.ReactNode, React.ReactNode][])
                : []),
            ]}
          />
          </Card>

        {receipt ? (
          <Card>
            <Stack gap={3}>
              <h2 className="h3">The purchase it came from</h2>
              <p className="small muted">
                Receipt <span className="mono">{receipt.publicRef}</span> ·{' '}
                {formatMoney(receipt.totalMinor, receipt.currency)} on {formatDate(receipt.issuedAt)}. The warranty
                was derived from that receipt when it was issued, which is why these dates cannot move.
              </p>
              <div className="row-wrap">
                <ButtonLink href={`/receipts/${receipt.publicRef}`} size="sm" variant="primary">
                  Open the receipt
                </ButtonLink>
              </div>
            </Stack>
          </Card>
        ) : (
          <Notice tone="info">
            The receipt behind this warranty is no longer readable on this account, so only the warranty&apos;s own
            record is shown.
          </Notice>
        )}

        <Card className="card-flat">
          <Stack gap={2}>
            <p className="eyebrow">Reminders</p>
            <p className="small">
              {warranty.remindedAt
                ? `You were last reminded about this on ${formatDate(warranty.remindedAt)}.`
                : `${BRAND.name} reminds you once when a warranty is inside its final ${EXPIRING_SOON_DAYS} days. No reminder has been sent for this one.`}
            </p>
          </Stack>
        </Card>
        </aside>
      </div>
    </div>
  );
}
