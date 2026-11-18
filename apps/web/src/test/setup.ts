/**
 * Test environment.
 *
 * Points every module at the dedicated test database before anything imports the
 * db client, and refuses to run if that database looks like the development one —
 * a test suite that truncates the wrong database only has to happen once.
 */
import { config } from 'dotenv';
import path from 'node:path';

// TEST_ENV_FILE lets two suites run side by side against two test databases
// (.env.test.a, .env.test.b …); the guard below still insists the database
// is a test one, whichever file named it.
const envFile = process.env.USE_DEV_DB ? '.env' : (process.env.TEST_ENV_FILE ?? '.env.test');
config({ path: path.resolve(process.cwd(), envFile), override: true });

/*
  The guard: the suite truncates every table between tests, so it must never be
  pointed at a database somebody cares about.

  `_test` rather than the literal `onepass_test`, because the dev database is
  not required to be called `onepass` — `bootstrap-dev.sh` derives the test name
  by appending `_test` to whatever `DATABASE_URL` names, and a clean-room run
  with a differently-named dev database hit a refusal whose message named a
  database it had never been told to create.
*/
/** The database name out of a connection URL, without its query string. */
const databaseName = (url: string | undefined): string =>
  (url ?? '').split('?')[0]?.split('/').pop() ?? '';

if (!process.env.USE_DEV_DB && !databaseName(process.env.DATABASE_URL).includes('_test')) {
  throw new Error(
    `Refusing to run: the test database must be named with a _test suffix — ${envFile} says ` +
      `${process.env.DATABASE_URL ?? '(unset)'}. This suite truncates every table between tests. ` +
      'Run `bash scripts/bootstrap-dev.sh` from the repository root, which creates it and writes ' +
      `${envFile === '.env.test' ? '.env.test' : envFile} for you.`,
  );
}

// Next's type definitions make NODE_ENV read-only; the assignment is still what
// we want here, because every module reads it through process.env at runtime.
Object.assign(process.env, { NODE_ENV: 'test' });
// Rate limits stay ON in tests: the limiter is a security control, and testing
// the system with it disabled would test a configuration nobody ships.
process.env.RATE_LIMIT_DISABLED = 'false';

/**
 * The connection pool is deliberately never closed by the tests.
 *
 * setupFiles run once per test file, so any afterAll registered here would fire
 * when the *first* file finishes and disconnect every file after it. Vitest ends
 * the process when the run completes, which closes the sockets; a pool that
 * outlives the last assertion by a few milliseconds costs nothing.
 */
