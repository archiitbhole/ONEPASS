/**
 * Travel reference data.
 *
 * Three kinds of row, and the distinction matters:
 *
 *  · **Airports and airlines** are *facts about the world*, not sample data.
 *    They are correct in production and are seeded there too: a deployment with
 *    real provider credentials still needs to know that BOM is Chhatrapati
 *    Shivaji Maharaj International and that 6E is IndiGo, or every result page
 *    shows bare three-letter codes.
 *
 *  · **Bank offers and cashback rules** are *commercial arrangements*, and the
 *    ones here are illustrative. They are seeded only outside production, behind
 *    the same guard as every other sample row, because an offer nobody has
 *    agreed to fund is a discount ONEPASS would be paying for out of its own
 *    pocket. An operator enters their real ones.
 *
 * Idempotent throughout: run it twice and the second run changes nothing. A seed
 * that has to be run against an empty database is a seed nobody runs.
 */
import { sql } from 'drizzle-orm';
import { db } from './client';
import { airlines, airports, bankOffers, cashbackRules } from './schema';
import { publicRef, ulid } from '../lib/ids';
import { BRAND } from '../lib/brand';

/**
 * The airports this product serves, with the time zone each one is actually in.
 *
 * Indian domestic first, because that is the traffic, then the international
 * destinations Indian travellers fly most. `cityCode` is what makes "all Delhi
 * airports" work; where it equals the airport code the city has one airport.
 */
const AIRPORTS: {
  code: string;
  name: string;
  city: string;
  cityCode: string;
  country: string;
  countryCode: string;
  timeZone: string;
  latitude: string;
  longitude: string;
  isDomestic: boolean;
}[] = [
  // ── India ──
  { code: 'DEL', name: 'Indira Gandhi International', city: 'Delhi', cityCode: 'DEL', country: 'India', countryCode: 'IN', timeZone: 'Asia/Kolkata', latitude: '28.5562', longitude: '77.1000', isDomestic: true },
  { code: 'BOM', name: 'Chhatrapati Shivaji Maharaj International', city: 'Mumbai', cityCode: 'BOM', country: 'India', countryCode: 'IN', timeZone: 'Asia/Kolkata', latitude: '19.0896', longitude: '72.8656', isDomestic: true },
  { code: 'BLR', name: 'Kempegowda International', city: 'Bengaluru', cityCode: 'BLR', country: 'India', countryCode: 'IN', timeZone: 'Asia/Kolkata', latitude: '13.1986', longitude: '77.7066', isDomestic: true },
  { code: 'MAA', name: 'Chennai International', city: 'Chennai', cityCode: 'MAA', country: 'India', countryCode: 'IN', timeZone: 'Asia/Kolkata', latitude: '12.9941', longitude: '80.1709', isDomestic: true },
  { code: 'CCU', name: 'Netaji Subhas Chandra Bose International', city: 'Kolkata', cityCode: 'CCU', country: 'India', countryCode: 'IN', timeZone: 'Asia/Kolkata', latitude: '22.6547', longitude: '88.4467', isDomestic: true },
  { code: 'HYD', name: 'Rajiv Gandhi International', city: 'Hyderabad', cityCode: 'HYD', country: 'India', countryCode: 'IN', timeZone: 'Asia/Kolkata', latitude: '17.2403', longitude: '78.4294', isDomestic: true },
  { code: 'PNQ', name: 'Pune International', city: 'Pune', cityCode: 'PNQ', country: 'India', countryCode: 'IN', timeZone: 'Asia/Kolkata', latitude: '18.5822', longitude: '73.9197', isDomestic: true },
  { code: 'GOI', name: 'Goa International (Dabolim)', city: 'Goa', cityCode: 'GOI', country: 'India', countryCode: 'IN', timeZone: 'Asia/Kolkata', latitude: '15.3808', longitude: '73.8314', isDomestic: true },
  { code: 'GOX', name: 'Manohar International (Mopa)', city: 'Goa', cityCode: 'GOI', country: 'India', countryCode: 'IN', timeZone: 'Asia/Kolkata', latitude: '15.7430', longitude: '73.8580', isDomestic: true },
  { code: 'AMD', name: 'Sardar Vallabhbhai Patel International', city: 'Ahmedabad', cityCode: 'AMD', country: 'India', countryCode: 'IN', timeZone: 'Asia/Kolkata', latitude: '23.0772', longitude: '72.6347', isDomestic: true },
  { code: 'COK', name: 'Cochin International', city: 'Kochi', cityCode: 'COK', country: 'India', countryCode: 'IN', timeZone: 'Asia/Kolkata', latitude: '10.1520', longitude: '76.4019', isDomestic: true },
  { code: 'JAI', name: 'Jaipur International', city: 'Jaipur', cityCode: 'JAI', country: 'India', countryCode: 'IN', timeZone: 'Asia/Kolkata', latitude: '26.8242', longitude: '75.8122', isDomestic: true },
  { code: 'LKO', name: 'Chaudhary Charan Singh International', city: 'Lucknow', cityCode: 'LKO', country: 'India', countryCode: 'IN', timeZone: 'Asia/Kolkata', latitude: '26.7606', longitude: '80.8893', isDomestic: true },
  { code: 'IXC', name: 'Chandigarh International', city: 'Chandigarh', cityCode: 'IXC', country: 'India', countryCode: 'IN', timeZone: 'Asia/Kolkata', latitude: '30.6735', longitude: '76.7885', isDomestic: true },
  { code: 'TRV', name: 'Thiruvananthapuram International', city: 'Thiruvananthapuram', cityCode: 'TRV', country: 'India', countryCode: 'IN', timeZone: 'Asia/Kolkata', latitude: '8.4821', longitude: '76.9200', isDomestic: true },
  { code: 'SXR', name: 'Sheikh ul-Alam International', city: 'Srinagar', cityCode: 'SXR', country: 'India', countryCode: 'IN', timeZone: 'Asia/Kolkata', latitude: '33.9871', longitude: '74.7742', isDomestic: true },
  { code: 'GAU', name: 'Lokpriya Gopinath Bordoloi International', city: 'Guwahati', cityCode: 'GAU', country: 'India', countryCode: 'IN', timeZone: 'Asia/Kolkata', latitude: '26.1061', longitude: '91.5859', isDomestic: true },
  { code: 'PAT', name: 'Jay Prakash Narayan International', city: 'Patna', cityCode: 'PAT', country: 'India', countryCode: 'IN', timeZone: 'Asia/Kolkata', latitude: '25.5913', longitude: '85.0880', isDomestic: true },
  { code: 'BBI', name: 'Biju Patnaik International', city: 'Bhubaneswar', cityCode: 'BBI', country: 'India', countryCode: 'IN', timeZone: 'Asia/Kolkata', latitude: '20.2444', longitude: '85.8178', isDomestic: true },
  { code: 'IXL', name: 'Kushok Bakula Rimpochee', city: 'Leh', cityCode: 'IXL', country: 'India', countryCode: 'IN', timeZone: 'Asia/Kolkata', latitude: '34.1359', longitude: '77.5465', isDomestic: true },
  { code: 'UDR', name: 'Maharana Pratap', city: 'Udaipur', cityCode: 'UDR', country: 'India', countryCode: 'IN', timeZone: 'Asia/Kolkata', latitude: '24.6177', longitude: '73.8961', isDomestic: true },
  { code: 'IXZ', name: 'Veer Savarkar International', city: 'Port Blair', cityCode: 'IXZ', country: 'India', countryCode: 'IN', timeZone: 'Asia/Kolkata', latitude: '11.6412', longitude: '92.7297', isDomestic: true },

  // ── the international routes Indian travellers fly most ──
  { code: 'DXB', name: 'Dubai International', city: 'Dubai', cityCode: 'DXB', country: 'United Arab Emirates', countryCode: 'AE', timeZone: 'Asia/Dubai', latitude: '25.2532', longitude: '55.3657', isDomestic: false },
  { code: 'SIN', name: 'Singapore Changi', city: 'Singapore', cityCode: 'SIN', country: 'Singapore', countryCode: 'SG', timeZone: 'Asia/Singapore', latitude: '1.3644', longitude: '103.9915', isDomestic: false },
  { code: 'BKK', name: 'Suvarnabhumi', city: 'Bangkok', cityCode: 'BKK', country: 'Thailand', countryCode: 'TH', timeZone: 'Asia/Bangkok', latitude: '13.6900', longitude: '100.7501', isDomestic: false },
  { code: 'LHR', name: 'London Heathrow', city: 'London', cityCode: 'LON', country: 'United Kingdom', countryCode: 'GB', timeZone: 'Europe/London', latitude: '51.4700', longitude: '-0.4543', isDomestic: false },
  { code: 'JFK', name: 'John F. Kennedy International', city: 'New York', cityCode: 'NYC', country: 'United States', countryCode: 'US', timeZone: 'America/New_York', latitude: '40.6413', longitude: '-73.7781', isDomestic: false },
  { code: 'KUL', name: 'Kuala Lumpur International', city: 'Kuala Lumpur', cityCode: 'KUL', country: 'Malaysia', countryCode: 'MY', timeZone: 'Asia/Kuala_Lumpur', latitude: '2.7456', longitude: '101.7099', isDomestic: false },
  { code: 'CMB', name: 'Bandaranaike International', city: 'Colombo', cityCode: 'CMB', country: 'Sri Lanka', countryCode: 'LK', timeZone: 'Asia/Colombo', latitude: '7.1808', longitude: '79.8841', isDomestic: false },
  { code: 'KTM', name: 'Tribhuvan International', city: 'Kathmandu', cityCode: 'KTM', country: 'Nepal', countryCode: 'NP', timeZone: 'Asia/Kathmandu', latitude: '27.6966', longitude: '85.3591', isDomestic: false },
  { code: 'AUH', name: 'Zayed International', city: 'Abu Dhabi', cityCode: 'AUH', country: 'United Arab Emirates', countryCode: 'AE', timeZone: 'Asia/Dubai', latitude: '24.4330', longitude: '54.6511', isDomestic: false },
  { code: 'DOH', name: 'Hamad International', city: 'Doha', cityCode: 'DOH', country: 'Qatar', countryCode: 'QA', timeZone: 'Asia/Qatar', latitude: '25.2731', longitude: '51.6081', isDomestic: false },
];

/** The carriers that appear on those routes. `isLowCost` changes how fares compare. */
const AIRLINES: { code: string; name: string; countryCode: string; isLowCost: boolean }[] = [
  { code: '6E', name: 'IndiGo', countryCode: 'IN', isLowCost: true },
  { code: 'AI', name: 'Air India', countryCode: 'IN', isLowCost: false },
  { code: 'UK', name: 'Air India Express', countryCode: 'IN', isLowCost: false },
  { code: 'SG', name: 'SpiceJet', countryCode: 'IN', isLowCost: true },
  { code: 'QP', name: 'Akasa Air', countryCode: 'IN', isLowCost: true },
  { code: 'I5', name: 'AIX Connect', countryCode: 'IN', isLowCost: true },
  { code: 'EK', name: 'Emirates', countryCode: 'AE', isLowCost: false },
  { code: 'EY', name: 'Etihad Airways', countryCode: 'AE', isLowCost: false },
  { code: 'QR', name: 'Qatar Airways', countryCode: 'QA', isLowCost: false },
  { code: 'SQ', name: 'Singapore Airlines', countryCode: 'SG', isLowCost: false },
  { code: 'TG', name: 'Thai Airways', countryCode: 'TH', isLowCost: false },
  { code: 'BA', name: 'British Airways', countryCode: 'GB', isLowCost: false },
  { code: 'AK', name: 'AirAsia', countryCode: 'MY', isLowCost: true },
  { code: 'UL', name: 'SriLankan Airlines', countryCode: 'LK', isLowCost: false },
];

/**
 * Facts about the world. Seeded in every environment, production included.
 *
 * `onConflictDoUpdate` rather than `doNothing`, because an airport can be
 * renamed and a terminal reassigned — and a seed that refuses to correct itself
 * is a seed that goes stale the first time reality moves.
 */
export async function seedTravelReferenceData(): Promise<{ airports: number; airlines: number }> {
  for (const airport of AIRPORTS) {
    await db
      .insert(airports)
      .values(airport)
      .onConflictDoUpdate({
        target: airports.code,
        set: {
          name: airport.name,
          city: airport.city,
          cityCode: airport.cityCode,
          country: airport.country,
          countryCode: airport.countryCode,
          timeZone: airport.timeZone,
          latitude: airport.latitude,
          longitude: airport.longitude,
          isDomestic: airport.isDomestic,
          active: true,
        },
      });
  }

  for (const airline of AIRLINES) {
    await db
      .insert(airlines)
      .values(airline)
      .onConflictDoUpdate({
        target: airlines.code,
        set: {
          name: airline.name,
          countryCode: airline.countryCode,
          isLowCost: airline.isLowCost,
          active: true,
        },
      });
  }

  return { airports: AIRPORTS.length, airlines: AIRLINES.length };
}

/**
 * Illustrative bank offers and cashback rules.
 *
 * Development only — `seed.ts` does not reach this in production. The figures
 * are the shape of offers Indian issuers actually run, so the eligibility engine
 * is exercised against something realistic, but no bank has agreed to fund any
 * of them and the seed says so in each row's terms.
 */
export async function seedTravelCommercials(): Promise<{ bankOffers: number; cashbackRules: number }> {
  const existing = await db.select({ count: sql<number>`count(*)::int` }).from(bankOffers);
  if ((existing[0]?.count ?? 0) > 0) return { bankOffers: 0, cashbackRules: 0 };

  const now = new Date();
  const startsAt = new Date(now.getTime() - 7 * 86_400_000);
  const endsAt = new Date(now.getTime() + 180 * 86_400_000);

  const offers = [
    {
      issuer: 'HDFC Bank',
      instrument: 'CREDIT_CARD' as const,
      title: '10% off domestic flights, up to ₹1,500',
      terms:
        'Sample offer for development. 10% off the fare when paying with an HDFC Bank credit card, capped at ₹1,500, minimum spend ₹5,000. One use per customer. No bank has agreed to fund this offer.',
      percentOffBp: 1_000,
      flatOffMinor: 0,
      maxDiscountMinor: 150_000,
      minSpendMinor: 500_000,
      carriers: null,
      routes: null,
      cabins: null,
      perUserLimit: 1,
      totalLimit: null,
    },
    {
      issuer: 'ICICI Bank',
      instrument: 'CREDIT_CARD' as const,
      title: '₹750 off bookings over ₹8,000',
      terms:
        'Sample offer for development. A flat ₹750 off when paying with an ICICI Bank credit card on a booking of ₹8,000 or more. Twice per customer. No bank has agreed to fund this offer.',
      percentOffBp: 0,
      flatOffMinor: 75_000,
      maxDiscountMinor: 75_000,
      minSpendMinor: 800_000,
      carriers: null,
      routes: null,
      cabins: null,
      perUserLimit: 2,
      totalLimit: null,
    },
    {
      issuer: 'Any bank',
      instrument: 'UPI' as const,
      title: '5% off when you pay by UPI, up to ₹500',
      terms:
        'Sample offer for development. 5% off the fare when paying by UPI, capped at ₹500, minimum spend ₹3,000. No bank has agreed to fund this offer.',
      percentOffBp: 500,
      flatOffMinor: 0,
      maxDiscountMinor: 50_000,
      minSpendMinor: 300_000,
      carriers: null,
      routes: null,
      cabins: null,
      perUserLimit: 3,
      totalLimit: null,
    },
    {
      issuer: 'Axis Bank',
      instrument: 'CREDIT_CARD' as const,
      title: '12% off business class, up to ₹4,000',
      terms:
        'Sample offer for development. 12% off business and first class fares with an Axis Bank credit card, capped at ₹4,000, minimum spend ₹20,000. No bank has agreed to fund this offer.',
      percentOffBp: 1_200,
      flatOffMinor: 0,
      maxDiscountMinor: 400_000,
      minSpendMinor: 2_000_000,
      carriers: null,
      routes: null,
      cabins: ['BUSINESS', 'FIRST'],
      perUserLimit: 1,
      totalLimit: null,
    },
  ];

  for (const offer of offers) {
    await db.insert(bankOffers).values({
      id: ulid(),
      publicRef: publicRef('bo'),
      organizationId: null,
      ...offer,
      usedCount: 0,
      active: true,
      startsAt,
      endsAt,
    });
  }

  const rules = [
    {
      name: 'Flight cashback',
      description: `3% back in ${BRAND.name} points on every flight, up to ₹600. Credited once the airline’s cancellation window has passed.`,
      percentBp: 300,
      flatMinor: 0,
      maxCashbackMinor: 60_000,
      minSpendMinor: 200_000,
      carriers: null,
      cabins: null,
      holdDays: 7,
      expiryDays: 180,
    },
    {
      name: 'Premium cabin cashback',
      description: `5% back in ${BRAND.name} points on premium economy and above, up to ₹2,000.`,
      percentBp: 500,
      flatMinor: 0,
      maxCashbackMinor: 200_000,
      minSpendMinor: 1_500_000,
      carriers: null,
      cabins: ['PREMIUM_ECONOMY', 'BUSINESS', 'FIRST'],
      holdDays: 7,
      expiryDays: 180,
    },
  ];

  for (const rule of rules) {
    await db.insert(cashbackRules).values({
      id: ulid(),
      publicRef: publicRef('cr'),
      ...rule,
      active: true,
      startsAt,
      endsAt: null,
    });
  }

  return { bankOffers: offers.length, cashbackRules: rules.length };
}
