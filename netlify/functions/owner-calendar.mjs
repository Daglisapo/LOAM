import { todayISO } from '../lib/ical.mjs';
import { ledgerView } from '../lib/ledger.mjs';
import { buildOwnerCalendar } from '../lib/ownerfeed.mjs';
import { readBlocks, readCache, readLedger, readFeedToken, sameSecret } from '../lib/store.mjs';

/* The owner's private calendar, with guest details on every stay: direct
   bookings from the calendar, Airbnb and Booking stays from the books.

   A calendar app cannot send a header, so unlike the rest of the admin API the
   secret has to travel in the URL. That is why this is its own random token and
   not the admin password, and why the owner page can replace it. */

export default async (req) => {
  const given = new URL(req.url).searchParams.get('token');
  if (!sameSecret(given, await readFeedToken())) return new Response('not found', { status: 404 });

  // A failed fetch leaves that source empty in the cache. Serving it would wipe
  // the platform's stays off the phone until the app next polls, which on Google
  // can be a day away. On an error the app keeps the copy it already has.
  const cache = await readCache();
  const failed = Object.values(cache?.sources || {}).some(s => !s.ok && s.error !== 'not configured');
  if (!cache || failed) {
    return new Response('feeds unavailable', { status: 503, headers: { 'Retry-After': '300' } });
  }

  // The books only add names and details. If they cannot be read, the stays
  // still go out, unnamed, as they did before.
  const books = await readLedger().then(l => ledgerView(l, []), () => []);

  return new Response(buildOwnerCalendar(await readBlocks(), cache.ranges, new Date(), books, todayISO()), {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="loam-owner.ics"',
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
};

export const config = { path: '/api/owner-calendar.ics' };
