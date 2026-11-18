/**
 * `npm run products:backfill` — create product instances for receipts issued
 * before ownership existed (D-007). Idempotent: the (line, unit) unique index
 * means a second run creates nothing.
 */
import 'dotenv/config';
import { backfillInstances } from '@/lib/products/ownership';

async function main() {
  const considered = await backfillInstances();
  console.log(`products:backfill: ${considered} unit(s) considered; existing instances were left as they were.`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
