import { fetchFeed } from '../lib/ical.mjs';
import { writeCache } from '../lib/store.mjs';

/* Keeps the cached feeds warm so nobody ever waits on Airbnb's servers.
   Reading their feeds this often is fine — the limit that actually matters is
   how often *they* read ours, and that is theirs to control. */

export default async () => {
  const [airbnb, booking] = await Promise.all([
    fetchFeed(process.env.ICAL_AIRBNB, 'airbnb'),
    fetchFeed(process.env.ICAL_BOOKING, 'booking'),
  ]);

  await writeCache({
    fetchedAt: new Date().toISOString(),
    sources: {
      airbnb: { ok: airbnb.ok, error: airbnb.error || null, events: airbnb.ranges.length },
      booking: { ok: booking.ok, error: booking.error || null, events: booking.ranges.length },
    },
    ranges: [...airbnb.ranges, ...booking.ranges],
  });

  console.log('calendar sync', JSON.stringify({ airbnb: airbnb.ok, booking: booking.ok }));
  return new Response('ok');
};

export const config = { schedule: '*/5 * * * *' };
