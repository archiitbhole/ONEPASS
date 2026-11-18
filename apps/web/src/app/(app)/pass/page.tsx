/**
 * The identity screen.
 *
 * One rotating code, big enough to scan across a counter, with the window it
 * is good for drawn around it. The token is minted here, on the server, from a
 * secret that is sealed at rest and never leaves the process; what reaches the
 * browser is a matrix of black and white squares that stops verifying in
 * thirty seconds.
 *
 * The page opts out of caching entirely. A cached pass screen is a screen
 * showing a code that has already rolled — worse than no screen at all,
 * because the person holds it up and it fails.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { ButtonLink, Card, Empty, Notice, Stack } from '@/components/ui';
import { Glyph } from '@/components/icons';
import { PassCanvas } from '@/components/consumer/pass-canvas';
import { PassHero } from '@/components/consumer/pass-hero';
import { qrRows } from '@/components/consumer/qr';
import { mintPassToken } from '@/lib/pass/service';
import { currentActor } from '../_queries';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = {
  title: 'Your pass',
  description: `The rotating ${BRAND.name} code you show at a counter.`,
};

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function PassPage() {
  const actor = await currentActor();

  const minted = await mintPassToken(actor.userId).then(
    (m) => ({ ok: true as const, ...m }),
    (err: unknown) => ({ ok: false as const, message: err instanceof Error ? err.message : 'No pass found.' }),
  );

  if (!minted.ok) {
    return (
      <div className="wrap-narrow">
        <Stack gap={5}>
          <h1 className="display h1">Your pass</h1>
          <Card>
            <Empty
              title="No active pass on this account"
              body={minted.message}
              action={<ButtonLink href="/settings">Check your account</ButtonLink>}
            />
          </Card>
        </Stack>
      </div>
    );
  }

  // Error correction M: the code is shown on a bright screen at close range,
  // so the extra redundancy of Q would only make the modules smaller for no gain.
  const rows = qrRows(minted.token, 'M');

  return (
    <div className="wrap-narrow pass-screen">
      <Stack gap={5}>
        {/* No page heading above the pass. The name is on the pass, and a
            heading repeating it put the person's name on screen twice before
            they reached the thing they opened the screen for. */}
        <h1 className="sr-only">Your pass</h1>

        <PassHero
          holderName={actor.displayName}
          passRef={minted.passRef}
          footer={
            <span className="pass-meta" style={{ textAlign: 'right' }}>
              Rotates every
              <br />
              {minted.stepSeconds} seconds
            </span>
          }
        >
          <PassCanvas
            rows={rows}
            expiresInSeconds={minted.expiresInSeconds}
            stepSeconds={minted.stepSeconds}
            framed={false}
            /* Larger than anywhere else in the product. This screen is held at
               arm's length toward a scanner, often at an angle, and every
               module the camera gains is a read it does not have to retry. */
            maxCssPx={400}
          />
        </PassHero>

        <Notice tone="info">
          <Glyph name="shield" size={18} />
          <span>
            The code changes every {minted.stepSeconds} seconds and can only be spent once at each counter. A
            screenshot is worthless within one window — but if you think someone has captured your pass, reissue it
            from <Link href="/profile">your account security</Link>, which retires every code ever shown.
          </span>
        </Notice>

        <Card>
          <Stack gap={3}>
            <h2 className="h3">What a counter sees</h2>
            <p className="small muted">
              The reader checks the signature, the freshness and whether this pass has already been used at that
              till. It never receives your name, your number or your history — a partner only learns what you have
              consented to share with them.
            </p>
            <div className="row-wrap">
              <ButtonLink href="/disclosures" size="sm">
                What partners have seen
              </ButtonLink>
              <ButtonLink href="/tickets" size="sm" variant="ghost">
                Tickets
              </ButtonLink>
            </div>
          </Stack>
        </Card>
      </Stack>
    </div>
  );
}
