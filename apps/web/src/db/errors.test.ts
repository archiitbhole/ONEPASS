/**
 * Reading a driver error, pinned against a real database.
 *
 * This file exists because of a specific near-miss. Upgrading `drizzle-orm` from
 * 0.38 to 0.45 changed where a Postgres error's SQLSTATE lives: the thrown thing
 * is now a `DrizzleQueryError` whose message is `Failed query: …` and whose
 * `code` is `undefined`, with the real `PostgresError` moved to `cause`. Two
 * places in this codebase branch on that value, because two rules are enforced
 * by a unique index rather than by an `if`:
 *
 *   · the pass replay check — one code, one counter, once, where the index *is*
 *     the check;
 *   · the offer redemption cap, where the index is the backstop behind an
 *     application count taken under a row lock.
 *
 * Both branches broke. A test caught the first, because there the index is the
 * only thing standing between a customer and a second admission. Nothing caught
 * the second: the cap was still enforced — Postgres refused the row either way —
 * but the refusal degraded from a 409 to an unhandled 500, on a path you can
 * only reach by beating a row lock.
 *
 * **So every assertion here goes through a real round trip.** Hand-building an
 * error object to assert against would only prove that this file agrees with
 * itself: a fabricated `{ code: '23505' }` matches whatever shape the helper
 * currently expects, which is exactly the thing that changed. The only way this
 * catches the next driver upgrade is by asking the driver.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from './client';
import {
  describeDbError,
  isUniqueViolation,
  sqlStateOf,
  violatedConstraint,
  UNIQUE_VIOLATION,
} from './errors';

/** A table of this file's own, so nothing here depends on domain fixtures. */
beforeAll(async () => {
  await db.execute(sql`drop table if exists driver_error_probe`);
  await db.execute(sql`
    create table driver_error_probe (
      id int primary key,
      slug text,
      constraint driver_error_probe_slug_key unique (slug)
    )
  `);
});

afterAll(async () => {
  await db.execute(sql`drop table if exists driver_error_probe`);
});

/** Provoke a real violation and hand back whatever the driver threw. */
async function thrownBy(statement: Promise<unknown>): Promise<unknown> {
  try {
    await statement;
  } catch (err) {
    return err;
  }
  throw new Error('the statement was expected to fail and did not');
}

describe('a unique violation, as the driver actually reports it', () => {
  it('is recognised however deeply the driver buries the SQLSTATE', async () => {
    await db.execute(sql`insert into driver_error_probe (id, slug) values (1, 'a')`);
    const err = await thrownBy(db.execute(sql`insert into driver_error_probe (id, slug) values (1, 'b')`));

    expect(sqlStateOf(err)).toBe(UNIQUE_VIOLATION);
    expect(isUniqueViolation(err)).toBe(true);

    // The shape that broke: on drizzle 0.45 the top-level error carries neither
    // the code nor the old message, so both of the checks this replaced now
    // read false. If a future driver puts them back, this still passes — the
    // helper walks the chain rather than asserting a shape.
    const top = err as { code?: unknown; message?: unknown };
    const flatCode = typeof top.code === 'string' && top.code === UNIQUE_VIOLATION;
    const oldProse = String(top.message ?? '').includes('duplicate key');
    expect(
      flatCode || oldProse || sqlStateOf(err) === UNIQUE_VIOLATION,
      'the helper must recognise this regardless of which shape the driver uses',
    ).toBe(true);
  });

  it('names the constraint that was violated', async () => {
    await db.execute(sql`insert into driver_error_probe (id, slug) values (2, 'taken')`);
    const err = await thrownBy(db.execute(sql`insert into driver_error_probe (id, slug) values (3, 'taken')`));

    expect(violatedConstraint(err)).toBe('driver_error_probe_slug_key');
    expect(isUniqueViolation(err, 'driver_error_probe_slug_key')).toBe(true);
  });

  it('does not answer one index’s complaint on another index’s behalf', async () => {
    // The primary key collided, not the slug. A catch that asked only "was this
    // unique?" would report the wrong cause and, at a call site, would answer a
    // genuine bug with a polite sentence about something else.
    await db.execute(sql`insert into driver_error_probe (id, slug) values (4, 'four')`);
    const err = await thrownBy(db.execute(sql`insert into driver_error_probe (id, slug) values (4, 'five')`));

    expect(isUniqueViolation(err)).toBe(true);
    expect(isUniqueViolation(err, 'driver_error_probe_slug_key')).toBe(false);
  });

  it('says no to failures that are not unique violations', async () => {
    const notNull = await thrownBy(db.execute(sql`insert into driver_error_probe (id) values (null)`));
    expect(isUniqueViolation(notNull)).toBe(false);
    expect(sqlStateOf(notNull)).not.toBe(UNIQUE_VIOLATION);

    const missingTable = await thrownBy(db.execute(sql`select 1 from table_that_is_not_there`));
    expect(isUniqueViolation(missingTable)).toBe(false);

    // And nothing that is not an error at all.
    for (const value of [null, undefined, 'a string', 42, {}, new Error('plain')]) {
      expect(isUniqueViolation(value)).toBe(false);
      expect(sqlStateOf(value)).toBeNull();
    }
  });

  it('terminates on a cause chain that loops', async () => {
    // A cause chain is data. A cycle in one must not hang a request.
    const a: { cause?: unknown } = new Error('a');
    const b: { cause?: unknown } = new Error('b');
    a.cause = b;
    b.cause = a;
    expect(sqlStateOf(a)).toBeNull();
    expect(isUniqueViolation(a)).toBe(false);
  });
});

describe('summarising a driver error for a log line', () => {
  it('names the fault and never the values that were bound to it', async () => {
    await db.execute(sql`insert into driver_error_probe (id, slug) values (9, 'secret@example.test')`);
    const err = await thrownBy(
      db.execute(sql`insert into driver_error_probe (id, slug) values (10, 'secret@example.test')`),
    );

    const line = describeDbError(err);

    // Enough to find the fault…
    expect(line).toContain(UNIQUE_VIOLATION);
    expect(line).toContain('driver_error_probe_slug_key');

    // …and nothing to leak. drizzle 0.45 puts the bound parameters into
    // `err.message`, so logging that verbatim would have put this value — stand
    // in here for an email address or a phone number — into a log file.
    expect(String((err as Error).message)).toContain('secret@example.test');
    expect(line).not.toContain('secret@example.test');
    expect(line).not.toContain('params:');
    expect(line).not.toContain('Failed query');
  });

  it('passes an ordinary error through unchanged', () => {
    expect(describeDbError(new Error('the airline did not answer'))).toBe('the airline did not answer');
    expect(describeDbError('a string')).toBe('a string');
  });
});
