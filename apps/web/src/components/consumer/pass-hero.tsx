/**
 * The pass, opened.
 *
 * `/home` shows the card at rest — whose it is, that it is active, one tap
 * away. This is the other end of that gesture: the same stock, portrait, with
 * the live code as the whole point of the screen. Both are the `Pass` object
 * from components/objects, so tapping one produces the other rather than a
 * different screen that happens to contain a QR code; the shared
 * `view-transition-name` is what makes it travel.
 *
 * **The code is the hero and everything else defers to it.** A pass screen is
 * used at arm's length, held toward a scanner, often at a bad angle in bad
 * light — so the matrix sits on a plain white plate at the largest size the
 * viewport allows, with the countdown immediately under it and every other
 * fact below the fold of a glance. Anything decorative near the code is
 * contrast the camera has to fight.
 *
 * A server component. The countdown and the canvas are `PassCanvas`, the only
 * client code here.
 */
import type { ReactNode } from 'react';
import { Guilloche, Microprint, Pass } from '@/components/objects';

export function PassHero({
  holderName,
  passRef,
  status = 'Live code',
  footer,
  children,
}: {
  holderName: string;
  passRef: string;
  status?: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="pass-open land" aria-label={`Your pass, ${holderName}`} style={{ viewTransitionName: 'pass' }}>
      <Guilloche seed={passRef} />
      <Pass.Top status={status} />
      <div className="pass-plate">{children}</div>
      <div className="pass-open-foot">
        <div>
          <p className="pass-meta">Holder</p>
          <p className="pass-name" style={{ fontSize: 'clamp(17px, 5vw, 22px)' }}>
            {holderName}
          </p>
          <p className="pass-ref">{passRef}</p>
        </div>
        {footer}
      </div>
      <Microprint />
    </section>
  );
}
