import { fetchFeed, nightsOf, toRanges, todayISO, addDays, shortRuns } from '../lib/ical.mjs';
import { readBlocks, readCache, writeCache } from '../lib/store.mjs';
import { readRates, rateFor, minStayFor } from '../lib/rates.mjs';

const TTL_MS = 5 * 60 * 1000;   // how stale the cached feeds may get
const HORIZON_DAYS = 400;       // ignore anything further out than this

// Mirror the listing's own rules. iCal carries none of this, so without it the
// site offers nights the platforms would refuse to book.
const NOTICE_DAYS = Number(process.env.ADVANCE_NOTICE_DAYS || 3);

/** Pull both remote feeds and cache the result. */
async function refresh() {
  const [airbnb, booking] = await Promise.all([
    fetchFeed(process.env.ICAL_AIRBNB, 'airbnb'),
    fetchFeed(process.env.ICAL_BOOKING, 'booking'),
  ]);
  const payload = {
    fetchedAt: new Date().toISOString(),
    sources: {
      airbnb: { ok: airbnb.ok, error: airbnb.error || null, events: airbnb.ranges.length },
      booking: { ok: booking.ok, error: booking.error || null, events: booking.ranges.length },
    },
    ranges: [...airbnb.ranges, ...booking.ranges],
  };
  await writeCache(payload);
  return payload;
}

export default async (req) => {
  const url = new URL(req.url);
  const force = url.searchParams.get('refresh') === '1';

  let cache = force ? null : await readCache();
  const stale = !cache || (Date.now() - Date.parse(cache.fetchedAt)) > TTL_MS;
  if (stale) {
    try {
      cache = await refresh();
    } catch (e) {
      // serve whatever we had rather than showing the flat nothing
      if (!cache) cache = { fetchedAt: null, sources: {}, ranges: [], error: String(e.message || e) };
    }
  }

  const blocks = await readBlocks();
  const direct = blocks.map(b => ({ start: b.start, end: b.end, summary: b.note || 'Direct booking', source: 'direct' }));

  const today = todayISO();
  const limit = addDays(today, HORIZON_DAYS);
  const all = [...cache.ranges, ...direct].filter(r => r.end > today && r.start < limit);

  // per-source nights, so the owner view can colour them
  const bySource = {};
  for (const src of ['airbnb', 'booking', 'direct']) {
    bySource[src] = [...nightsOf(all.filter(r => r.source === src))].sort();
  }

  const booked = nightsOf(all);
  const rates = await readRates();

  // free nights inside the advance notice cannot be booked
  const firstBookable = addDays(today, NOTICE_DAYS);
  const notice = new Set();
  for (let d = today; d < firstBookable; d = addDays(d, 1)) {
    if (!booked.has(d)) notice.add(d);
  }

  const busySet = new Set([...booked, ...notice]);
  const busy = [...busySet].sort();

  // A hole between two stays shorter than the season's minimum stays bookable,
  // whole. The minimum travels with the season, so the same two-night hole needs
  // shrinking at Christmas and not in March.
  const short = shortRuns(busySet, today, limit, d => minStayFor(d, rates));

  // The platform rate for each bookable night, untouched. The page applies the
  // occupancy surcharge and the discount together, because rounding the two
  // separately drifts by a euro against the pricing sheet.
  const prices = {}, stays = {};
  for (let d = firstBookable; d < limit; d = addDays(d, 1)) {
    if (busySet.has(d)) continue;
    prices[d] = rateFor(d, rates);
    stays[d] = short.get(d) ?? minStayFor(d, rates);
  }

  return new Response(JSON.stringify({
    updatedAt: cache.fetchedAt,
    today,
    rules: { noticeDays: NOTICE_DAYS, firstBookable },
    rates: {
      currency: rates.currency,
      baseGuests: rates.baseGuests,
      extraGuest: rates.extraGuest,
      underGuest: rates.underGuest,
      maxGuests: rates.maxGuests,
      cleaningFee: rates.cleaningFee,
      directDiscount: rates.directDiscount,
    },
    prices,
    minStay: stays,
    sources: cache.sources,
    busy,
    ranges: toRanges(busy),
    bySource,
    unbookable: [...notice].sort(),
  }), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // short public cache: visitors get a fast answer, staleness stays bounded
      'Cache-Control': 'public, max-age=60, stale-while-revalidate=240',
      'Access-Control-Allow-Origin': '*',
    },
  });
};

export const config = { path: '/api/availability' };
