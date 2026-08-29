/* Minimal RFC 5545 reader, scoped to what Airbnb and Booking.com actually emit:
   VEVENTs with all-day DTSTART/DTEND and a SUMMARY. Deliberately not a general
   iCalendar library — no recurrence, no timezones, no alarms. */

/** Undo RFC 5545 line folding: a CRLF followed by space or tab continues the line. */
function unfold(text) {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
}

/** "20260912" or "20260912T140000Z" -> "2026-09-12" */
function toDate(value) {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(value.trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

export function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function todayISO(tz = 'Europe/Athens') {
  // en-CA formats as YYYY-MM-DD, which is what we want
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
}

/**
 * Parse an .ics document into busy ranges.
 * DTEND in iCalendar is *exclusive* — for a stay it is the check-out day, which
 * is not itself a booked night. We keep that convention throughout.
 * @returns {{start:string,end:string,summary:string}[]}
 */
export function parseICS(text) {
  const out = [];
  const lines = unfold(String(text)).split('\n');
  let cur = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') {
      if (cur && cur.start) {
        // a DTEND-less event is a single day
        out.push({
          start: cur.start,
          end: cur.end && cur.end > cur.start ? cur.end : addDays(cur.start, 1),
          summary: cur.summary || '',
        });
      }
      cur = null;
      continue;
    }
    if (!cur) continue;

    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const name = line.slice(0, colon).split(';')[0].toUpperCase();
    const value = line.slice(colon + 1);

    if (name === 'DTSTART') cur.start = toDate(value);
    else if (name === 'DTEND') cur.end = toDate(value);
    else if (name === 'SUMMARY') cur.summary = value.replace(/\\,/g, ',').replace(/\\n/gi, ' ').trim();
  }
  return out.filter(e => e.start && e.end);
}

/** Expand ranges into the set of individual booked nights. */
export function nightsOf(ranges) {
  const set = new Set();
  for (const r of ranges) {
    for (let d = r.start; d < r.end; d = addDays(d, 1)) set.add(d);
    if (set.size > 5000) break; // guard against a malformed far-future DTEND
  }
  return set;
}

/** Collapse a sorted list of dates back into contiguous [start, end) ranges. */
export function toRanges(dates) {
  const sorted = [...dates].sort();
  const out = [];
  for (const d of sorted) {
    const last = out[out.length - 1];
    if (last && addDays(last.end, 0) === d) last.end = addDays(d, 1);
    else out.push({ start: d, end: addDays(d, 1) });
  }
  return out;
}

/** Fetch one feed, tolerating failure — one dead feed must not blank the calendar. */
export async function fetchFeed(url, source, timeoutMs = 10000) {
  if (!url) return { source, ok: false, error: 'not configured', ranges: [] };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      headers: { 'User-Agent': 'loamskg.gr calendar sync' },
    });
    if (!res.ok) return { source, ok: false, error: `HTTP ${res.status}`, ranges: [] };
    const body = await res.text();
    if (!/BEGIN:VCALENDAR/i.test(body)) {
      return { source, ok: false, error: 'not an iCalendar feed', ranges: [] };
    }
    return { source, ok: true, ranges: parseICS(body).map(r => ({ ...r, source })) };
  } catch (e) {
    return { source, ok: false, error: e.name === 'AbortError' ? 'timeout' : String(e.message || e), ranges: [] };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Close the gaps nobody could book anyway.
 *
 * An iCal feed only carries blocks; it says nothing about minimum-stay rules.
 * So a one-night hole between two bookings arrives looking free, while the OTA
 * greys it out because the listing needs at least `minStay` nights. Showing it
 * as available invites a request we would have to refuse.
 *
 * A free run is only closed when it is walled in on both sides. The open-ended
 * run at the end of the horizon is left alone.
 *
 * @param {Set<string>} busy   booked nights
 * @param {string} from        first night to consider
 * @param {string} to          exclusive end of the window
 * @param {number} minStay     nights required by the listing
 * @returns {Set<string>}      nights that are unbookable but not booked
 */
export function unbookableGaps(busy, from, to, minStay) {
  const gaps = new Set();
  if (!minStay || minStay < 2) return gaps;

  let run = [];
  for (let d = from; d < to; d = addDays(d, 1)) {
    if (busy.has(d)) {
      // the run just ended against a wall; the start of the window counts as one
      if (run.length && run.length < minStay) for (const g of run) gaps.add(g);
      run = [];
    } else {
      run.push(d);
    }
  }
  // trailing run stays open — the future is not a wall
  return gaps;
}

/** Escape a text value for output in an .ics file. */
export function esc(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}
