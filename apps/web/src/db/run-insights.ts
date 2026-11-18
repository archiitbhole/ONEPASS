import 'dotenv/config';
import { sql as pg } from './client';
import { db } from './client';
import * as t from './schema';
import { computeInsights } from '@/lib/insights/merchant';

async function main() {
  const orgs = await db.select({ id: t.organizations.id, name: t.organizations.name }).from(t.organizations);
  for (const o of orgs) {
    const found = await computeInsights(o.id);
    if (found.length) {
      console.log(`\n${o.name}`);
      for (const f of found) {
        console.log(`  [${f.severity}] ${f.headline}`);
        console.log(`    method: ${f.method}  sample: ${f.sampleSize}`);
        console.log(`    evidence: ${JSON.stringify(f.evidence)}`);
      }
    }
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => pg.end());
