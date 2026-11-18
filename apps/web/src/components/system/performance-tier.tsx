'use client';

/**
 * Decide, once, how much the device can afford — and say so on <html>.
 *
 *   full      a capable desktop: pointer-lit objects, ambient drift, blur
 *   standard  the default, and what a page is before this runs
 *   lite      reduced motion, data saver, or a constrained device: no blur,
 *             no grain, no continuous motion, no foil
 *
 * The page is complete and correct in all three; the tier only decides which
 * extras are worth their cost. It is read from signals the browser already
 * exposes, never from a user-agent string, and re-evaluated when the person
 * changes their motion preference while the page is open.
 */
import { useEffect } from 'react';

type NavigatorHints = Navigator & {
  deviceMemory?: number;
  connection?: { saveData?: boolean; effectiveType?: string };
};

function decide(): 'full' | 'standard' | 'lite' {
  const nav = navigator as NavigatorHints;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const saveData = nav.connection?.saveData === true || /(^|-)2g$/.test(nav.connection?.effectiveType ?? '');
  const cores = nav.hardwareConcurrency ?? 4;
  const memory = nav.deviceMemory ?? 4;
  if (reduced || saveData || cores <= 2 || memory <= 2) return 'lite';

  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const roomy = window.innerWidth >= 1024;
  if (finePointer && roomy && cores >= 6 && memory >= 4) return 'full';
  return 'standard';
}

export function PerformanceTier() {
  useEffect(() => {
    const apply = () => {
      document.documentElement.dataset.tier = decide();
    };
    apply();
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    motion.addEventListener('change', apply);
    return () => motion.removeEventListener('change', apply);
  }, []);
  return null;
}
