/**
 * Reading a driver error, without reading its prose.
 *
 * Several places in this codebase let the database enforce a rule and catch the
 * violation rather than checking first — a redemption cap is a unique index, a
 * replay check is a unique index. That is deliberate (see
 * `docs/service-conventions.md`): an application check passes twice under
 * concurrency and a constraint does not. It only works if the catch can tell
 * *which* violation it caught.
 *
 * **Why this module exists.** Both call sites used to do that themselves, and
 * both broke on the same upgrade. `drizzle-orm` 0.45 wraps every driver failure
 * in a `DrizzleQueryError` whose message is `Failed query: …` and whose `code`
 * is `undefined`; the real `PostgresError`, with its `code` and
 * `constraint_name`, moved to `cause`. So:
 *
 *   · `pass/service.ts` matched `message.includes('duplicate key')`. There the
 *     index *is* the check — nothing counts presentations first — so a second
 *     presentation of the same code at the same counter stopped being a refusal
 *     and became a 500. A test caught it.
 *   · `commerce/offers.ts` checked `err.code === '23505'` — correct against the
 *     old shape, silently always false against the new one. Its blast radius is
 *     smaller and worth stating precisely: the redemption cap is checked in the
 *     application first, by counting under `.for('update')` on the offer row,
 *     and that is what the suite exercises and what still worked. The index
 *     catch behind it is the concurrency backstop. So the cap was never
 *     unenforced — Postgres would still have refused the row — but the refusal
 *     degraded from a 409 saying "You have already used this offer." to an
 *     unhandled 500. No test covers that path, because provoking it means
 *     beating a row lock.
 *
 * The lesson is in the second: matching by SQLSTATE was already the right idea,
 * and it still broke, because *where* the driver puts the code is the driver's
 * business and it changed. So this walks the cause chain instead of trusting a
 * shape, and `errors.test.ts` pins the behaviour against a real Postgres round
 * trip rather than a hand-built object — a fake error would agree with whatever
 * this file believes and would not have caught either regression.
 */

/** Unique violation. The only SQLSTATE this codebase branches on today. */
export const UNIQUE_VIOLATION = '23505';

interface PgErrorish {
  code?: unknown;
  constraint_name?: unknown;
  constraint?: unknown;
}

/**
 * Walk `err` and its `cause` chain, newest first, yielding anything that could
 * carry a SQLSTATE. Bounded, because a cause chain is data and a cycle in it
 * should not hang a request.
 */
function* chain(err: unknown): Generator<PgErrorish> {
  let current: unknown = err;
  for (let depth = 0; depth < 8 && typeof current === 'object' && current !== null; depth++) {
    yield current as PgErrorish;
    current = (current as { cause?: unknown }).cause;
  }
}

/** The SQLSTATE behind this error, wherever the driver decided to put it. */
export function sqlStateOf(err: unknown): string | null {
  for (const link of chain(err)) {
    if (typeof link.code === 'string' && /^[0-9A-Z]{5}$/.test(link.code)) return link.code;
  }
  return null;
}

/** The constraint that was violated, when the driver named one. */
export function violatedConstraint(err: unknown): string | null {
  for (const link of chain(err)) {
    const named = link.constraint_name ?? link.constraint;
    if (typeof named === 'string' && named.length > 0) return named;
  }
  return null;
}

/**
 * Was this a unique violation — optionally, of one particular constraint?
 *
 * Pass the constraint name where the surrounding code can only handle *that*
 * collision. A catch that treats every unique violation as "already used" will
 * one day swallow a different index's complaint and answer a bug with a polite
 * sentence.
 */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  if (sqlStateOf(err) !== UNIQUE_VIOLATION) return false;
  if (constraint === undefined) return true;
  return violatedConstraint(err) === constraint;
}

/**
 * A driver failure, summarised for a log line — without its parameters.
 *
 * `drizzle-orm` 0.45 builds its error message from the failing statement *and
 * the values that were bound to it*:
 *
 *     Failed query: insert into "users" (...) values ($1, $2, …)
 *     params: 01M3…, meera@example.in, +919820000000
 *
 * Several places log `err.message` when a write they do not want to fail the
 * request fails anyway — the audit write, the auth-event write, api metering.
 * Those lines used to carry a Postgres sentence naming a constraint. On the new
 * driver they would carry a row of real values instead, which is how an email
 * address or a phone number ends up in a log file that nobody thought of as
 * holding personal data. A privacy record that copies the data it describes is
 * the thing this codebase refuses to build; a log line is no different.
 *
 * So: the SQLSTATE, the constraint, and the driver's own short reason if it has
 * one. Enough to find the fault, nothing to leak.
 */
export function describeDbError(err: unknown): string {
  const state = sqlStateOf(err);
  if (state === null) {
    // Not a driver error — an ordinary failure, whose message is its own and
    // carries no bound parameters.
    return err instanceof Error ? err.message : String(err);
  }

  const constraint = violatedConstraint(err);
  // The innermost link is the driver's own error; its `message` is the short
  // Postgres sentence, not the wrapper's statement dump.
  let reason: string | null = null;
  for (const link of chain(err)) {
    const candidate = (link as { message?: unknown }).message;
    if (typeof candidate === 'string' && !candidate.startsWith('Failed query:')) reason = candidate;
  }

  return [
    `sqlstate ${state}`,
    constraint ? `constraint ${constraint}` : null,
    reason,
  ]
    .filter((part): part is string => Boolean(part))
    .join(' · ');
}
