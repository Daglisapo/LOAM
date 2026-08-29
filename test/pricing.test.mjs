import { rateFor, quote, DEFAULT_RATES } from '../netlify/lib/pricing.mjs';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n       got  ' + g + '\n       want ' + w); }
};

// Apostolos's setup: 120 base, 160 for the nights of 3–13 September
const R = {
  ...DEFAULT_RATES,
  base: 120, extraGuest: 5, includedGuests: 4, maxGuests: 6,
  periods: [{ id: 'p1', start: '2026-09-03', end: '2026-09-14', price: 160, label: 'Early September' }],
};

eq('base night',            rateFor('2026-08-20', R), 120);
eq('night before period',   rateFor('2026-09-02', R), 120);
eq('first night of period', rateFor('2026-09-03', R), 160);
eq('last night of period',  rateFor('2026-09-13', R), 160);
eq('night after period',    rateFor('2026-09-14', R), 120);

// 3 nights in low season, 4 guests -> no extra
eq('3 nights x 120, 4 guests', quote('2026-08-20', '2026-08-23', 4, R).total, 360);

// same stay, 5 guests -> +5 per night
eq('3 nights, 5 guests', quote('2026-08-20', '2026-08-23', 5, R).total, 360 + 15);
// 6 guests -> +10 per night
eq('3 nights, 6 guests', quote('2026-08-20', '2026-08-23', 6, R).total, 360 + 30);
// 7 guests is clamped to the 6 the flat sleeps
eq('7 guests clamps to 6', quote('2026-08-20', '2026-08-23', 7, R).guests, 6);

// high season, 4 nights (3,4,5,6 Sep) at 160
eq('4 high-season nights', quote('2026-09-03', '2026-09-07', 4, R).total, 640);

// the interesting one: a stay straddling the period boundary
const straddle = quote('2026-09-01', '2026-09-05', 4, R);   // nights 1,2 @120 · 3,4 @160
eq('straddling stay nights', straddle.nights, 4);
eq('straddling stay priced per night', straddle.total, 120 + 120 + 160 + 160);
eq('straddling per-night breakdown', straddle.perNight.map(n => n.price), [120, 120, 160, 160]);

// straddle with 6 guests: extra applies to every night
eq('straddle, 6 guests', quote('2026-09-01', '2026-09-05', 6, R).total, 560 + 10 * 4);

// one night
eq('single night', quote('2026-09-10', '2026-09-11', 2, R).total, 160);

// later period wins when two overlap
const R2 = { ...R, periods: [...R.periods, { id: 'p2', start: '2026-09-10', end: '2026-09-12', price: 200 }] };
eq('overlapping period, later wins', rateFor('2026-09-10', R2), 200);
eq('outside the overlap keeps 160', rateFor('2026-09-09', R2), 160);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
