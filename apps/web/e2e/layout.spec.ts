/**
 * Every consumer page sits inside the same container.
 *
 * `(app)/layout.tsx` supplies vertical rhythm and nothing else — the horizontal
 * container is each page's own `.wrap`. That is a reasonable arrangement and it
 * has one obvious failure mode: a page that forgets. `/city-pass` and
 * `/explore-quests` both did, and rendered edge to edge beside neighbours with
 * gutters, which reads as a broken page rather than a different one.
 *
 * Nobody notices that in review, because each page looks fine on its own. It is
 * only visible next to another one — or here, where the measurement is taken
 * against a control that is definitely correct.
 *
 * **One test per page, generated.** This was originally two tests that each
 * looped over the whole list. That was fine at fifteen pages and stopped being
 * fine at two dozen: on a dev server every first visit also pays for compiling
 * the route, so the loop outgrew any timeout worth setting — and a timeout
 * reported "the container test failed" rather than naming a page. A test per
 * page gives each one its own budget, and makes a failure say *which* page,
 * which is the whole value of the check.
 */
import { test, expect } from '@playwright/test';
import { fixtures, signIn } from './helpers';

/** Every consumer route that renders a page of its own. */
const PAGES = [
  '/home',
  '/pass',
  '/tickets',
  '/bookings',
  '/deals',
  '/explore',
  '/wallet',
  '/savings',
  '/receipts',
  '/warranties',
  '/returns',
  '/gifts',
  '/split',
  '/city-pass',
  '/explore-quests',
  '/plan',
  '/travel',
  '/travel/flights',
  '/travel/stay',
  '/travel/trips',
  '/travel/airindex',
  '/travel/airindex/routes',
  '/travel/airindex/methodology',
  '/travel/rewards',
  '/travel/discounts',
  '/profile',
  '/help',
];

test.describe('consumer page container', () => {
  for (const path of PAGES) {
    test(`${path} renders inside the page container`, async ({ page }) => {
      await signIn(page.context(), fixtures().consumerEmail);
      await page.goto(path);
      await expect(page.getByRole('main')).toBeVisible();

      // The topbar's own `.wrap` is the control: it is on every page, it is
      // definitely inside the container, and it moves with the viewport — so
      // comparing against it tests the relationship rather than a magic number.
      const measured = await page.evaluate(() => {
        const reference = document.querySelector('header .wrap');
        const main = document.querySelector('main');
        if (!reference || !main) return null;

        // The union of every direct child that actually occupies space. Taking
        // `firstElementChild` alone measured a zero-size node on four pages —
        // a style element or an empty live region — and reported 0…0px, which
        // is not "outside the container", it is "nothing measured".
        const boxes = [...main.children]
          .map((el) => el.getBoundingClientRect())
          .filter((r) => r.width > 0 && r.height > 0);
        if (boxes.length === 0) return null;

        const a = reference.getBoundingClientRect();
        return {
          referenceLeft: a.left,
          referenceRight: a.right,
          contentLeft: Math.min(...boxes.map((r) => r.left)),
          contentRight: Math.max(...boxes.map((r) => r.right)),
        };
      });

      expect(measured, `${path} rendered no main content to measure`).not.toBeNull();

      // A page inside the container starts no further left than the topbar and
      // ends no further right. A page that forgot `.wrap` starts at 0.
      const tolerance = 1;
      const detail = `${path} — content spans ${Math.round(measured!.contentLeft)}…${Math.round(
        measured!.contentRight,
      )}px, container is ${Math.round(measured!.referenceLeft)}…${Math.round(measured!.referenceRight)}px`;

      expect(measured!.contentLeft, detail).toBeGreaterThanOrEqual(measured!.referenceLeft - tolerance);
      expect(measured!.contentRight, detail).toBeLessThanOrEqual(measured!.referenceRight + tolerance);
    });
  }
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const path of PAGES) {
    test(`${path} does not scroll sideways at 390px`, async ({ page }) => {
      await signIn(page.context(), fixtures().consumerEmail);
      await page.goto(path);

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      // A table or a code block scrolls inside its own box. The page must not.
      expect(overflow, `${path} scrolls horizontally by ${overflow}px`).toBeLessThanOrEqual(1);
    });
  }
});
