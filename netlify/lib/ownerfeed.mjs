import { esc, fold, nightsOf, stamp, toRanges } from './ical.mjs';

/* Every stay from the three sources, merged. Feeds the owner's phone calendar
   and the owner page's month grid. Pure, so it can be tested with `node`.

   Neither platform re-exports a calendar it imported: the live feeds carry no
   direct night in either export and no Airbnb stay in Booking's. So when two
   stays claim the same night it is a real conflict, and both are kept for the
   owner to see.

   The exception is Airbnb's "Not available". It is a closed date, not a guest:
   Airbnb also closes the current day, which lands on top of whoever is in the
   apartment. Those only fill nights that no stay claims. */

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

// Booking's export says "CLOSED - Not available" for a guest and for a closed
// date alike, so every Booking event has to count as a stay.
const closed = r => r.source === 'airbnb' && !/reserved/i.test(r.summary || '');
const PLATFORM = { airbnb: 'LOAM · Airbnb', booking: 'LOAM · Booking.com' };

/** One entry per stay, plus whatever Airbnb has closed that no stay covers. */
export function ownerEvents(blocks, ranges) {
  const events = blocks.map(b => ({
    uid: b.id,
    source: 'direct',
    start: b.start,
    end: b.end,
    title: directTitle(b),
    description: directDetails(b),
  }));

  const stays = ranges.filter(r => !closed(r));
  for (const r of stays) {
    events.push({ uid: `${r.source}-${r.start}`, source: r.source, start: r.start, end: r.end, title: PLATFORM[r.source] });
  }

  const taken = nightsOf([...blocks, ...stays]);
  for (const r of ranges.filter(closed)) {
    const free = [...nightsOf([r])].filter(d => !taken.has(d));
    for (const part of toRanges(free)) {
      events.push({
        uid: `airbnb-${part.start}`, source: 'airbnb', closed: true,
        start: part.start, end: part.end, title: 'LOAM · Airbnb (κλειστό)',
      });
    }
    for (const d of free) taken.add(d);
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
