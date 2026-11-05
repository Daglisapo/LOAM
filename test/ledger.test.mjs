import {
  readExport, mergeImport, captureStays, ledgerView, summarize, emptyLedger, taxFor,
  toISO, num, airbnbDetails, declarationDue, parseCSV, DEFAULT_SETTINGS,
} from '../netlify/lib/ledger.mjs';
import { parseICS } from '../netlify/lib/ical.mjs';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n       got  ' + g + '\n       want ' + w); }
};

/* Invented guests, laid out exactly like the real exports. */
const AIRBNB_CSV = '﻿' + [
  'Ημερομηνία,Ημερομηνία εμφάνισης,Τύπος,Κωδικός επιβεβαίωσης,Ημερομηνία κράτησης,Ημερομηνία έναρξης,Ημερομηνία αναχώρησης,Διανυκτερεύσεις,Επισκέπτης,Καταχώρηση,Λεπτομέρειες,Κωδικός αναφοράς,Νόμισμα,Ποσό,Πληρώθηκαν,Προμήθεια υπηρεσιών,Προμήθεια Γρήγορης πληρωμής,Κόστος καθαρισμού,Ακαθάριστα έσοδα,Φόρος που διαβιβάστηκε από την Airbnb,Έτος εσόδων',
  '10/25/2026,10/30/2026,Payout,,,,,,,,"Μεταφορά σε TEST, IBAN 0000 (EUR)",M-XXXX,EUR,,153.49,,,,,,',
  '10/25/2026,,Κράτηση,HMAAAA1111,10/22/2026,10/23/2026,10/25/2026,2,Άννα Δοκιμή,"LOAM · Διαμέρισμα",,,EUR,153.49,,"36,52",,0.00,190.00,0.00,2026',
  '10/21/2026,,Κράτηση,HMBBBB2222,10/19/2026,10/20/2026,10/30/2026,10,Test Guest ,"LOAM · Διαμέρισμα",,,EUR,623.78,,"148,42",,0.00,772.20,0.00,2026',
  '10/21/2026,,Ρύθμιση υπόθεσης επίλυσης προβλήματος,HMBBBB2222,,10/20/2026,10/30/2026,10,Test Guest ,"LOAM · Διαμέρισμα",Ρύθμιση για την επίλυση 1,,EUR,-551.78,,,,,-551.78,,2026',
  '',
].join('\n');

const bookingUtf8 = [
  '"Τύπος","Αριθμός κράτησης",Check-in,Checkout,"Όνομα επισκέπτη","Πάροχος υπηρεσίας πληρωμών","Κατάσταση κράτησης","Νόμισμα","Κατάσταση πληρωμής","Ποσό","Προμήθεια","Χρέωση υπηρεσίας Πληρωμών","Καθαρά","Ημερομηνία συναλλαγής\t","Κωδικός πληρωμής"',
  '"Κράτηση",1111111111,"26 Σεπ 2026","27 Σεπ 2026","Βήτα Δοκιμή","Booking.com B.V.",ok,EUR,by_booking,100.00,-14.90,-1.60,83.50,"28 Σεπ 2026",abc',
  '"Κράτηση",2222222222,"7 Οκτ 2026","12 Οκτ 2026","Gamma Test","Booking.com B.V.",ok,EUR,by_booking,384.00,-57.22,-6.14,320.64,"13 Οκτ 2026",def',
  '',
].join('\r\n');
// what Booking actually ships: those UTF-8 bytes read back as Latin-1
const BOOKING_CSV = Buffer.from(bookingUtf8, 'utf8').toString('latin1');

/* Reading values */
eq('Airbnb date', toISO('10/23/2026'), '2026-10-23');
eq('Booking date', toISO('7 Οκτ 2026'), '2026-10-07');
eq('Booking May, with its diaeresis', toISO('3 Μαΐ 2027'), '2027-05-03');
eq('English month', toISO('3 Jun 2027'), '2027-06-03');
eq('June and July are told apart', [toISO('1 Ιουν 2027'), toISO('1 Ιουλ 2027')], ['2027-06-01', '2027-07-01']);
eq('decimal comma', num('36,52'), 36.52);
eq('thousands comma', num('1,234.50'), 1234.5);
eq('plain', num('-551.78'), -551.78);
eq('empty is null', num(''), null);
eq('quoted commas stay in their field', parseCSV('a,"b, c",d\n')[0], ['a', 'b, c', 'd']);

/* Airbnb */
const air = readExport(AIRBNB_CSV);
eq('Airbnb is recognised', air.kind, 'airbnb');
eq('payouts are skipped, one item per stay', air.items.map(i => i.code), ['HMAAAA1111', 'HMBBBB2222']);
eq('Airbnb money', air.items[0].money, { gross: 190, commission: 36.52, net: 153.49, cleaning: 0 });
eq('Airbnb dates and guest', [air.items[0].start, air.items[0].end, air.items[0].guest.name], ['2026-10-23', '2026-10-25', 'Άννα Δοκιμή']);
eq('a resolution becomes an adjustment', air.items[1].adjustments.map(a => [a.amount, a.gross]), [[-551.78, -551.78]]);

/* Booking */
const bk = readExport(BOOKING_CSV);
eq('double-encoded Booking file is repaired and recognised', bk.kind, 'booking');
eq('Booking guest name survives the repair', bk.items[0].guest.name, 'Βήτα Δοκιμή');
eq('Booking money: commission includes the payment fee', bk.items[1].money, { gross: 384, commission: 63.36, net: 320.64 });
eq('Booking dates', [bk.items[1].start, bk.items[1].end], ['2026-10-07', '2026-10-12']);

/* Template */
const tpl = readExport('source,code,checkin,checkout,guest,adults,children,phone,email,country,afm,id_doc,gross,commission,net,notes\n'
  + 'airbnb,HMCCCC3333,2026-03-01,2026-03-04,Δέλτα,2,1,+30 690,,Ελλάδα,094014201,,300,45,,από screenshot\n');
eq('template is recognised', tpl.kind, 'template');
eq('template fills guest and works out net', [tpl.items[0].guest.adults, tpl.items[0].guest.afm, tpl.items[0].money.net], [2, '094014201', 255]);
eq('an unknown file is refused', (() => { try { readExport('a,b\n1,2\n'); return 'read'; } catch (e) { return 'refused'; } })(), 'refused');

/* Feeds -> ledger */
const ICS = [
  'BEGIN:VCALENDAR',
  'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20261023', 'DTEND;VALUE=DATE:20261025', 'SUMMARY:Reserved',
  'DESCRIPTION:Reservation URL: https://www.airbnb.com/hosting/reservations/details/HMAAAA1111\\nPhone Number (Last 4 Digits): 4321', 'END:VEVENT',
  'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20261105', 'DTEND;VALUE=DATE:20261106', 'SUMMARY:Airbnb (Not available)', 'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');
const feed = parseICS(ICS).map(r => ({ ...r, source: 'airbnb' }));
eq('the reader keeps Airbnb\'s description', airbnbDetails(feed[0].description), { code: 'HMAAAA1111', phone4: '4321' });

const L = emptyLedger();
const bookingFeed = [{ source: 'booking', start: '2026-10-07', end: '2026-10-12', summary: 'CLOSED - Not available' },
                     { source: 'booking', start: '2026-12-20', end: '2026-12-23', summary: 'CLOSED - Not available' }];
eq('capture records stays', captureStays(L, [...feed, ...bookingFeed], '2026-10-20', ['airbnb', 'booking']), true);
eq('closed dates are not stays', Object.keys(L.records).sort(), ['airbnb:HMAAAA1111', 'booking@2026-10-07', 'booking@2026-12-20']);
eq('capturing again changes nothing', captureStays(L, [...feed, ...bookingFeed], '2026-10-20', ['airbnb', 'booking']), false);

/* Imports land on the captured stays */
const r1 = mergeImport(L, air.items, '2026-11-05');
eq('Airbnb import matches on code and adds the rest', [r1.added, r1.updated], [1, 1]);
const r2 = mergeImport(L, bk.items, '2026-11-05');
eq('Booking import matches the captured stay by date', [r2.added, r2.updated], [1, 1]);
eq('the matched Booking stay keeps its key and gains its number',
  [L.records['booking@2026-10-07'].code, L.records['booking@2026-10-07'].guest.name], ['2222222222', 'Gamma Test']);
const again = mergeImport(L, air.items, '2026-11-05');
eq('importing the same file twice changes nothing', [again.added, again.updated, again.unchanged], [0, 0, 2]);

/* Cancellation */
eq('a future stay that leaves a working feed is cancelled',
  [captureStays(L, feed, '2026-11-01', ['airbnb', 'booking']), L.records['booking@2026-12-20'].status], [true, 'cancelled']);
eq('a past stay that leaves the feed is kept', L.records['booking@2026-10-07'].status, 'ok');
eq('nothing is cancelled when that feed is down',
  (() => { const l = emptyLedger(); captureStays(l, bookingFeed, '2026-10-01', ['booking']); captureStays(l, [], '2026-10-01', ['airbnb']); return Object.values(l.records).map(r => r.status); })(),
  ['ok', 'ok']);

/* The view */
const blocks = [
  { id: 'b1', start: '2026-10-30', end: '2026-11-02', note: '', guest: { name: 'Direct Guest', total: 210 } },
  { id: 'b2', start: '2026-11-10', end: '2026-11-12', note: 'βάψιμο' },
];
const view = ledgerView(L, blocks);
const byKey = k => view.find(v => v.key === k);
eq('adjustments are applied to the totals', [byKey('airbnb:HMBBBB2222').gross, byKey('airbnb:HMBBBB2222').net], [220.42, 72]);
eq('direct bookings join the view', [byKey('direct:b1').gross, byKey('direct:b1').commission], [210, 0]);
eq('a block with no guest and no money is not a stay', byKey('direct:b2').ignored, true);

/* The months */
const S = { aadeDirect: true, takk: { high: 8, low: 2 }, tax: { base: 'gross', brackets: [{ upTo: 12000, rate: 15 }, { upTo: 24000, rate: 25 }, { upTo: 35000, rate: 35 }, { upTo: null, rate: 45 }] } };
const years = summarize(view, [{ month: '2026-10', category: 'Ρεύμα', amount: 40 }], S);
const oct = years[2026].months[9], nov = years[2026].months[10];
eq('a stay across months is split by night', [oct.bySource.direct.nights, nov.bySource.direct.nights], [2, 1]);
eq('its money follows its nights', [oct.bySource.direct.gross, nov.bySource.direct.gross], [140, 70]);
eq('ΤΑΚΚ is high in October and low in November', [oct.takk / oct.nights, nov.takk / nov.nights], [8, 2]);
eq('expenses land in their month', [oct.expenses, oct.byCategory['Ρεύμα']], [40, 40]);
eq('the cancelled stay is left out', years[2026].months[11].nights, 0);
eq('occupancy', oct.occupancy, Math.round(10000 * oct.nights / 31) / 100);

/* A guest who left early */
const E = emptyLedger();
captureStays(E, [{ source: 'booking', start: '2026-10-07', end: '2026-10-12', summary: 'CLOSED' }], '2026-10-01', ['booking']);
Object.assign(E.records['booking@2026-10-07'], { feedStart: '2026-10-07', start: '2026-10-07', end: '2026-10-09', datesEdited: true });
eq('the feed does not undo a corrected check-out',
  [captureStays(E, [{ source: 'booking', start: '2026-10-07', end: '2026-10-12', summary: 'CLOSED' }], '2026-10-01', ['booking']), E.records['booking@2026-10-07'].end], [false, '2026-10-09']);
mergeImport(E, bk.items, '2026-11-05');
eq('nor does an import', E.records['booking@2026-10-07'].end, '2026-10-09');
E.records['booking@2026-10-07'].start = '2026-10-08';
eq('a stay re-dated by hand is still found on its feed dates',
  [captureStays(E, [{ source: 'booking', start: '2026-10-07', end: '2026-10-12', summary: 'CLOSED' }], '2026-10-01', ['booking']), Object.keys(E.records).length], [false, 2]);

/* Occupancy over the let months only */
const span = summarize(view, [], S, '2026-11-05')[2026].totals;
eq('the year counts from the first month with a stay to this one', [span.fromMonth, span.days], [8, 30 + 31 + 30]);

/* Tax */
eq('tax below the first bracket', taxFor(10000, S.tax.brackets), 1500);
eq('tax across two brackets', taxFor(20000, S.tax.brackets), 3800);
eq('tax across all four', taxFor(40000, S.tax.brackets), 1800 + 3000 + 3850 + 2250);

/* Direct bookings left out of the ΑΑΔΕ figures, by default */
const stay = (source, start, end, gross, extra) => ({
  key: source + start, source, start, end, nights: (Date.parse(end) - Date.parse(start)) / 864e5,
  status: 'ok', ignored: false, hasMoney: true, gross, commission: 0, net: gross, ...extra,
});
const mixed = [stay('direct', '2026-10-01', '2026-10-03', 200), stay('airbnb', '2026-10-05', '2026-10-06', 100)];
const noDirect = summarize(mixed, [], { ...S, aadeDirect: false })[2026].months[9];
eq('direct nights pay no ΤΑΚΚ', noDirect.takk, 8);
eq('direct income is not taxed', [noDirect.taxBase, noDirect.tax], [100, 15]);
eq('but it is still income', [noDirect.gross, noDirect.nights], [300, 3]);
const withDirect = summarize(mixed, [], S)[2026].months[9];
eq('the setting brings them back', [withDirect.takk, withDirect.tax], [24, 45]);
eq('the default leaves direct bookings out', DEFAULT_SETTINGS.aadeDirect, false);

/* A cancellation that still paid */
const cancelled = [stay('airbnb', '2026-10-20', '2026-10-30', 220.42, { status: 'cancelled', commission: 148.42, net: 72 })];
const c = summarize(cancelled, [], S)[2026].months[9];
eq('its money counts in the month it would have begun', [c.gross, c.net], [220.42, 72]);
eq('its nights and ΤΑΚΚ do not', [c.nights, c.takk], [0, 0]);
eq('a cancellation that paid nothing counts for nothing',
  summarize([stay('booking', '2026-10-01', '2026-10-03', 0, { status: 'cancelled', net: 0 })], [], S)[2026], undefined);
eq('the template can mark a cancellation',
  readExport('source,code,checkin,checkout,guest,gross,commission,net,status\nairbnb,HMX,2026-10-20,2026-10-30,L,220.42,148.42,72,ακυρώθηκε\n').items[0].status, 'cancelled');

/* Typed-up totals after an export with a refund */
const R = emptyLedger();
mergeImport(R, air.items, '2026-11-05');
mergeImport(R, readExport('source,code,checkin,checkout,guest,gross,commission,net,status\nairbnb,HMBBBB2222,2026-10-20,2026-10-30,Test Guest,220.42,148.42,72,ακυρώθηκε\n').items, '2026-11-05');
const rv = ledgerView(R, []).find(v => v.code === 'HMBBBB2222');
eq('final totals are not adjusted a second time', [rv.gross, rv.net, rv.status], [220.42, 72, 'cancelled']);
mergeImport(R, air.items, '2026-11-05');
const rv2 = ledgerView(R, []).find(v => v.code === 'HMBBBB2222');
eq('the export imported again lands on the same totals', [rv2.gross, rv2.net], [220.42, 72]);

/* A second file that only fills in details */
const N = emptyLedger();
mergeImport(N, readExport('source,code,checkin,checkout,guest,gross,commission,net,notes\nbooking,111,2026-10-16,2026-10-18,Guest,168,27.72,140.28,πρώτη σημείωση\n').items, '2026-11-05');
const extra = readExport('source,code,checkin,checkout,guest,adults,afm,notes\nbooking,111,2026-10-16,2026-10-18,,2,094014201,επαγγελματικό ταξίδι\n').items;
mergeImport(N, extra, '2026-11-05');
const nv = ledgerView(N, [])[0];
eq('details are added and the money kept', [nv.guest.name, nv.guest.adults, nv.guest.afm, nv.net], ['Guest', 2, '094014201', 140.28]);
eq('a new note is added to the old one', nv.notes, 'πρώτη σημείωση · επαγγελματικό ταξίδι');
eq('importing it again adds nothing', [mergeImport(N, extra, '2026-11-05').unchanged, ledgerView(N, [])[0].notes.split(' · ').length], [1, 2]);

/* AADE */
eq('declaration due the 20th of the next month', declarationDue('2026-10-25'), '2026-11-20');
eq('December rolls into January', declarationDue('2026-12-31'), '2027-01-20');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
