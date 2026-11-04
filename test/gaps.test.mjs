import { shortRuns, addDays } from '../netlify/lib/ical.mjs';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n       got  ' + g + '\n       want ' + w); }
};
const S = a => new Set(a);
const run = (busy, from, to, min) => [...shortRuns(S(busy), from, to, min)].sort();

/* The real case: Booking until 12-23, Booking again from 12-26, minimum 3 at
   Christmas. 24 and 25 stay bookable, as one two-night stay. */
const xmas = [];
for (let d = '2026-12-20'; d < '2026-12-24'; d = addDays(d, 1)) xmas.push(d);
for (let d = '2026-12-26'; d < '2026-12-29'; d = addDays(d, 1)) xmas.push(d);
eq('two-night hole at Christmas books whole',
  run(xmas, '2026-12-17', '2027-01-10', 3), [['2026-12-24', 2], ['2026-12-25', 2]]);

/* A single free night between two stays can be booked on its own */
eq('one-night hole books as one night',
  run(['2026-11-08', '2026-11-10'], '2026-11-01', '2026-11-20', 2), [['2026-11-09', 1]]);

/* Two free nights with min 2 -> long enough, nothing changes */
eq('hole as long as the minimum is left alone',
  run(['2026-05-01', '2026-05-04'], '2026-05-01', '2026-05-10', 2), []);

/* The rule is read on the night the hole starts */
eq('minimum per date',
  run(['2026-05-01', '2026-05-04'], '2026-05-01', '2026-05-10', d => d === '2026-05-02' ? 3 : 2),
  [['2026-05-02', 2], ['2026-05-03', 2]]);

/* A run that reaches the horizon is open-ended, never shortened */
eq('trailing run untouched',
  run(['2026-05-01'], '2026-05-01', '2026-05-05', 3), []);

/* The start of the window is a wall */
eq('leading short run counts',
  run(['2026-05-02'], '2026-05-01', '2026-05-10', 2), [['2026-05-01', 1]]);

/* minStay of 1 (or 0) disables the whole rule */
eq('minStay 1 disables', run(['2026-05-01', '2026-05-03'], '2026-05-01', '2026-05-10', 1), []);

/* fully booked window -> nothing to find */
eq('all busy -> nothing',
  run(['2026-05-01', '2026-05-02', '2026-05-03'], '2026-05-01', '2026-05-04', 2), []);

/* completely empty window -> one open-ended run */
eq('all free -> nothing', run([], '2026-05-01', '2026-05-10', 5), []);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
