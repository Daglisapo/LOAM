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
const people = (g) => {
  const count = (g.adults || 0) + (g.children || 0);
  return count ? ` · ${count} ${count === 1 ? 'άτομο' : 'άτομα'}` : '';
};
const lines = rows => rows
  .filter(([, v]) => v != null && v !== '')
  .map(([k, v]) => `${k}: ${v}`)
  .join('\n');

function directTitle(b) {
  const g = b.guest || {};
  return `LOAM · ${String(g.name || b.note || 'Κλειστό').slice(0, 60)}${people(g)}`;
}

function directDetails(b) {
  const g = b.guest || {};
  return lines([
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
  ]);
}

const PLATFORM_NAME = { airbnb: 'Airbnb', booking: 'Booking.com' };

/* A platform stay as the books know it: the name and details typed in or
   imported, with money already net of any refund. */
function platformTitle(v, source) {
  const g = v.guest || {};
  if (!g.name) return `LOAM · ${PLATFORM_NAME[source]}`;
  return `LOAM · ${String(g.name).slice(0, 60)}${people(g)} · ${PLATFORM_NAME[source]}`;
}

function platformDetails(v, source) {
  const g = v.guest || {};
  return lines([
    ['Πλατφόρμα', PLATFORM_NAME[source] + (v.code ? ` · κωδικός ${v.code}` : '')],
    ['Τηλέφωνο', g.phone || (g.phone4 ? `…${g.phone4} (τα 4 τελευταία ψηφία)` : null)],
    ['Email', g.email],
    ['Χώρα', g.country],
    ['Ενήλικες', g.adults],
    ['Παιδιά', g.children],
    ['ΑΦΜ', g.afm],
    ['Ταυτότητα / διαβατήριο', g.idDoc],
    ['Μικτά', v.gross != null ? money(v.gross) : null],
    ['Προμήθεια', v.commission ? money(v.commission) : null],
    ['Καθαρά', v.net != null ? money(v.net) : null],
    ['Σημειώσεις', v.notes],
    ['Κράτηση', source === 'airbnb' && v.code ? `https://www.airbnb.com/hosting/reservations/details/${v.code}` : null],
  ]);
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

/**
 * The stays the owner page draws. The feeds say when; the books say who.
 *
 * Each platform stay takes its guest's name from the ledger record that began
 * on the same day. Stays that have already started are added from the ledger
 * when no feed carries them any more: platforms drop a stay soon after it
 * ends, and a calendar that forgets last week is no use for looking back.
 * Future stays come from the feeds alone, so a booking the platform has
 * cancelled cannot linger here.
 */
export function calendarStays(blocks, ranges, records = [], today = '') {
  const book = records.filter(r => r.source === 'airbnb' || r.source === 'booking');
  const begins = (r, start) => r.start === start || r.feedStart === start;

  const stays = ownerEvents(blocks, ranges).map((e) => {
    if (e.source === 'direct') {
      const b = blocks.find(x => x.id === e.uid);
      // dates closed by hand with no guest and no money are maintenance, not a stay
      const closed = !(b?.guest?.name || b?.guest?.total != null);
      return { source: 'direct', start: e.start, end: e.end, title: e.title, closed, guest: b?.guest?.name || null, blockId: e.uid };
    }
    const rec = e.closed ? null : book.find(r => r.source === e.source && begins(r, e.start));
    return { source: e.source, start: e.start, end: e.end, title: e.title, closed: !!e.closed, guest: rec?.guest?.name || null, key: rec?.key || null };
  });

  for (const r of book) {
    if (r.status !== 'ok' || r.ignored || !(r.start < today)) continue;
    if (stays.some(s => s.source === r.source && !s.closed && begins(r, s.start))) continue;
    stays.push({ source: r.source, start: r.start, end: r.end, title: PLATFORM[r.source], closed: false, guest: r.guest?.name || null, key: r.key });
  }
  return stays.sort((a, b) => a.start.localeCompare(b.start));
}

/**
 * The phone calendar's events: the feeds' stays, named from the books.
 *
 * `books` is the ledger's view of each stay. A platform stay takes its title
 * and details from the entry that began on the same day, as the owner page
 * does; a past stay the feeds have dropped stays on the phone from the books,
 * under the same UID it had while the feed carried it, so it is updated
 * rather than duplicated.
 */
export function phoneEvents(blocks, ranges, books = [], today = '') {
  const platform = books.filter(v => v.source === 'airbnb' || v.source === 'booking');
  const begins = (v, start) => v.start === start || v.feedStart === start;

  const events = ownerEvents(blocks, ranges).map((e) => {
    if (e.source === 'direct' || e.closed) return e;
    const v = platform.find(x => x.source === e.source && begins(x, e.start));
    return v ? { ...e, title: platformTitle(v, e.source), description: platformDetails(v, e.source) } : e;
  });

  for (const v of platform) {
    if (v.status !== 'ok' || v.ignored || !(v.start < today)) continue;
    if (events.some(e => e.source === v.source && !e.closed && begins(v, e.start))) continue;
    events.push({
      uid: `${v.source}-${v.feedStart || v.start}`, source: v.source, start: v.start, end: v.end,
      title: platformTitle(v, v.source), description: platformDetails(v, v.source),
    });
  }
  return events.sort((a, b) => a.start.localeCompare(b.start));
}

export function buildOwnerCalendar(blocks, ranges, now = new Date(), books = [], today = '') {
  const dtstamp = stamp(now);
  const out = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//LOAM Thessaloniki//Owner calendar//EL',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:LOAM — Κρατήσεις',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ];

  for (const e of phoneEvents(blocks, ranges, books, today)) {
    out.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}-owner@loamskg.gr`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;VALUE=DATE:${e.start.replace(/-/g, '')}`,
      `DTEND;VALUE=DATE:${e.end.replace(/-/g, '')}`,
      `SUMMARY:${esc(e.title)}`,
    );
    if (e.description) out.push(`DESCRIPTION:${esc(e.description)}`);
    // a guest in the apartment should not mark the owner as busy
    out.push('TRANSP:TRANSPARENT', 'END:VEVENT');
  }
  out.push('END:VCALENDAR');

  return out.map(fold).join('\r\n') + '\r\n';
}
