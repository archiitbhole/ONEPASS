/**
 * `npm run db:refresh` — put the sample window back on today, and run the sweeps.
 *
 * Run this before any walkthrough. It is idempotent and takes about a second.
 */
import 'dotenv/config';
import { sql as pg } from './client';
import { refreshSampleWindow } from './maintenance';

async function main() {
  const r = await refreshSampleWindow();
  console.log('re-anchored to today:');
  console.log('  %d live slots, %d saturday slots, %d offers', r.slotsMoved, r.saturdaySlotsMoved, r.offersMoved);
  console.log('sweeps:');
  console.log('  %d stale holds released', r.sweeps.expiredHolds);
  console.log('  %d offers activated, %d ended', r.sweeps.activatedOffers, r.sweeps.endedOffers);
  console.log('  %d tickets expired, %d bookings marked no-show', r.sweeps.expiredTickets, r.sweeps.noShows);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => pg.end());
