/**
 * Run the Suspicious Activity Shield from the command line.
 *
 *   npm run security:sweep            # last 3 hours, files what it finds
 *   npm run security:sweep -- 1440    # last 24 hours
 *   npm run security:sweep -- 180 dry # report only, write nothing
 *
 * There is no scheduler in this repository. In production this wants to run on a
 * few-minute cadence from whatever runs cron there; here it is a command, and
 * saying so is better than implying something watches continuously.
 */
import 'dotenv/config';
import { sql as pg } from './client';
import { runDetectors, DEFAULT_LOOKBACK_MINUTES } from '@/lib/security/detect';

async function main() {
  const [minutesArg, modeArg] = process.argv.slice(2);
  const lookbackMinutes = Number(minutesArg) > 0 ? Number(minutesArg) : DEFAULT_LOOKBACK_MINUTES;
  const write = modeArg !== 'dry';

  const report = await runDetectors({ lookbackMinutes, write });

  console.log(`window   ${report.windowStart} → ${report.windowEnd}`);
  console.log(`found    ${report.found}   written ${report.written}   already filed ${report.suppressed}`);
  if (!write) console.log('         (dry run — nothing was written)');

  for (const f of report.findings) {
    console.log(`\n  [${f.severity}] ${f.kind}`);
    console.log(`    ${f.summary}`);
    console.log(`    evidence: ${JSON.stringify(f.evidence)}`);
  }
  if (report.found === 0) console.log('\n  nothing met a threshold.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pg.end());
