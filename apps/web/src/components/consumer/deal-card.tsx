/**
 * One live deal, as it appears in a list.
 *
 * A deal is a window on real capacity at a real place, so the card leads with
 * the place: a poster drawn from the venue's kind and the offer's own public
 * reference, with the closing time printed across it. Everything under it is a
 * figure from `listLiveDeals` — price, list price, saving, remaining count —
 * read from the same rows, so the card can never advertise a seat that has
 * already gone.
 *
 * The card is a server component. The only client code inside it is the
 * countdown, and only because a deadline that does not move is not a deadline.
 *
 * Exactly one `.num` on the card, deliberately: the price is the figure, and a
 * second one beside it would make a person work out which number they are being
 * asked for.
 */
import Link from 'next/link';
import type { LiveDeal } from '@/lib/commerce/offers';
import { Badge, ButtonLink, Card, formatMoney } from '@/components/ui';
import { Poster } from '@/components/objects';
import { Countdown } from '@/components/consumer/countdown';
import { labelKind } from '@/components/consumer/format';

export function DealCard({ deal }: { deal: LiveDeal }) {
  const scarce = deal.remaining !== null && deal.remaining <= 5;

  return (
    // `fill-height` plus `push-end` on the action row below is what keeps a
    // grid of these tidy: descriptions differ in length, so without it the Book
    // buttons sit at four different heights across one row.
    <Card as="li" className="deal-card fill-height">
      <div className="deal-poster">
        <Poster
          kind={deal.venue?.kind ?? 'EVENT'}
          seed={deal.publicRef}
          city={deal.venue?.locality ?? null}
          ratio="21 / 9"
        />
        <span className="deal-clock">
          <Countdown endsAt={deal.endsAt.toISOString()} secondsRemaining={deal.secondsRemaining} />
        </span>
      </div>

      <div className="deal-body">
        {/* h2, not h3. `/deals` goes straight from its `h1` to these cards, so
            an h3 skipped a level — which for anyone navigating by headings reads
            as a missing section that is not there. The class keeps the size;
            only the level changes. */}
        <h2 className="h3">
          <Link href={`/deals/${deal.publicRef}`}>{deal.title}</Link>
        </h2>

        {deal.venue ? (
          <p className="small muted">
            {deal.venue.name}
            {deal.venue.locality ? ` · ${deal.venue.locality}` : ''} · {labelKind(deal.venue.kind)}
          </p>
        ) : null}

        {deal.description ? <p className="small deal-note">{deal.description}</p> : null}

        <div className="row-wrap deal-price">
          {deal.priceMinor !== null ? (
            <span className="num">{formatMoney(deal.priceMinor, deal.currency)}</span>
          ) : null}
          {deal.listPriceMinor !== null && deal.savedMinor > 0 ? (
            <span className="small muted deal-was">{formatMoney(deal.listPriceMinor, deal.currency)}</span>
          ) : null}
          {deal.savedMinor > 0 ? (
            <Badge tone="ok">Save {formatMoney(deal.savedMinor, deal.currency)}</Badge>
          ) : null}
          {deal.remaining !== null ? (
            <Badge tone={scarce ? 'warn' : 'neutral'}>
              {deal.remaining} of {deal.capacity ?? deal.remaining} left
            </Badge>
          ) : null}
        </div>

        <div className="row-wrap push-end">
          <ButtonLink href={`/deals/${deal.publicRef}`} variant="primary" size="sm">
            Book
          </ButtonLink>
          {deal.venue ? (
            <ButtonLink href={`/explore?q=${encodeURIComponent(deal.venue.name)}`} size="sm" variant="ghost">
              More here
            </ButtonLink>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
