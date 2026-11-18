/**
 * Your products — the things you own now, and how they came to you (D-007).
 *
 * Built from product instances, not receipts: after a resale the receipt stays
 * with whoever bought it and the item moves to whoever owns it, and those are
 * different screens for different people. Warranty cover is shown with whose
 * name it is under, because "covered" and "covered for you" stop being the same
 * thing the moment an item changes hands.
 *
 * Each item is a shelf tile rather than a row in a list, because the thing on
 * the screen is an object somebody owns — and the two facts that matter about
 * it, where it came from and whether it is still covered, are stated on the
 * tile rather than left to be inferred from a date.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, ButtonLink, Card, Empty, PageHead, Stat, formatDate } from '@/components/ui';
import { Glyph } from '@/components/icons';
import { ClaimProduct, TransferProduct } from '@/components/consumer/product-actions';
import { listOwnedProducts } from '@/lib/products/ownership';
import { currentActor } from '../_queries';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = {
  title: 'Your products',
  description: 'What you own, its cover, and handing it on.',
};

export const dynamic = 'force-dynamic';

export default async function ProductsPage() {
  const actor = await currentActor();
  const products = await listOwnedProducts(actor.userId);

  const covered = products.filter((p) => p.warranty?.yours).length;
  const received = products.filter((p) => p.acquiredVia !== 'PURCHASE').length;

  return (
    <div className="wrap stack stack-6">
      <PageHead
        eyebrow="Ownership"
        title="Your products"
        lede="Things you own, from receipts that name them. Selling or giving one away moves it — and its warranty, where the seller’s terms allow — to the new owner’s account."
        actions={
          <ButtonLink href="/warranties" size="sm" variant="ghost">
            Cover on them
          </ButtonLink>
        }
      />

      {products.length > 0 ? (
        <section className="stat-row" aria-label="What you own">
          <Stat label="Items" value={products.length} hint="One row per thing, not per receipt." />
          <Stat
            label="Covered for you"
            value={covered}
            hint="Cover that follows the item stays with whoever owns it; cover tied to the buyer does not."
          />
          <Stat label="Handed to you" value={received} hint="Transferred from another account rather than bought." />
        </section>
      ) : null}

      {products.length === 0 ? (
        <Card>
          <Empty
            title="No products yet"
            body={`A purchase with a warranty or a serial number appears here once the shop issues its receipt through ${BRAND.name}.`}
            action={
              <ButtonLink href="/receipts" variant="primary">
                See your receipts
              </ButtonLink>
            }
          />
        </Card>
      ) : (
        <ul className="shelf shelf-wide stagger" aria-label="Products you own">
          {products.map((product) => (
            <Card as="li" key={product.reference} className="stack stack-4">
              <div className="row" style={{ alignItems: 'flex-start', gap: 'var(--s-3)' }}>
                <span className="holding-mark" style={{ marginBottom: 0 }} aria-hidden="true">
                  <Glyph name="product" size={18} />
                </span>
                <div className="grow" style={{ minWidth: 0 }}>
                  <h2 className="h3">{product.name}</h2>
                  <p className="small muted" style={{ marginTop: 2 }}>
                    {product.acquiredVia === 'PURCHASE' ? 'Bought' : 'Received'}{' '}
                    {formatDate(new Date(product.acquiredAt))}
                    {product.seller ? ` · sold by ${product.seller}` : ''}
                  </p>
                  {product.serialNumber ? (
                    <p className="tiny mono muted" style={{ marginTop: 4 }}>
                      Serial {product.serialNumber}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="row-wrap">
                <Badge tone={product.acquiredVia === 'PURCHASE' ? 'neutral' : 'info'}>
                  {product.acquiredVia === 'PURCHASE' ? 'Bought' : 'Transferred to you'}
                </Badge>
                {product.warranty ? (
                  product.warranty.yours ? (
                    <Badge tone="ok">
                      <Glyph name="shield" size={13} />
                      Covered to {formatDate(product.warranty.expiresOn)}
                    </Badge>
                  ) : (
                    <Badge tone="neutral">Cover stayed with the original buyer</Badge>
                  )
                ) : (
                  <Badge tone="neutral">No warranty recorded</Badge>
                )}
              </div>

              <div className="row-wrap">
                {product.warranty?.yours && product.warranty.reference ? (
                  <Link className="small" href={`/warranties/${product.warranty.reference}`}>
                    The warranty →
                  </Link>
                ) : null}
                {product.receiptRef ? (
                  <Link className="small" href={`/receipts/${product.receiptRef}`}>
                    The receipt →
                  </Link>
                ) : null}
              </div>

              <TransferProduct
                productRef={product.reference}
                name={product.name}
                pendingRef={product.pendingTransfer?.reference ?? null}
                warrantyNote={
                  product.warranty?.yours
                    ? product.warranty.transferable
                      ? 'Its warranty will go with it.'
                      : 'Its warranty will not go with it: the seller’s terms tie cover to you.'
                    : null
                }
              />
            </Card>
          ))}
        </ul>
      )}

      <section className="stack stack-3" aria-labelledby="claim-heading">
        <div className="section-head">
          <h2 id="claim-heading">Received something?</h2>
        </div>
        <Card>
          <ClaimProduct />
        </Card>
      </section>
    </div>
  );
}
