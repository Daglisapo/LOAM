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
 * Find the free runs too short for their own minimum stay.
 *
 * A two-night hole at Christmas, where the stay must be three, used to be
 * closed as unbookable. But Airbnb and Booking show those nights as free, and a
 * direct request is confirmed by hand anyway, so closing them only hid nights
 * the owner could sell. The hole stays open instead, and its minimum shrinks to
 * its length: a guest takes all of it, so no single night is left stranded.
 *
 * Only a run walled in on both sides counts. The start of the window is a wall;
 * the open-ended run at the end of the horizon is not.
 *
 * @param {Set<string>} busy   nights that cannot be booked
 * @param {string} from        first night to consider
 * @param {string} to          exclusive end of the window
 * @param {function|number} minStayAt  nights required, per date
 * @returns {Map<string,number>}  night -> length of the short run it sits in
 */
export function shortRuns(busy, from, to, minStayAt) {
  const short = new Map();
  const need = typeof minStayAt === 'function' ? minStayAt : () => minStayAt;

  let run = [];
  for (let d = from; d < to; d = addDays(d, 1)) {
    if (busy.has(d)) {
      // the run is measured against the rule for the night it starts on
      if (run.length && run.length < need(run[0])) for (const g of run) short.set(g, run.length);
      run = [];
    } else {
      run.push(d);
    }
  }
  // trailing run stays open — the future is not a wall
  return short;
}

/** Escape a text value for output in an .ics file. */
export function esc(s) {
  return String(s).replace(/\r\n?/g, '\n').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

/** A Date as an iCalendar UTC timestamp. */
export function stamp(d) {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Fold a line to RFC 5545's 75 octets. Greek takes two per letter, so count bytes and never split one. */
export function fold(line) {
  const parts = [];
  let cur = '', size = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch);
    if (size + n > 75) { parts.push(cur); cur = ' '; size = 1; }
    cur += ch;
    size += n;
  }
  parts.push(cur);
  return parts.join('\r\n');
}
