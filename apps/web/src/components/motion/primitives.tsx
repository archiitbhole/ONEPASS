'use client';

/**
 * The motion vocabulary.
 *
 * Every animation that needs JavaScript goes through one of these. That is the
 * whole point: timings, easings and the reduced-motion decision live in one
 * file, so a screen cannot invent its own 600ms bounce and no component can
 * forget to check whether the person asked for less movement.
 *
 * **When not to use this.** Most motion in ONEPASS is a CSS transition or the
 * `.rise` / `.stagger` classes in system.css, and that is correct — fading in a
 * card does not need a JavaScript runtime, and every one of these components is
 * a client component that ships and hydrates. Reach for Motion when the
 * animation needs something CSS genuinely cannot do:
 *
 *   · exit animations — an element animating as it is removed
 *   · shared layout — an element that appears to move between two places
 *   · gestures — drag, or a press that tracks a finger
 *   · orchestration — a sequence whose steps depend on each other
 *   · interruption — a spring that re-targets mid-flight rather than restarting
 *
 * **Reduced motion is handled once, here.** `useReducedMotion()` reads the OS
 * setting, and each component below degrades to an instant state change rather
 * than a fast one. A 10ms animation is still an animation; somebody who set
 * that preference because movement makes them ill is not helped by speeding it
 * up.
 */

import {
  AnimatePresence,
  LayoutGroup,
  motion,
  useReducedMotion,
  type Transition,
  type Variants,
} from 'motion/react';
import { type ReactNode } from 'react';

/**
 * Timings, mirroring the --t-* and --ease-* tokens in system.css.
 *
 * Duplicated in JavaScript because Motion cannot read a CSS custom property,
 * and the two files name the same four values so they cannot drift apart
 * unnoticed.
 */
export const DURATION = { instant: 0.09, fast: 0.16, base: 0.24, slow: 0.38 } as const;
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;
export const EASE_SOFT = [0.4, 0, 0.2, 1] as const;

/** For anything that should feel physical — a pass card, a drawer. */
export const SPRING: Transition = { type: 'spring', stiffness: 420, damping: 34, mass: 0.9 };

const ENTER: Variants = {
  hidden: { opacity: 0, y: 10 },
  shown: { opacity: 1, y: 0 },
};

/**
 * Fade and rise on mount.
 *
 * **This is not for scroll reveals.** Use the `.reveal` class from system.css
 * for those, and the reason is correctness rather than taste. A JavaScript
 * scroll reveal sets the element to `opacity: 0` and waits for an observer to
 * say it is on screen. If the script is slow, blocked, or has not hydrated
 * yet, the content stays invisible — while still sitting in the accessibility
 * tree and still being indexed. It also means nothing below the fold exists in
 * a full-page screenshot or a print, because none of it was ever "in view".
 * The first version of the landing page did exactly this, and three of its four
 * sections rendered blank.
 *
 * The CSS version rests *visible* and layers the animation on top only where
 * `animation-timeline: view()` can drive it, which is the right way round.
 *
 * What remains here is the case CSS genuinely cannot cover: an element that
 * should animate the moment it mounts, mid-session, because something just
 * happened.
 */
export function Reveal({
  children,
  delay = 0,
  y = 10,
  className,
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  className?: string;
}) {
  const still = useReducedMotion();

  if (still) return <div className={className}>{children}</div>;

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DURATION.slow, ease: EASE_OUT, delay }}
    >
      {children}
    </motion.div>
  );
}

/**
 * Stagger a list of children in.
 *
 * The CSS `.stagger` class does this with no JavaScript and should be preferred
 * for a static list. This exists for lists whose contents change — where items
 * need to animate out as well as in, which CSS cannot do.
 */
export function Stagger({
  children,
  step = 0.04,
  className,
}: {
  children: ReactNode;
  step?: number;
  className?: string;
}) {
  const still = useReducedMotion();
  if (still) return <div className={className}>{children}</div>;

  return (
    <motion.div
      className={className}
      initial="hidden"
      animate="shown"
      variants={{ shown: { transition: { staggerChildren: step } } }}
    >
      {children}
    </motion.div>
  );
}

/** One child of a `Stagger`. */
export function StaggerItem({ children, className }: { children: ReactNode; className?: string }) {
  const still = useReducedMotion();
  if (still) return <div className={className}>{children}</div>;

  return (
    <motion.div
      className={className}
      variants={ENTER}
      transition={{ duration: DURATION.base, ease: EASE_OUT }}
    >
      {children}
    </motion.div>
  );
}

/**
 * A number that counts to its value.
 *
 * Deliberately not a general-purpose ticker. It animates only on mount and only
 * over a short window, because a figure that is still climbing when somebody
 * tries to read it is worse than one that was simply printed. The final value
 * is rendered immediately under reduced motion, and the element carries the
 * real number as its accessible text throughout so a screen reader never
 * announces a half-finished figure.
 */
export function CountUp({
  value,
  format,
  className,
}: {
  value: number;
  /** Formatter for the displayed text. Defaults to en-IN grouping. */
  format?: (n: number) => string;
  className?: string;
}) {
  const still = useReducedMotion();
  const render = format ?? ((n: number) => new Intl.NumberFormat('en-IN').format(Math.round(n)));
  const final = render(value);

  if (still || value === 0) {
    return <span className={className}>{final}</span>;
  }

  return (
    <motion.span
      className={className}
      // The accessible name is the finished value from the first frame; only
      // the visible text counts.
      aria-label={final}
      initial={{ opacity: 0.4 }}
      animate={{ opacity: 1 }}
      transition={{ duration: DURATION.base }}
    >
      <motion.span
        aria-hidden="true"
        initial={{ '--n': 0 } as never}
        animate={{ '--n': value } as never}
        transition={{ duration: 0.9, ease: EASE_OUT }}
      >
        {final}
      </motion.span>
    </motion.span>
  );
}

/**
 * Mount/unmount with an exit animation.
 *
 * This is the thing CSS cannot do on its own: React removes a node from the
 * tree the moment it stops being rendered, so without `AnimatePresence` there
 * is nothing left to animate out.
 */
export function Presence({ children }: { children: ReactNode }) {
  return <AnimatePresence mode="wait">{children}</AnimatePresence>;
}

/** One presence child. `key` on this element is what triggers the swap. */
export function PresenceItem({
  children,
  className,
  id,
}: {
  children: ReactNode;
  className?: string;
  id: string;
}) {
  const still = useReducedMotion();

  if (still) {
    return (
      <div className={className} key={id}>
        {children}
      </div>
    );
  }

  return (
    <motion.div
      key={id}
      className={className}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: DURATION.fast, ease: EASE_OUT }}
    >
      {children}
    </motion.div>
  );
}

export { AnimatePresence, LayoutGroup, motion, useReducedMotion };
