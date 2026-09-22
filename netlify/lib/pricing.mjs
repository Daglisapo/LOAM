/* Pure pricing maths — no storage, no Netlify, so it can be exercised with
   plain `node`. Everything here mirrors the owner's pricing plan:

     · a nightly rate that depends on the season
     · a base occupancy, with a per-head surcharge above it
     · a cleaning fee charged once per stay, not per night
     · a discount for booking direct instead of through a platform

   Rates are stored as the PLATFORM price (what Airbnb and Booking show). The
   direct price is derived, so changing the discount never means re-typing the
   whole table. */

export const DEFAULT_RATES = {
  currency: 'EUR',

  base: 72,            // fallback nightly rate when nothing more specific matches
  baseGuests: 2,       // guests already covered by the nightly rate
  extraGuest: 15,      // per additional guest, per night
  maxGuests: 6,

  cleaningFee: 0,      // the plan charges none
  directDiscount: 0.1, // booking here instead of through a platform
  minStay: 2,          // when nothing more specific says otherwise

  daily: {},           // date -> platform rate, straight from the pricing sheet
  seasons: [],         // see SEASON_PRESET — covers dates the sheet does not
  periods: [],         // ranges drawn on the calendar
};

/* ---------------------------------------------------------------- seasons */

/**
 * Orthodox Easter Sunday, as YYYY-MM-DD.
 *
 * Meeus's Julian algorithm gives the date in the Julian calendar; the Orthodox
 * churches then observe it on the corresponding Gregorian day, which is 13 days
 * later for every year between 1900 and 2099.
 */
export function orthodoxEaster(year) {
  const a = year % 4;
  const b = year % 7;
  const c = year % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31);   // 3 = March, 4 = April
  const day = ((d + e + 114) % 31) + 1;

  const julian = new Date(Date.UTC(year, month - 1, day));
  julian.setUTCDate(julian.getUTCDate() + 13);
  return julian.toISOString().slice(0, 10);
}

const iso = (d) => d.toISOString().slice(0, 10);
const shift = (date, days) => {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return iso(d);
};

/**
 * Does `date` fall inside this season?
 *
 * Four kinds of rule, because a year has four kinds of season: one-off dated
 * events, dates that recur every year, whole months, and Easter, which moves.
 */
function matches(date, season) {
  const [y, m, d] = date.split('-').map(Number);
  const md = date.slice(5);                       // MM-DD

  switch (season.kind) {
    case 'range':                                  // fixed dates, one year only
      return date >= season.start && date < season.end;

    case 'annual': {                               // same MM-DD every year
      const { from, to } = season;                 // `to` is inclusive
      return from <= to ? (md >= from && md <= to)
                        : (md >= from || md <= to); // wraps over new year
    }

    case 'months':                                 // whole calendar months
      return season.months.includes(m);

    case 'dayRange': {                             // part of one month
      if (m !== season.month) return false;
      return d >= season.from && d <= season.to;
    }

    case 'easter': {                               // ± days around Easter Sunday
      const sunday = orthodoxEaster(y);
      return date >= shift(sunday, -season.before) && date <= shift(sunday, season.after);
    }

    default:
      return false;
  }
}

/** The season that applies to a date, or null. Highest priority wins. */
export function seasonFor(date, rates) {
  let best = null;
  for (const s of rates.seasons || []) {
    if (!matches(date, s)) continue;
    if (!best || (s.priority || 0) > (best.priority || 0)) best = s;
  }
  return best;
}

/* ------------------------------------------------------------ nightly rate */

/** Platform nightly rate for one date, at base occupancy. */
export function rateFor(date, rates) {
  for (const p of rates.periods || []) {           // drawn on the calendar, wins outright
    if (date >= p.start && date < p.end) return p.price;
  }
  const daily = rates.daily && rates.daily[date];  // the pricing sheet, day by day
  if (daily != null) return daily;
  const s = seasonFor(date, rates);
  return s ? s.price : rates.base;
}

/**
 * What one night costs for a given party size.
 *
 * The discount applies to the whole occupancy-adjusted rate and is rounded
 * once. Discounting the base and the head charge separately drifts by a euro:
 * round(72 x 0.9) + round(15 x 0.9) is 79, while round(87 x 0.9) is 78, and the
 * pricing sheet means the second.
 */
export function nightlyFor(date, guests, rates, { direct = true } = {}) {
  const g = Math.max(1, Math.min(Number(guests) || 1, rates.maxGuests));
  const over = Math.max(0, g - rates.baseGuests);
  const platform = rateFor(date, rates) + over * rates.extraGuest;
  if (!direct) return platform;
  return Math.round(platform * (1 - (rates.directDiscount || 0)));
}

/** Minimum nights required to start a stay on this date. */
export function minStayFor(date, rates) {
  for (const p of rates.periods || []) {
    if (date >= p.start && date < p.end && p.minStay) return p.minStay;
  }
  const s = seasonFor(date, rates);
  return (s && s.minStay) || rates.minStay || 1;
}

/* ------------------------------------------------------------------- quote */

const round = (n) => Math.round(n * 100) / 100;

/**
 * Price a stay.
 *
 * Charged night by night, so a booking that straddles a season boundary is
 * priced correctly rather than flattened to whichever rate happened to apply on
 * the arrival day.
 */
export function quote(from, to, guests, rates, { direct = true } = {}) {
  const g = Math.max(1, Math.min(Number(guests) || 1, rates.maxGuests));
  const over = Math.max(0, g - rates.baseGuests);

  const nights = [];
  for (let d = from; d < to; d = shift(d, 1)) {
    nights.push({
      date: d,
      price: nightlyFor(d, g, rates, { direct }),
      platform: nightlyFor(d, g, rates, { direct: false }),
      season: seasonFor(d, rates)?.name || null,
    });
    if (nights.length > 400) break;
  }

  const accommodation = nights.reduce((s, n) => s + n.price, 0);
  const listPrice = nights.reduce((s, n) => s + n.platform, 0);
  const cleaning = nights.length ? (rates.cleaningFee || 0) : 0;

  return {
    nights: nights.length,
    guests: g,
    extraGuests: over,
    perNight: nights,
    accommodation: round(accommodation),
    listPrice: round(listPrice),
    saving: round(listPrice - accommodation),
    cleaning: round(cleaning),
    total: round(accommodation + cleaning),
    avgPerNight: nights.length ? round(accommodation / nights.length) : 0,
    currency: rates.currency,
    direct,
  };
}

/* --------------------------------------------------------------- the plan */

/** The owner's 2026-27 plan. Prices are what the platforms display, for two
    guests. Priority rises with how specific the rule is. */
export const SEASON_PRESET = [
  { id: 'tif',    name: 'ΔΕΘ',            kind: 'range',    start: '2026-09-05', end: '2026-09-14', price: 160, minStay: 3, priority: 60 },
  { id: 'xmas',   name: 'Χριστούγεννα',   kind: 'annual',   from: '12-22', to: '01-02',            price: 130, minStay: 3, priority: 55 },
  { id: 'easter', name: 'Πάσχα',          kind: 'easter',   before: 5, after: 5,                   price: 115, minStay: 3, priority: 50 },
  { id: 'feb',    name: 'Φεβρουάριος',    kind: 'months',   months: [2],                           price: 68,  minStay: 2, priority: 30 },
  { id: 'novA',   name: 'Αρχές Νοεμβρίου',kind: 'dayRange', month: 11, from: 1,  to: 15,           price: 82,  minStay: 2, priority: 25 },
  { id: 'novB',   name: 'Τέλη Νοεμβρίου', kind: 'dayRange', month: 11, from: 16, to: 30,           price: 74,  minStay: 2, priority: 25 },
  { id: 'high',   name: 'Υψηλή',          kind: 'months',   months: [4, 5, 6, 9, 10],              price: 98,  minStay: 2, priority: 10 },
  { id: 'mid',    name: 'Μεσαία',         kind: 'months',   months: [7, 8],                        price: 82,  minStay: 2, priority: 10 },
  { id: 'low',    name: 'Χαμηλή',         kind: 'months',   months: [1, 3, 12],                    price: 74,  minStay: 2, priority: 10 },
];
