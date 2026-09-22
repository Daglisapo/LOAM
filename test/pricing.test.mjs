import {
  rateFor, minStayFor, seasonFor, quote, orthodoxEaster,
  DEFAULT_RATES, SEASON_PRESET,
} from '../netlify/lib/pricing.mjs';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n       got  ' + g + '\n       want ' + w); }
};

const R = { ...DEFAULT_RATES, seasons: SEASON_PRESET };

/* ---- Orthodox Easter, checked against the published dates ---- */
eq('Easter 2026', orthodoxEaster(2026), '2026-04-12');
eq('Easter 2027', orthodoxEaster(2027), '2027-05-02');
eq('Easter 2028', orthodoxEaster(2028), '2028-04-16');
eq('Easter 2025', orthodoxEaster(2025), '2025-04-20');

/* ---- every row of the plan resolves to its own rate ---- */
eq('TIF',            rateFor('2026-09-08', R), 160);
eq('Christmas',      rateFor('2026-12-27', R), 130);
eq('New Year',       rateFor('2027-01-01', R), 130);
eq('Easter window',  rateFor('2026-04-12', R), 115);
eq('February',       rateFor('2027-02-14', R), 68);
eq('early November', rateFor('2026-11-05', R), 82);
eq('late November',  rateFor('2026-11-20', R), 74);
eq('high season',    rateFor('2026-05-10', R), 98);
eq('mid season',     rateFor('2026-07-20', R), 82);
eq('low season',     rateFor('2027-03-10', R), 74);

/* ---- the boundaries, where a rule either wins or does not ---- */
eq('day before TIF is high season',  rateFor('2026-09-04', R), 98);
eq('last night of TIF',              rateFor('2026-09-13', R), 160);
eq('day after TIF returns to high',  rateFor('2026-09-14', R), 98);
eq('21 Dec is still low',            rateFor('2026-12-21', R), 74);
eq('22 Dec starts Christmas',        rateFor('2026-12-22', R), 130);
eq('3 Jan back to low',              rateFor('2027-01-03', R), 74);
eq('Easter -5',                      rateFor('2026-04-07', R), 115);
eq('Easter -6 is high season',       rateFor('2026-04-06', R), 98);
eq('Easter +5',                      rateFor('2026-04-17', R), 115);
eq('Easter +6 is high season',       rateFor('2026-04-18', R), 98);

/* Easter 2027 falls in May, so it must override high season there instead */
eq('Easter 2027 beats May', rateFor('2027-05-02', R), 115);
eq('May away from Easter',  rateFor('2027-05-20', R), 98);

/* ---- minimum stay travels with the season ---- */
eq('TIF needs 3 nights',      minStayFor('2026-09-08', R), 3);
eq('Christmas needs 3',       minStayFor('2026-12-27', R), 3);
eq('Easter needs 3',          minStayFor('2026-04-12', R), 3);
eq('high season needs 2',     minStayFor('2026-05-10', R), 2);

/* ---- a manual override drawn on the calendar beats every season ---- */
const withOverride = { ...R, periods: [{ id: 'p1', start: '2026-09-07', end: '2026-09-09', price: 200, minStay: 4 }] };
eq('override beats TIF',        rateFor('2026-09-08', withOverride), 200);
eq('override carries minStay',  minStayFor('2026-09-08', withOverride), 4);
eq('outside the override',      rateFor('2026-09-10', withOverride), 160);

/* ---- the pricing table, reproduced ----
   Platform column, two guests, one night. */
const platform = (date, guests) => quote(date, shift(date), guests, R, { direct: false });
function shift(d) { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); }

/* +15 per head above two, as the 2026-27 plan sets it */
const tifNight = (g) => quote('2026-09-08', '2026-09-09', g, R, { direct: false }).accommodation;
eq('TIF 2 guests', tifNight(2), 160);
eq('TIF 3 guests', tifNight(3), 175);
eq('TIF 4 guests', tifNight(4), 190);
eq('TIF 5 guests', tifNight(5), 205);

const febNight = (g) => quote('2027-02-10', '2027-02-11', g, R, { direct: false }).accommodation;
eq('February 2 guests', febNight(2), 68);
eq('February 5 guests', febNight(5), 113);

/* the direct price is the platform price less 10%, rounded once */
eq('TIF direct, 2 guests',  quote('2026-09-08', '2026-09-09', 2, R).accommodation, 144);
eq('Christmas direct',      quote('2026-12-27', '2026-12-28', 2, R).accommodation, 117);
eq('Easter direct',         quote('2026-04-12', '2026-04-13', 2, R).accommodation, 104);

/* ---- a whole stay, with cleaning ---- */
const stay = quote('2026-09-07', '2026-09-10', 4, R);      // 3 nights of TIF, 4 guests
eq('stay nights',        stay.nights, 3);
eq('stay accommodation', stay.accommodation, 513);          // round(190 x 0.9) x 3
eq('stay list price',    stay.listPrice, 570);              // (160 + 30) x 3
eq('stay saving',        stay.saving, 57);
eq('no cleaning fee',    stay.cleaning, 0);
eq('stay total',         stay.total, 513);

const platformStay = quote('2026-09-07', '2026-09-10', 4, R, { direct: false });
eq('platform stay pays list',   platformStay.total, 570);
eq('platform stay saves nothing', platformStay.saving, 0);

/* ---- a stay that crosses a season boundary is priced per night ---- */
const cross = quote('2026-09-12', '2026-09-16', 2, R, { direct: false });  // 12,13 TIF · 14,15 high
eq('crossing nights',        cross.nights, 4);
eq('crossing per-night',     cross.perNight.map(n => n.price), [160, 160, 98, 98]);
eq('crossing accommodation', cross.accommodation, 516);

/* ---- guest count is clamped to what the flat sleeps ---- */
eq('9 guests clamp to 6', quote('2026-07-01', '2026-07-02', 9, R).guests, 6);
eq('single guest pays base rate', quote('2026-07-01', '2026-07-02', 1, R, { direct: false }).accommodation, 82);

/* ---- cleaning is not charged on an empty range ---- */
eq('no nights, no cleaning', quote('2026-07-01', '2026-07-01', 2, R).cleaning, 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
