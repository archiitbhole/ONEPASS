/**
 * Getting in, and getting out.
 *
 * Four properties: a wrong password produces a message and no navigation (a
 * client that redirected optimistically would be lying), a right one lands on
 * the consumer home at `/home`, the sign-out control ends the session, and a
 * signed-out browser cannot reach a screen that would render somebody's tickets.
 *
 * Two things shape the structure. `auth:login:identifier` allows eight attempts
 * per fifteen minutes, so the form tests share one page rather than signing in
 * afresh in each, and they spread themselves across the seeded accounts so one
 * test's failed attempt does not eat another's budget. And sign-out lives in its
 * own group, signed in through the helper rather than the form, so a regression
 * in the form cannot quietly stop sign-out from being tested at all.
 */
import { test, expect, type Page } from '@playwright/test';
import { SAMPLE_PASSWORD, fixtures, forgetSession, signIn } from './helpers';
import { BRAND } from '../src/lib/brand';

/** A seeded consumer nothing else in the suite holds a session for. */
const SPARE_ACCOUNT = 'rahul@example.in';

test.describe('the sign-in form', () => {
  test.describe.configure({ mode: 'serial' });

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('a wrong password shows the error and stays on the form', async () => {
    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(SPARE_ACCOUNT);
    await page.getByLabel('Password').fill('not-the-password');
    await page.getByRole('button', { name: 'Sign in' }).click();

    // The server's own words, in the form's own alert. Next mounts a route
    // announcer with role="alert" too, which is not the one being asserted on.
    await expect(page.locator('[role="alert"].notice-bad')).toContainText(
      'That email or password is not right.',
    );

    // Still here. Nothing optimistic happened.
    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(page.getByLabel('Password')).toBeVisible();
  });

  test('the right password lands on the consumer home', async () => {
    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(fixtures().consumerEmail);
    await page.getByLabel('Password').fill(SAMPLE_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();

    // The form pushes to its `next`, which defaults to `/`, and `/` sends a
    // signed-in person on to `/home`. Waiting for `/home` rather than `/` is the
    // assertion: this navigation used to stop on the marketing page, because a
    // consumer home at `(app)/page.tsx` collided with the landing page at
    // `page.tsx` and Next resolved the collision in favour of the landing page.
    await page.waitForURL(/\/home$/);

    // The consumer shell, addressed to the person who signed in — not the
    // marketing landing page, which is what an unauthenticated visitor gets.
    //
    // The name is asserted on the pass card rather than on the h1. The heading
    // names the page and the card names the holder, which is the right way
    // round: the name on a pass is what a counter reads off it.
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Your ${BRAND.name}`);
    // The pass object itself, found by its accessible name rather than by a
    // class: the markup underneath it changed when the pass became a drawn
    // object, and what this test is about — that the holder's name is on the
    // thing a counter looks at — did not.
    await expect(page.getByRole('link', { name: new RegExp(`Your ${BRAND.name} pass`) })).toContainText(
      'Meera Kulkarni',
    );

    // And the landing page is genuinely not what is on screen. The heading check
    // above would already fail on it, but naming the marketing section says which
    // of the two pages this test is about.
    await expect(page.getByRole('region', { name: 'Live ecosystem' })).toHaveCount(0);
  });
});

test.describe('signing out', () => {
  test('the sign-out control returns you to the sign-in screen', async ({ page, context }) => {
    // A confirm() guards the destructive controls on the profile screen.
    page.on('dialog', (dialog) => void dialog.accept());

    // Signed in through the API rather than the form: this test is about the
    // sign-out control, and it uses the spare account so that ending its session
    // cannot disturb the sessions the rest of the suite is holding.
    await signIn(context, SPARE_ACCOUNT);

    await page.goto('/profile');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Rahul Nair');

    await page.getByRole('button', { name: 'Sign out here' }).click();

    await page.waitForURL(/\/sign-in/);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

    // And the session is genuinely gone, not merely navigated away from.
    await page.goto('/pass');
    await expect(page).toHaveURL(/\/sign-in/);

    // The session this test ended is still in the helper's cache. Other specs
    // use the spare account too, and must be given a live one.
    forgetSession(SPARE_ACCOUNT);
  });
});

test.describe('the guard on the consumer shell', () => {
  test('a signed-out request to /pass is redirected to sign-in', async ({ page }) => {
    await page.goto('/pass');

    await expect(page).toHaveURL(/\/sign-in/);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    // Nothing of the pass leaked into the redirect.
    await expect(page.getByText('Code rolls every')).toHaveCount(0);
  });
});

/**
 * The three screens beyond the door.
 *
 * None of them had a test until the flows behind them turned out not to work at
 * all: the code screen posted a field the endpoint does not read, and the
 * recovery screen posted a body with no discriminator, so a new account could
 * never confirm its address and a forgotten password could never be reset. Both
 * failures looked like a polite sentence in a red box, which is why nothing
 * noticed.
 *
 * What each test below asserts is the same shape of thing: that the *server's*
 * own words come back. A body the endpoint cannot parse produces "Some fields
 * need attention"; a body it can parse, with a wrong code in it, produces "That
 * code is not right". The second sentence is the evidence that the request was
 * understood — which is the property that was missing.
 */
test.describe('creating an account', () => {
  test.describe.configure({ mode: 'serial' });

  // Unique per run: registration is idempotent-looking by design (the reply is
  // the same whether or not the address is taken), so reusing an address would
  // make this pass without registering anything.
  const email = `e2e-signup-${Date.now()}@example.test`;

  test('sign-up hands over to the code screen, which reaches the endpoint', async ({ page }) => {
    await page.goto('/sign-up');
    await page.getByLabel('Your name').fill('Signup Check');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('a-long-enough-passphrase');
    await page.getByRole('button', { name: 'Create account' }).click();

    await page.waitForURL(/\/verify-code\?/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Enter your code');
    // The address is shown back, because a code sent to a typo is otherwise a
    // silent dead end.
    await expect(page.getByText(email)).toBeVisible();

    // A wrong code, to see whose words come back. "That code is not right" is
    // the verification flow answering; "Some fields need attention" would mean
    // the body never got past the schema — which is exactly what used to happen.
    await page.getByLabel('Six-digit code').fill('000000');
    await page.getByRole('button', { name: 'Confirm' }).click();

    await expect(page.locator('[role="alert"].notice-bad')).toContainText('That code is not right');
  });

  test('another code can be requested from the same screen', async ({ page }) => {
    await page.goto(`/verify-code?email=${encodeURIComponent(email)}&purpose=EMAIL_VERIFY`);
    await page.getByRole('button', { name: 'Send another code' }).click();

    // Anti-enumeration wording, and a 202 — not a validation error.
    await expect(page.getByText('If that address needs a code')).toBeVisible();
    // And the button goes quiet for a moment, so nobody walks into the limiter
    // by pressing it four times.
    await expect(page.getByRole('button', { name: /Send another code in \d+s/ })).toBeDisabled();
  });
});

test.describe('recovering a forgotten password', () => {
  test('the first step advances to the second, and the second reaches the endpoint', async ({ page }) => {
    await page.goto('/recover');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Recover your account');

    // A seeded address. Asking for a reset code does not change the password, so
    // the rest of the suite is unaffected — and the code is never entered here.
    await page.getByLabel('Email').fill(fixtures().consumerEmail);
    await page.getByRole('button', { name: 'Send a code' }).click();

    // The screen that did not exist. Before the fix this stayed on step one with
    // "Some fields need attention", because the body had no `step`.
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Set a new password');
    await expect(page.getByLabel('Six-digit code')).toBeVisible();
    await expect(page.getByLabel('New password')).toBeVisible();

    await page.getByLabel('Six-digit code').fill('000000');
    await page.getByLabel('New password').fill('a-brand-new-passphrase');
    await page.getByRole('button', { name: 'Change password' }).click();

    // The completion step was understood and refused on its merits.
    await expect(page.locator('[role="alert"].notice-bad')).toContainText('That code is not right');
  });

  test('the copy promises a code, because a code is what is sent', async ({ page }) => {
    await page.goto('/recover');
    await expect(page.getByText('we will send a six-digit code')).toBeVisible();
    // The old screen said a reset *link* was on its way. There is no link.
    await expect(page.getByText('reset link')).toHaveCount(0);
  });
});

test.describe('the password field', () => {
  test('reveals what was typed, and says so', async ({ page }) => {
    await page.goto('/sign-in');
    const field = page.getByLabel('Password');
    await field.fill('a-long-enough-passphrase');
    await expect(field).toHaveAttribute('type', 'password');

    const toggle = page.getByRole('button', { name: 'Reveal what you typed' });
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');

    await toggle.click();
    await expect(field).toHaveAttribute('type', 'text');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');

    await toggle.click();
    await expect(field).toHaveAttribute('type', 'password');
  });
});
