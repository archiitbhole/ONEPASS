/**
 * The seed command. Run with `npm run db:seed`.
 */
import 'dotenv/config';
import { sql as pg } from './client';
import { seedReferenceData, seedSampleData, SAMPLE_PASSWORD } from './seed-data';
import { seedCommerce } from './seed-commerce';
import { seedTravelCommercials, seedTravelReferenceData } from './seed-travel';

async function main() {
  const isProd = process.env.NODE_ENV === 'production';
  const { roleIds } = await seedReferenceData();
  console.log('reference data ready: roles, permissions, consent definitions');

  // Airports and airlines are facts about the world, not sample data: a
  // production deployment with real provider credentials still has to be able to
  // print "Mumbai" rather than "BOM". So this runs before the production guard.
  const travelReference = await seedTravelReferenceData();
  console.log('travel reference data ready: %d airports, %d airlines', travelReference.airports, travelReference.airlines);

  if (isProd && process.env.SEED_SAMPLE_DATA !== 'yes-i-am-sure') {
    console.log('production detected — sample data skipped (set SEED_SAMPLE_DATA=yes-i-am-sure to override)');
    return;
  }

  const seeded = await seedSampleData(roleIds);

  const commerce = await seedCommerce(seeded);
  if (commerce.skipped) {
    console.log('commerce ecosystem already present — left alone');
  } else {
    console.log(
      'commerce ecosystem: %d cities, %d venues, %d live deals, %d days of trading history',
      commerce.cities, commerce.venues, commerce.liveDeals, commerce.historyBookings,
    );
  }
  const travelCommercials = await seedTravelCommercials();
  if (travelCommercials.bankOffers === 0) {
    console.log('travel offers already present — left alone');
  } else {
    console.log(
      'travel commercials: %d illustrative bank offers, %d cashback rules (no bank has agreed to fund these)',
      travelCommercials.bankOffers, travelCommercials.cashbackRules,
    );
  }

  console.log('\nsample accounts (development only, password for all: %s)', SAMPLE_PASSWORD);
  console.table([
    { role: 'Consumer', email: seeded.consumer.email },
    { role: 'Consumer (second, for isolation tests)', email: seeded.secondConsumer.email },
    { role: 'Partner owner — Grand Sahyadri', email: seeded.owner.email },
    { role: 'Partner staff — Grand Sahyadri', email: seeded.staff.email },
    { role: 'Partner owner — Phoenix Cinemas', email: seeded.rivalOwner.email },
    { role: 'Platform admin', email: seeded.admin.email },
    { role: 'Platform support', email: seeded.support.email },
    { role: 'Security admin', email: seeded.security.email },
  ]);
}

main()
  .catch((err) => {
    console.error('seed failed:', err instanceof Error ? err.stack : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pg.end();
  });
