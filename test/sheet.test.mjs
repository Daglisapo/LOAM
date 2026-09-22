/* Checks the engine against every one of the 256 days in the owner's pricing
   sheet, for every party size. The sheet is the source of truth; this test
   fails the moment the two drift apart. */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nightlyFor, quote, DEFAULT_RATES } from '../netlify/lib/pricing.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const days = JSON.parse(readFileSync(join(here, 'fixtures', 'pricing-sheet.json'), 'utf8'));

const daily = {};
for (const d of days) daily[d.date] = d.platform;
const R = { ...DEFAULT_RATES, daily, seasons: [] };

let pass = 0, fail = 0;
const bad = [];
const check = (name, got, want, ctx) => {
  if (got === want) pass++;
  else { fail++; if (bad.length < 8) bad.push(`${name} ${ctx}: got ${got}, sheet says ${want}`); }
};

for (const d of days) {
  // platform column F..J
  check('platform', nightlyFor(d.date, 2, R, { direct: false }), d.platform, d.date);
  check('platform', nightlyFor(d.date, 3, R, { direct: false }), d.g3, d.date);
  check('platform', nightlyFor(d.date, 4, R, { direct: false }), d.g4, d.date);
  check('platform', nightlyFor(d.date, 5, R, { direct: false }), d.g5, d.date);
  check('platform', nightlyFor(d.date, 6, R, { direct: false }), d.g6, d.date);
  // site column K
  check('site', nightlyFor(d.date, 2, R), d.site, d.date);
}

console.log(`per-night checks: ${pass} passed, ${fail} failed`);
bad.forEach(b => console.log('  ' + b));

/* a whole stay, cross-checked by hand */
const wk = days.find(d => d.weekend);
const one = quote(wk.date, next(wk.date), 2, R);
function next(x) { const t = new Date(x + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + 1); return t.toISOString().slice(0, 10); }

let extra = 0;
const t = (name, got, want) => { if (got === want) pass++; else { fail++; console.log(`  FAIL ${name}: ${got} != ${want}`); } };

t('one weekend night, site price', one.total, wk.site);
t('no cleaning fee', one.cleaning, 0);
t('saving equals the discount', one.saving, wk.platform - wk.site);

/* three nights spanning a weekend boundary must be summed per night */
const start = days.findIndex(d => d.dow === 'Πεμ');
if (start >= 0) {
  const seg = days.slice(start, start + 3);
  const q = quote(seg[0].date, next(seg[2].date), 4, R);
  const expect = seg.reduce((s, d) => s + Math.round((d.platform + 30) * 0.9), 0);
  t('three nights across the weekend, 4 guests', q.total, expect);
}


/* ---- single occupancy: Booking prices 10 below base, so we must too ---- */
const Rs = { ...R, underGuest: 10 };
const d0 = days[0];
t('one guest, platform', nightlyFor(d0.date, 1, Rs, { direct: false }), d0.platform - 10);
t('one guest, site',     nightlyFor(d0.date, 1, Rs), Math.round((d0.platform - 10) * 0.9));
t('two guests unaffected', nightlyFor(d0.date, 2, Rs, { direct: false }), d0.platform);
t('four guests unaffected', nightlyFor(d0.date, 4, Rs, { direct: false }), d0.platform + 30);
t('zero underGuest is a no-op', nightlyFor(d0.date, 1, { ...R, underGuest: 0 }, { direct: false }), d0.platform);

console.log(`\nwith single occupancy: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
