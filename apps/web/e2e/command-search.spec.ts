/**
 * The command palette.
 *
 * The consumer app has thirty-three screens and a bar that holds seven, so for
 * most of the app this is the way in. Four things have to be true for that to be
 * worth anything: it opens from the keyboard and from a control somebody can
 * see, it finds screens by name, it finds the person's *own* records, and it
 * gives focus back when it closes — and only then: it must not take focus on a
 * page load that never opened it. Each has a test below.
 *
 * The record search runs against the seeded Pune ecosystem — the kettle with a
 * warranty on it is Meera's, and it is the fixture the warranty screens already
 * rely on, so nothing here needs its own seed.
 */
import { test, expect } from '@playwright/test';
import { fixtures, signIn } from './helpers';

/**
 * Wait until the shell's key handler exists.
 *
 * The shortcuts are a `keydown` listener on `window`, and a listener does not
 * exist until the shell has hydrated. Pressing a key before then does nothing,
 * which fails a test for a reason that has nothing to do with the shortcut —
 * and does so intermittently, because the production bundle hydrates a beat
 * later than the dev server. Opening the palette with the visible control and
 * closing it again is a deterministic signal that the component is live.
 */
async function waitForShortcuts(page: import('@playwright/test').Page) {
  const dialog = page.getByRole('dialog', { name: 'Search ONEPASS' });
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  return dialog;
}

test.describe('the command palette', () => {
  test.beforeEach(async ({ context }) => {
    await signIn(context, fixtures().consumerEmail);
  });

  test('a page load leaves focus alone, so the first Tab reaches “Skip to content”', async ({ page }) => {
    await page.goto('/home');
    // Wait for hydration rather than for time: React tags the nodes it has
    // hydrated, and the bug this guards against ran in an effect after that.
    await page.waitForFunction(() => {
      const trigger = document.querySelector('.op-search-trigger');
      return !!trigger && Object.keys(trigger).some((key) => key.startsWith('__react'));
    });

    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('BODY');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  });

  test('opens on the keyboard and goes to a screen by name', async ({ page }) => {
    await page.goto('/home');

    const dialog = await waitForShortcuts(page);

    // Ctrl-K rather than ⌘K: this runs on Linux, and the handler takes either.
    await page.keyboard.press('Control+k');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('combobox')).toBeFocused();

    await page.keyboard.type('warrant');
    // "Warranties" is the only screen matching, so it is the first option and
    // Enter takes it. The keywords behind it — guarantee, cover, repair — are
    // what make a typed word find a screen it does not literally name.
    await expect(dialog.getByRole('option').first()).toContainText('Warranties');
    await page.keyboard.press('Enter');

    await page.waitForURL(/\/warranties$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Warranties');
  });

  test('opens on slash, and finds a screen by a word that is not its name', async ({ page }) => {
    await page.goto('/home');
    const dialog = await waitForShortcuts(page);

    await page.keyboard.press('/');
    await expect(dialog).toBeVisible();

    // Nobody calls it "Returns" when they want their money back.
    await page.keyboard.type('refund');
    await expect(dialog.getByRole('option').first()).toContainText('Returns');
  });

  test('finds the holder’s own records, not just screens', async ({ page }) => {
    await page.goto('/home');
    await page.getByRole('button', { name: 'Search' }).click();

    const dialog = page.getByRole('dialog', { name: 'Search ONEPASS' });
    // The kettle is a warranty on Meera's account. No screen is called "kettle",
    // so a hit here can only have come from the server.
    await page.keyboard.type('kettle');

    const hit = dialog.getByRole('option').filter({ hasText: 'kettle' }).first();
    await expect(hit).toBeVisible({ timeout: 10_000 });
    await expect(hit).toContainText('Warranty');

    await hit.click();
    await page.waitForURL(/\/warranties\/wty_/);
  });

  test('closes on escape and hands focus back to the control that opened it', async ({ page }) => {
    await page.goto('/home');
    const trigger = page.getByRole('button', { name: 'Search' });
    await trigger.click();

    const dialog = page.getByRole('dialog', { name: 'Search ONEPASS' });
    await expect(dialog).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    // Focus left in the void is how a keyboard user loses their place entirely.
    await expect(trigger).toBeFocused();
  });

  test('is reachable on a phone, where there is no keyboard to press', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/home');

    const trigger = page.getByRole('button', { name: 'Search' });
    await expect(trigger).toBeVisible();

    const box = await trigger.boundingBox();
    // WCAG 2.5.8 wants 24×24. The trigger is the only way into the palette on a
    // touch screen, so it is the last control in the app that should be fiddly.
    expect(box!.height).toBeGreaterThanOrEqual(24);
    expect(box!.width).toBeGreaterThanOrEqual(24);

    await trigger.click();
    await expect(page.getByRole('dialog', { name: 'Search ONEPASS' })).toBeVisible();
  });
});
