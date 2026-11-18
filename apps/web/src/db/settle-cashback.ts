/**
 * Credit cashback that has come of age.
 *
 * ONEPASS has no scheduler, so this is a command an operator runs — `npm run
 * travel:settle-cashback` — rather than a job that runs itself. That is stated
 * plainly on the rewards screen and in the feature registry, because a customer
 * told "credited after the 23rd" and an operator who has never run this are a
 * combination that only ends one way.
 *
 * Idempotent by two constraints, so running it twice, or twice at once, credits
 * nothing twice: a unique index on (booking, rule) in `cashback_ledger`, and an
 * idempotency key on the reward-ledger entry derived from the cashback row's id.
 */
import 'dotenv/config';
import { sql as pg } from './client';
import { creditCashbackFor } from '../lib/travel/cashback';

async function main() {
  const result = await creditCashbackFor(new Date());
  console.log(
    'cashback settled: %d row(s) credited, %d point(s) issued',
    result.credited,
    result.pointsIssued,
  );
}

main()
  .catch((err) => {
    console.error('settling cashback failed:', err instanceof Error ? err.stack : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pg.end();
  });
