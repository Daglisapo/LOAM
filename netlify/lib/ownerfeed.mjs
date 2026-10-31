import { esc, fold, nightsOf, stamp, toRanges } from './ical.mjs';

/* The owner's private calendar, for a phone to subscribe to. Pure, so it can be
   tested with `node`.

   The merged view has to show each night once. Airbnb and Booking export dates
   they imported from each other and from our own feed, so one stay can arrive
   three times: as a direct booking, as "Airbnb (Not available)" and as "CLOSED"
   on Booking. Those echoes only keep the nights nothing better has claimed.

   "Reserved" on Airbnb is always a real guest, so it is never trimmed: if it
   overlaps something, that is a double booking and the owner should see both. */

const money = n => n.toLocaleString('el-GR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' €';

function directTitle(b) {
  const g = b.guest || {};
  const who = String(g.name || b.note || 'Κλειστό').slice(0, 60);
  const count = (g.adults || 0) + (g.children || 0);
  if (!count) return `LOAM · ${who}`;
  return `LOAM · ${who} · ${count} ${count === 1 ? 'άτομο' : 'άτομα'}`;
}

function directDetails(b) {
  const g = b.guest || {};
  return [
    ['Τηλέφωνο', g.phone],
    ['Email', g.email],
    ['Χώρα', g.country],
    ['Ενήλικες', g.adults],
    ['Παιδιά', g.children],
    ['ΑΦΜ', g.afm],
    ['Ταυτότητα / διαβατήριο', g.idDoc],
    ['Ώρα άφιξης', g.arrival],
    ['Πηγή', g.source],
    ['Σύνολο', g.total != null ? money(g.total) : null],
    ['Προκαταβολή', g.deposit != null ? money(g.deposit) : null],
    ['Υπόλοιπο', g.total != null ? money(g.total - (g.deposit || 0)) : null],
    ['Πληρωμή', g.payment],
    ['Σημειώσεις', b.note],
  ]
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
}

const reserved = r => r.source === 'airbnb' && /reserved/i.test(r.summary || '');

/** Booking first: its "CLOSED" may be a real stay, Airbnb's "Not available" is not. */
const ECHOES = [
  { title: 'LOAM · Booking.com', match: r => r.source === 'booking' },
  { title: 'LOAM · Airbnb (κλειστό)', match: r => r.source === 'airbnb' && !reserved(r) },
];

/** One entry per stay: direct bookings, then Airbnb stays, then what is left of the echoes. */
export function ownerEvents(blocks, ranges) {
  const events = blocks.map(b => ({
    uid: b.id,
    start: b.start,
    end: b.end,
    title: directTitle(b),
    description: directDetails(b),
  }));

  const stays = ranges.filter(reserved);
  for (const r of stays) {
    events.push({ uid: `airbnb-${r.start}`, start: r.start, end: r.end, title: 'LOAM · Airbnb' });
  }

  const taken = nightsOf([...blocks, ...stays]);
  for (const { title, match } of ECHOES) {
    for (const r of ranges.filter(match)) {
      const free = [...nightsOf([r])].filter(d => !taken.has(d));
      for (const part of toRanges(free)) {
        events.push({ uid: `${r.source}-${part.start}`, start: part.start, end: part.end, title });
      }
      for (const d of free) taken.add(d);
    }
  }
  return events.sort((a, b) => a.start.localeCompare(b.start));
}

export function buildOwnerCalendar(blocks, ranges, now = new Date()) {
  const dtstamp = stamp(now);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//LOAM Thessaloniki//Owner calendar//EL',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:LOAM — Κρατήσεις',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ];

  for (const e of ownerEvents(blocks, ranges)) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}-owner@loamskg.gr`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;VALUE=DATE:${e.start.replace(/-/g, '')}`,
      `DTEND;VALUE=DATE:${e.end.replace(/-/g, '')}`,
      `SUMMARY:${esc(e.title)}`,
    );
    if (e.description) lines.push(`DESCRIPTION:${esc(e.description)}`);
    // a guest in the apartment should not mark the owner as busy
    lines.push('TRANSP:TRANSPARENT', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');

  return lines.map(fold).join('\r\n') + '\r\n';
}
