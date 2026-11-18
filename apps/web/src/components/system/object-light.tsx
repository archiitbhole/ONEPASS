'use client';

/**
 * Light that follows the pointer across an object.
 *
 * On a capable desktop (`data-tier="full"`), moving the pointer over a pass or
 * a certificate tilts it a few degrees and slides its foil, the way a real card
 * catches a lamp as you turn it. That is the whole effect: it tells a person
 * this is an object, not a panel. Elsewhere — touch, reduced motion, the lite
 * tier — it does nothing and the object rests at its fixed angle.
 *
 * Writes two CSS variables on the element per animation frame at most, and
 * only transforms: no layout is read or written while the pointer moves.
 */
import { useEffect, useRef, type ReactNode } from 'react';

export function ObjectLight({ children, strength = 6 }: { children: ReactNode; strength?: number }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = ref.current;
    const el = host?.firstElementChild as HTMLElement | null;
    if (!host || !el) return;

    let frame = 0;
    let rect: DOMRect | null = null;
    const enter = (e: PointerEvent) => {
      // Asked on every entry rather than once: the tier is decided after
      // hydration, and can drop to lite if motion is reduced mid-session.
      if (e.pointerType !== 'mouse' || document.documentElement.dataset.tier !== 'full') return;
      rect = el.getBoundingClientRect();
      el.dataset.lit = 'true';
    };
    const move = (e: PointerEvent) => {
      if (!rect || frame) return;
      const { clientX, clientY } = e;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!rect) return;
        const x = (clientX - rect.left) / rect.width;
        const y = (clientY - rect.top) / rect.height;
        el.style.setProperty('--tilt-y', `${((x - 0.5) * strength).toFixed(2)}deg`);
        el.style.setProperty('--tilt-x', `${((0.5 - y) * strength).toFixed(2)}deg`);
        el.style.setProperty('--foil-x', `${(20 + x * 60).toFixed(1)}%`);
        el.style.setProperty('--foil-y', `${(20 + y * 60).toFixed(1)}%`);
      });
    };
    const leave = () => {
      rect = null;
      delete el.dataset.lit;
      el.style.removeProperty('--tilt-x');
      el.style.removeProperty('--tilt-y');
      el.style.removeProperty('--foil-x');
      el.style.removeProperty('--foil-y');
    };
    host.addEventListener('pointerenter', enter);
    host.addEventListener('pointermove', move);
    host.addEventListener('pointerleave', leave);
    return () => {
      cancelAnimationFrame(frame);
      host.removeEventListener('pointerenter', enter);
      host.removeEventListener('pointermove', move);
      host.removeEventListener('pointerleave', leave);
    };
  }, [strength]);

  return (
    <div ref={ref} className="object-light">
      {children}
    </div>
  );
}
