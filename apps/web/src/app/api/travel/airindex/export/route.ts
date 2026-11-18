/**
 * The observations, as a CSV file.
 *
 * AirIndex publishes conclusions; this endpoint publishes what they were
 * computed from. That is the point of documenting a method — somebody can check
 * it — and a method nobody can check is a claim rather than a measurement.
 *
 * Three things make this safe to expose:
 *
 *  · **It is behind a session.** These are the prices this deployment observed,
 *    which is commercially its own; a signed-in customer may have them, an
 *    anonymous crawler may not.
 *  · **It is rate-limited** on the same policy as a search, because it is the
 *    same data and a loop over every route would be a bulk export by another
 *    name.
 *  · **It contains nothing about a person.** An observation is a route, a date,
 *    a carrier and a price. There is no user, no search reference, no booking
 *    and no session in the file.
 *
 * The fields are escaped and formula-neutralised in `routeObservationsCsv` — a
 * carrier code beginning with `=` would otherwise become a live formula the
 * moment somebody opened the file in a spreadsheet.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { route } from '@/lib/api';
import { unauthenticated } from '@/lib/errors';
import { routeObservationsCsv } from '@/lib/travel/airindex';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const query = z.object({
  from: z.string().regex(/^[A-Za-z]{3}$/, 'an airport code is three letters'),
  to: z.string().regex(/^[A-Za-z]{3}$/, 'an airport code is three letters'),
  days: z.coerce.number().int().min(1).max(365).default(90),
});

export const GET = route(
  {
    querySchema: query,
    rateLimit: { name: 'travel:search', subject: (ctx) => ctx.actor?.userId ?? ctx.ip ?? 'anonymous' },
  },
  async ({ query: q, actor }) => {
    // A session, not a permission: every signed-in customer may export, and an
    // anonymous request may not.
    if (!actor) throw unauthenticated();

    const origin = q.from.toUpperCase();
    const destination = q.to.toUpperCase();
    const csv = await routeObservationsCsv({ origin, destination, days: q.days, limit: 20_000 });

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        // A filename that says what is in it, so a downloads folder with six of
        // these is still navigable.
        'content-disposition': `attachment; filename="airindex-${origin}-${destination}-${q.days}d.csv"`,
        'cache-control': 'no-store, private',
        // The file is data, not markup. Without this a browser that sniffs its
        // way to text/html would render it.
        'x-content-type-options': 'nosniff',
      },
    });
  },
);
