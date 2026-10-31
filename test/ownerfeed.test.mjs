import { buildOwnerCalendar, ownerEvents } from '../netlify/lib/ownerfeed.mjs';
import { parseICS } from '../netlify/lib/ical.mjs';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n       got  ' + g + '\n       want ' + w); }
};
const brief = list => list.map(e => [e.title, e.start, e.end]);
const unfolded = ics => ics.replace(/\r\n /g, '');

const direct = {
  id: 'b1', start: '2026-12-10', end: '2026-12-14', note: 'Με αυτοκίνητο, 2 βαλίτσες',
  guest: {
    name: 'Γιώργος Νικολάου', phone: '+30 6987654321', adults: 2, children: 1,
    afm: '094014201', idDoc: 'AK123456', arrival: '15:30', total: 420.5, deposit: 150,
  },
};

/* Titles */
eq('direct booking names the guest and the head count',
  ownerEvents([direct], [])[0].title, 'LOAM · Γιώργος Νικολάου · 3 άτομα');
eq('one guest is singular',
  ownerEvents([{ ...direct, guest: { name: 'Α', adults: 1 } }], [])[0].title, 'LOAM · Α · 1 άτομο');
eq('an old booking with only a note shows the note',
  ownerEvents([{ id: 'b2', start: '2026-12-01', end: '2026-12-03', note: 'Μαρία, 2 άτομα' }], [])[0].title,
  'LOAM · Μαρία, 2 άτομα');
eq('a maintenance block has no guest',
  ownerEvents([{ id: 'b3', start: '2026-12-01', end: '2026-12-03', note: '' }], [])[0].title, 'LOAM · Κλειστό');

/* Details */
const d = ownerEvents([direct], [])[0].description;
for (const want of ['Τηλέφωνο: +30 6987654321', 'ΑΦΜ: 094014201', 'Ταυτότητα / διαβατήριο: AK123456',
  'Ώρα άφιξης: 15:30', 'Υπόλοιπο: 270,5 €', 'Σημειώσεις: Με αυτοκίνητο, 2 βαλίτσες']) {
  eq('details carry ' + want.split(':')[0], d.includes(want), true);
}
eq('empty fields are left out', d.includes('Email'), false);
eq('a platform stay has no details',
  ownerEvents([], [{ source: 'airbnb', summary: 'Reserved', start: '2026-11-01', end: '2026-11-03' }])[0].description,
  undefined);

/* The same stay arriving three times shows once */
eq('echoes of a direct booking disappear',
  brief(ownerEvents([direct], [
    { source: 'airbnb', summary: 'Airbnb (Not available)', start: '2026-12-10', end: '2026-12-14' },
    { source: 'booking', summary: 'CLOSED - Not available', start: '2026-12-10', end: '2026-12-14' },
  ])),
  [['LOAM · Γιώργος Νικολάου · 3 άτομα', '2026-12-10', '2026-12-14']]);

eq('an Airbnb stay echoed on Booking shows once',
  brief(ownerEvents([], [
    { source: 'airbnb', summary: 'Reserved', start: '2026-11-01', end: '2026-11-05' },
    { source: 'booking', summary: 'CLOSED - Not available', start: '2026-11-01', end: '2026-11-05' },
  ])),
  [['LOAM · Airbnb', '2026-11-01', '2026-11-05']]);

eq('a Booking stay echoed on Airbnb stays Booking',
  brief(ownerEvents([], [
    { source: 'airbnb', summary: 'Airbnb (Not available)', start: '2026-11-01', end: '2026-11-05' },
    { source: 'booking', summary: 'CLOSED - Not available', start: '2026-11-01', end: '2026-11-05' },
  ])),
  [['LOAM · Booking.com', '2026-11-01', '2026-11-05']]);

eq('only the unclaimed nights of a longer echo survive',
  brief(ownerEvents([direct], [
    { source: 'booking', summary: 'CLOSED - Not available', start: '2026-12-08', end: '2026-12-16' },
  ])),
  [['LOAM · Booking.com', '2026-12-08', '2026-12-10'],
   ['LOAM · Γιώργος Νικολάου · 3 άτομα', '2026-12-10', '2026-12-14'],
   ['LOAM · Booking.com', '2026-12-14', '2026-12-16']]);

eq('back-to-back stays stay separate',
  brief(ownerEvents([], [
    { source: 'airbnb', summary: 'Reserved', start: '2026-11-01', end: '2026-11-05' },
    { source: 'airbnb', summary: 'Reserved', start: '2026-11-05', end: '2026-11-08' },
  ])),
  [['LOAM · Airbnb', '2026-11-01', '2026-11-05'], ['LOAM · Airbnb', '2026-11-05', '2026-11-08']]);

eq('a real double booking shows both',
  brief(ownerEvents([direct], [
    { source: 'airbnb', summary: 'Reserved', start: '2026-12-12', end: '2026-12-15' },
  ])),
  [['LOAM · Γιώργος Νικολάου · 3 άτομα', '2026-12-10', '2026-12-14'],
   ['LOAM · Airbnb', '2026-12-12', '2026-12-15']]);

/* The file itself */
const ics = buildOwnerCalendar([direct], [], new Date('2026-10-30T10:00:00Z'));
const octets = ics.split('\r\n').map(l => Buffer.byteLength(l));
eq('no line is longer than 75 octets', Math.max(...octets) <= 75, true);
eq('folding keeps the Greek intact', unfolded(ics).includes('SUMMARY:LOAM · Γιώργος Νικολάου · 3 άτομα'), true);
eq('line breaks and commas are escaped',
  unfolded(ics).includes('DESCRIPTION:Τηλέφωνο: +30 6987654321\\nΕνήλικες: 2') &&
  unfolded(ics).includes('Με αυτοκίνητο\\, 2 βαλίτσες'), true);
eq('a new line in a note cannot start a new property',
  buildOwnerCalendar([{ ...direct, note: 'α\r\nATTENDEE:x' }], []).includes('\r\nATTENDEE'), false);
eq('dates survive a round trip through the reader',
  parseICS(ics).map(e => [e.start, e.end]), [['2026-12-10', '2026-12-14']]);
eq('stays do not mark the owner busy', ics.includes('TRANSP:TRANSPARENT'), true);
eq('uid is stable and not the public one', ics.includes('UID:b1-owner@loamskg.gr'), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
