/* Pure pricing maths — no storage, no Netlify. Kept separate from rates.mjs so
   it can be exercised without a Blobs binding. */

/* What LOAM wants to receive per night for a direct booking — no platform
   commission in the middle. */
export const DEFAULT_RATES = {
  base: 120,
  currency: 'EUR',
  includedGuests: 4,   // guests covered by the base rate
  extraGuest: 5,       // per head beyond includedGuests
  maxGuests: 6,
  periods: [],         // [{ id, start, end (exclusive), price, label }]
};

/** Nightly rate for a single date. Later periods win, so an edit sits on top. */
export function rateFor(date, rates) {
  let price = rates.base;
  for (const p of rates.periods || []) {
    if (date >= p.start && date < p.end) price = p.price;
  }
  return price;
}

/**
 * Total for a stay. Priced night by night, so a booking that straddles a
 * seasonal boundary is charged correctly instead of being flattened to one rate.
 */
export function quote(from, to, guests, rates) {
  const nights = [];
  for (let d = from; d < to; ) {
    nights.push({ date: d, price: rateFor(d, rates) });
    const n = new Date(d + 'T00:00:00Z');
    n.setUTCDate(n.getUTCDate() + 1);
    d = n.toISOString().slice(0, 10);
    if (nights.length > 400) break;
  }
  const g = Math.max(1, Math.min(Number(guests) || 1, rates.maxGuests));
  const extra = Math.max(0, g - rates.includedGuests) * rates.extraGuest;

  const accommodation = nights.reduce((s, n) => s + n.price, 0);
  return {
    nights: nights.length,
    guests: g,
    perNight: nights,
    extraGuestPerNight: extra,
    total: accommodation + extra * nights.length,
    currency: rates.currency,
  };
}
