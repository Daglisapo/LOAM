import { unbookableGaps, addDays } from '../netlify/lib/ical.mjs';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n       got  ' + g + '\n       want ' + w); }
};
const S = a => new Set(a);
const run = (busy, from, to, min) => [...unbookableGaps(S(busy), from, to, min)].sort();

/* The real case: Oct block ends after 11-06, next starts 11-08.
   11-07 is a single free night and min stay is 2 -> unbookable. */
const real = [];
for (let d = '2026-11-01'; d < '2026-11-07'; d = addDays(d, 1)) real.push(d);
for (let d = '2026-11-08'; d < '2026-11-20'; d = addDays(d, 1)) real.push(d);
eq('single-night gap is closed', run(real, '2026-11-01', '2026-11-20', 2), ['2026-11-07']);

/* Two free nights with min 2 -> bookable, leave alone */
eq('two-night gap stays open',
  run(['2026-05-01','2026-05-04'], '2026-05-01', '2026-05-10', 2), []);

/* Two free nights with min 3 -> unbookable */
eq('two-night gap closed when min is 3',
  run(['2026-05-01','2026-05-04'], '2026-05-01', '2026-05-10', 3), ['2026-05-02','2026-05-03']);

/* A run that reaches the horizon is open-ended, never closed */
eq('trailing run untouched',
  run(['2026-05-01'], '2026-05-01', '2026-05-05', 3), []);

/* A short run at the very start is still unbookable — you cannot book 1 night */
eq('leading short run closed',
  run(['2026-05-02'], '2026-05-01', '2026-05-10', 2), ['2026-05-01']);

/* minStay of 1 (or 0) disables the whole rule */
eq('minStay 1 disables', run(['2026-05-01','2026-05-03'], '2026-05-01', '2026-05-10', 1), []);

/* fully booked window -> nothing to close */
eq('all busy -> no gaps',
  run(['2026-05-01','2026-05-02','2026-05-03'], '2026-05-01', '2026-05-04', 2), []);

/* completely empty window -> one open-ended run, nothing closed */
eq('all free -> no gaps', run([], '2026-05-01', '2026-05-10', 5), []);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
