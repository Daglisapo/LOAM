import { fetchFeed, todayISO } from '../lib/ical.mjs';
import { captureStays } from '../lib/ledger.mjs';
import { writeCache, readLedger, writeLedger } from '../lib/store.mjs';

/* Keeps the cached feeds warm so nobody ever waits on Airbnb's servers.
   Reading their feeds this often is fine — the limit that actually matters is
   how often *they* read ours, and that is theirs to control. */

export default async () => {
  const [airbnb, booking] = await Promise.all([
    fetchFeed(process.env.ICAL_AIRBNB, 'airbnb'),
    fetchFeed(process.env.ICAL_BOOKING, 'booking'),
  ]);

  const ranges = [...airbnb.ranges, ...booking.ranges];
  await writeCache({
    fetchedAt: new Date().toISOString(),
    sources: {
      airbnb: { ok: airbnb.ok, error: airbnb.error || null, events: airbnb.ranges.length },
      booking: { ok: booking.ok, error: booking.error || null, events: booking.ranges.length },
    },
    ranges,
  });

  // The feeds forget a stay soon after it ends; the ledger is what remembers it.
  // Only a feed that answered may add or cancel anything.
  const ok = [airbnb, booking].filter(f => f.ok).map(f => f.source);
  try {
    const ledger = await readLedger();
    if (captureStays(ledger, ranges, todayISO(), ok)) await writeLedger(ledger);
  } catch (e) {
    console.log('ledger capture failed', String(e.message || e));
  }

  console.log('calendar sync', JSON.stringify({ airbnb: airbnb.ok, booking: booking.ok }));
  return new Response('ok');
};

export const config = { schedule: '*/5 * * * *' };
