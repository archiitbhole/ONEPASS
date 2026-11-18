import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { db, sql as pg } from './client';
import * as t from './schema';
import { listForecasts, utilisationSummary } from '@/lib/insights/demand';

async function main() {
  const [org] = await db.select().from(t.organizations).where(eq(t.organizations.slug, 'phoenix-cinemas')).limit(1);
  const u = await utilisationSummary(org!.id);
  console.log(`utilisation (last ${u.days}d): ${u.sold}/${u.capacity} = ${(u.utilisationBp/100).toFixed(1)}%  (${u.unsold} unsold across ${u.slots} slots)`);
  const f = await listForecasts(org!.id, 10);
  console.log(`\nforecasts: ${f.length}`);
  for (const r of f.slice(0, 6)) {
    console.log(`  ${r.startsAt.toISOString().slice(0,16)}  ${r.label}`);
    console.log(`    expect ${r.expectedDemand}/${r.capacity} (${(r.expectedUtilisationBp/100).toFixed(0)}%)  confidence ${r.confidence}%  n=${r.sampleSize}`);
    console.log(`    suggest: ${r.suggestedDiscountBp ? (r.suggestedDiscountBp/100)+'% off, release '+r.suggestedReleaseAt?.toISOString().slice(0,16) : 'none'}`);
    console.log(`    ${r.note}`);
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => pg.end());
