import { fetchFeed, nightsOf, toRanges, todayISO, addDays, unbookableGaps } from '../lib/ical.mjs';
import { readBlocks, readCache, writeCache } from '../lib/store.mjs';
import { readRates, rateFor } from '../lib/rates.mjs';

const TTL_MS = 5 * 60 * 1000;   // how stale the cached feeds may get
const HORIZON_DAYS = 400;       // ignore anything further out than this

// Mirror the listing's own rules. iCal carries none of this, so without it the
// site offers nights the platforms would refuse to book.
const MIN_STAY = Number(process.env.MIN_STAY || 2);
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

  // nights that are free on paper but cannot actually be booked
  const firstBookable = addDays(today, NOTICE_DAYS);
  const gaps = unbookableGaps(booked, today, limit, MIN_STAY);
  for (let d = today; d < firstBookable; d = addDays(d, 1)) {
    if (!booked.has(d)) gaps.add(d);
  }

  const busySet = new Set([...booked, ...gaps]);
  const busy = [...busySet].sort();

  // nightly prices for the dates a guest could actually book
  const rates = await readRates();
  const prices = {};
  for (let d = firstBookable; d < limit; d = addDays(d, 1)) {
    if (!busySet.has(d)) prices[d] = rateFor(d, rates);
  }

  return new Response(JSON.stringify({
    updatedAt: cache.fetchedAt,
    today,
    rules: { minStay: MIN_STAY, noticeDays: NOTICE_DAYS, firstBookable },
    rates: {
      base: rates.base, currency: rates.currency,
      includedGuests: rates.includedGuests, extraGuest: rates.extraGuest, maxGuests: rates.maxGuests,
      periods: rates.periods,
    },
    prices,
    sources: cache.sources,
    busy,
    ranges: toRanges(busy),
    bySource,
    unbookable: [...gaps].sort(),
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
