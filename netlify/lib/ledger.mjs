import { addDays } from './ical.mjs';

/* The owner's books: every stay from every source, what it earned, what the
   month cost. Pure — no storage, no platform — so it can be tested with `node`.

   Neither platform gives an individual host an API, so the ledger is filled
   from three directions:
   - the iCal feeds, read every few minutes, which give dates (and on Airbnb
     the confirmation code) the moment a stay is booked, and are the only
     record of it until the host imports the money;
   - the platforms' own exports, which the host uploads: Airbnb's transaction
     history CSV and Booking's payment statement CSV, matched on code or dates;
   - the host's own hand, for anything neither carries (tax number, passport).

   Direct bookings are not stored here. They live in blocks.json with their
   guest details, and are folded into the view when it is built. */

// ------------------------------------------------------------ guest details

/* Shared with the direct-booking form, so a guest looks the same wherever the
   stay came from. */
const GUEST_TEXT = {
  name: 80, phone: 30, email: 120, country: 60, afm: 20, idDoc: 30,
  arrival: 10, source: 30, payment: 30, phone4: 4,
};
const GUEST_NUM = { adults: [0, 20], children: [0, 20], total: [0, 100000], deposit: [0, 100000] };

export function cleanGuest(g, keys) {
  if (!g || typeof g !== 'object') return null;
  const out = {};
  for (const [k, max] of Object.entries(GUEST_TEXT)) {
    if (keys && !keys.includes(k)) continue;
    const v = String(g[k] ?? '').trim().slice(0, max);
    if (v) out[k] = v;
  }
  for (const [k, [min, max]] of Object.entries(GUEST_NUM)) {
    if (keys && !keys.includes(k)) continue;
    if (g[k] === '' || g[k] == null) continue;
    const n = Number(g[k]);
    if (!Number.isFinite(n) || n < min || n > max) throw new Error(`bad ${k}`);
    out[k] = n;
  }
  return Object.keys(out).length ? out : null;
}

// ------------------------------------------------------------ reading files

/** RFC 4180-ish: quoted fields, doubled quotes, CRLF or LF. */
export function parseCSV(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(f => f !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some(f => f !== '')) rows.push(row);
  return rows;
}

/* Booking's statement arrives double-encoded: UTF-8 bytes read back as
   Latin-1 and saved as UTF-8 again, so "Τύπος" becomes "Î¤Ï…Ï€Î¿Ï‚". Undo it
   only when the text has that tell-tale shape and the result is clean. */
export function repairMojibake(text) {
  if (!/[ÎÏ][\u0080-¿]/.test(text)) return text;
  if ([...text].some(ch => ch.charCodeAt(0) > 0xff)) return text;
  const fixed = Buffer.from(text, 'latin1').toString('utf8');
  return fixed.includes('�') ? text : fixed;
}

const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/* "36,52" is 36.52 and "1,234.50" is 1234.5: Airbnb writes both in one file. */
export function num(v) {
  let s = String(v ?? '').trim().replace(/\s|€/g, '');
  if (!s) return null;
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  else s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const MONTHS = [
  ['ιαν', 1], ['φεβ', 2], ['μαρ', 3], ['απρ', 4], ['μαι', 5], ['ιουν', 6], ['ιουλ', 7],
  ['αυγ', 8], ['σεπ', 9], ['οκτ', 10], ['νοε', 11], ['δεκ', 12],
  ['jan', 1], ['feb', 2], ['mar', 3], ['apr', 4], ['may', 5], ['jun', 6], ['jul', 7],
  ['aug', 8], ['sep', 9], ['oct', 10], ['nov', 11], ['dec', 12],
];
const pad = n => String(n).padStart(2, '0');

/** "2026-10-23", "10/23/2026" (Airbnb) or "23 Οκτ 2026" (Booking) -> "2026-10-23". */
export function toISO(v) {
  const s = String(v || '').trim();
  let m;
  if ((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s))) return `${m[3]}-${pad(m[1])}-${pad(m[2])}`;
  if ((m = /^(\d{1,2})\s+(\S+)\s+(\d{4})$/.exec(s))) {
    const word = fold(m[2]).replace(/\.$/, '');
    const hit = MONTHS.find(([p]) => word.startsWith(p));
    if (hit) return `${m[3]}-${pad(hit[1])}-${pad(m[1])}`;
  }
  return null;
}

function columns(header, wanted) {
  const h = header.map(fold);
  const at = {};
  for (const [key, names] of Object.entries(wanted)) {
    at[key] = h.findIndex(x => names.some(n => x === fold(n) || x.startsWith(fold(n))));
  }
  return row => key => (at[key] >= 0 ? String(row[at[key]] ?? '').trim() : '');
}

const AIRBNB = {
  date: ['Ημερομηνία', 'Date'],
  type: ['Τύπος', 'Type'],
  code: ['Κωδικός επιβεβαίωσης', 'Confirmation code'],
  start: ['Ημερομηνία έναρξης', 'Start date'],
  end: ['Ημερομηνία αναχώρησης', 'End date'],
  nights: ['Διανυκτερεύσεις', 'Nights'],
  guest: ['Επισκέπτης', 'Guest'],
  details: ['Λεπτομέρειες', 'Details'],
  amount: ['Ποσό', 'Amount'],
  fee: ['Προμήθεια υπηρεσιών', 'Service fee', 'Host fee'],
  fastpay: ['Προμήθεια Γρήγορης πληρωμής', 'Fast pay fee'],
  cleaning: ['Κόστος καθαρισμού', 'Cleaning fee'],
  gross: ['Ακαθάριστα έσοδα', 'Gross earnings'],
};

const BOOKING = {
  type: ['Τύπος', 'Type'],
  code: ['Αριθμός κράτησης', 'Reservation number', 'Booking number'],
  start: ['Check-in', 'Arrival'],
  end: ['Checkout', 'Check-out', 'Departure'],
  guest: ['Όνομα επισκέπτη', 'Guest name'],
  status: ['Κατάσταση κράτησης', 'Reservation status'],
  amount: ['Ποσό', 'Amount'],
  commission: ['Προμήθεια', 'Commission'],
  payfee: ['Χρέωση υπηρεσίας Πληρωμών', 'Payments service fee', 'Payment service fee'],
  net: ['Καθαρά', 'Net'],
  paid: ['Ημερομηνία συναλλαγής', 'Transaction date'],
};

/** The template for anything typed up by hand, or by Claude from screenshots. */
export const TEMPLATE = ['source', 'code', 'checkin', 'checkout', 'guest', 'adults', 'children',
  'phone', 'email', 'country', 'afm', 'id_doc', 'gross', 'commission', 'net', 'notes', 'status'];

const isReservation = t => ['κρατηση', 'reservation'].includes(fold(t));

function readAirbnb(rows) {
  const get = columns(rows[0], AIRBNB);
  const byCode = new Map();
  for (const row of rows.slice(1)) {
    const f = get(row);
    const code = f('code');
    if (!code) continue;                                   // payouts carry no code
    const item = byCode.get(code) || { source: 'airbnb', code, adjustments: [] };
    if (isReservation(f('type'))) {
      const fee = (num(f('fee')) || 0) + (num(f('fastpay')) || 0);
      Object.assign(item, {
        start: toISO(f('start')), end: toISO(f('end')),
        guest: f('guest') ? { name: f('guest') } : null,
        money: {
          gross: num(f('gross')), commission: round(fee), net: num(f('amount')),
          cleaning: num(f('cleaning')) || 0,
        },
      });
    } else {
      // a resolution, a refund, an alteration: it moves both what the guest paid
      // and what the host gets
      const amount = num(f('amount'));
      if (amount == null) continue;
      item.adjustments.push({
        type: f('type'), date: toISO(f('date')), details: f('details'),
        amount, gross: num(f('gross')) ?? amount,
      });
      item.start ||= toISO(f('start'));
      item.end ||= toISO(f('end'));
      item.guest ||= f('guest') ? { name: f('guest') } : null;
    }
    byCode.set(code, item);
  }
  return [...byCode.values()].filter(i => i.start && i.end);
}

function readBooking(rows) {
  const get = columns(rows[0], BOOKING);
  const byCode = new Map();
  for (const row of rows.slice(1)) {
    const f = get(row);
    const code = f('code');
    if (!code) continue;
    const item = byCode.get(code) || { source: 'booking', code, adjustments: [] };
    if (isReservation(f('type'))) {
      Object.assign(item, {
        start: toISO(f('start')), end: toISO(f('end')),
        guest: f('guest') ? { name: f('guest') } : null,
        status: /cancel|ακυρ|no.?show/i.test(f('status')) ? 'cancelled' : 'ok',
        money: {
          gross: num(f('amount')),
          commission: round(-(num(f('commission')) || 0) - (num(f('payfee')) || 0)),
          net: num(f('net')),
        },
      });
    } else {
      const amount = num(f('net')) ?? num(f('amount'));
      if (amount == null) continue;
      item.adjustments.push({ type: f('type'), date: toISO(f('paid')), details: '', amount, gross: num(f('amount')) ?? amount });
      item.start ||= toISO(f('start'));
      item.end ||= toISO(f('end'));
    }
    byCode.set(code, item);
  }
  return [...byCode.values()].filter(i => i.start && i.end);
}

function readTemplate(rows) {
  const get = columns(rows[0], Object.fromEntries(TEMPLATE.map(k => [k, [k]])));
  const out = [];
  for (const row of rows.slice(1)) {
    const f = get(row);
    const source = fold(f('source'));
    if (!['airbnb', 'booking', 'direct'].includes(source)) continue;
    const gross = num(f('gross')), commission = num(f('commission')) || 0;
    out.push({
      source: source === 'direct' ? 'other' : source,
      code: f('code') || null,
      start: toISO(f('checkin')), end: toISO(f('checkout')),
      guest: cleanGuest({
        name: f('guest'), adults: num(f('adults')) ?? '', children: num(f('children')) ?? '',
        phone: f('phone'), email: f('email'), country: f('country'), afm: f('afm'), idDoc: f('id_doc'),
      }),
      money: gross == null ? null : { gross, commission, net: num(f('net')) ?? round(gross - commission) },
      // typed-up totals, after any refund or resolution; not a base to adjust
      final: true,
      notes: f('notes'),
      // only a cancellation is stated; an empty column leaves the status alone
      ...(/cancel|ακυρ/i.test(fold(f('status'))) ? { status: 'cancelled' } : {}),
      adjustments: [],
    });
  }
  return out.filter(i => i.start && i.end && i.end > i.start);
}

/** Work out what a file is from its header, and read it. */
export function readExport(rawText) {
  const text = repairMojibake(String(rawText || '').replace(/^﻿/, ''));
  const rows = parseCSV(text);
  if (rows.length < 2) throw new Error('empty file');
  const h = rows[0].map(fold);
  const has = n => h.some(x => x.startsWith(fold(n)));
  if (has('Κωδικός επιβεβαίωσης') || has('Confirmation code')) return { kind: 'airbnb', items: readAirbnb(rows) };
  if (has('Αριθμός κράτησης') || has('Reservation number') || has('Booking number')) return { kind: 'booking', items: readBooking(rows) };
  if (has('source') && has('checkin')) return { kind: 'template', items: readTemplate(rows) };
  throw new Error('unknown file: expected an Airbnb transaction CSV, a Booking statement CSV or the LOAM template');
}

// ------------------------------------------------------------ the ledger

export const DEFAULT_SETTINGS = {
  // Τέλος Ανθεκτικότητας στην Κλιματική Κρίση, per night, for an apartment
  takk: { high: 8, low: 2 },                       // April–October / November–March
  // rental income, 2026 scale; `upTo: null` is the open top bracket
  tax: { base: 'gross', brackets: [{ upTo: 12000, rate: 15 }, { upTo: 24000, rate: 25 }, { upTo: 35000, rate: 35 }, { upTo: null, rate: 45 }] },
  categories: ['Ρεύμα', 'Νερό', 'Internet', 'Κοινόχρηστα', 'Αναλώσιμα'],
  // whether direct bookings count towards the tax estimate, ΤΑΚΚ and declarations
  aadeDirect: false,
};

export function emptyLedger() {
  return { records: {}, overlay: {}, expenses: [], settings: structuredClone(DEFAULT_SETTINGS) };
}

const round = n => Math.round(n * 100) / 100;
const nightsBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

function findRecord(ledger, { source, code, start }) {
  const all = Object.values(ledger.records);
  return (code && all.find(r => r.source === source && r.code === code))
      || all.find(r => r.source === source && (r.start === start || r.feedStart === start) && !(code && r.code && r.code !== code));
}

/** Airbnb's feed links each stay to its reservation page, which names its code. */
export function airbnbDetails(description) {
  const d = String(description || '');
  const code = /reservations\/details\/([A-Z0-9]+)/i.exec(d)?.[1] || null;
  const phone4 = /last 4 digits\)?\s*:\s*(\d{4})/i.exec(d)?.[1] || null;
  return { code, phone4 };
}

/**
 * Record every stay the feeds currently show. Returns true when anything changed.
 *
 * A future stay that was in a working feed and is no longer there was
 * cancelled. One that has started is kept as it is: platforms drop past stays
 * from their feeds after a while, and the ledger is what remembers them.
 */
export function captureStays(ledger, ranges, today, okSources) {
  let changed = false;
  const seen = new Set();
  for (const r of ranges) {
    if (!okSources.includes(r.source)) continue;
    if (r.source === 'airbnb' && !/reserved/i.test(r.summary || '')) continue;   // a closed date, not a guest
    const { code, phone4 } = r.source === 'airbnb' ? airbnbDetails(r.description) : {};
    let rec = findRecord(ledger, { source: r.source, code, start: r.start });
    if (!rec) {
      const key = code ? `${r.source}:${code}` : `${r.source}@${r.start}`;
      rec = ledger.records[key] = {
        key, source: r.source, code, start: r.start, end: r.end, origin: 'ical', status: 'ok',
        guest: phone4 ? { phone4 } : null, firstSeen: today,
      };
      changed = true;
    }
    if (rec.end !== r.end && rec.origin === 'ical' && !rec.datesEdited) { rec.end = r.end; changed = true; }
    if (code && !rec.code) { rec.code = code; changed = true; }
    if (rec.status === 'cancelled' && rec.origin === 'ical') { rec.status = 'ok'; changed = true; }
    seen.add(rec.key);
  }
  for (const rec of Object.values(ledger.records)) {
    if (rec.origin !== 'ical' || !okSources.includes(rec.source)) continue;
    if (rec.start > today && rec.status === 'ok' && !seen.has(rec.key)) { rec.status = 'cancelled'; changed = true; }
  }
  return changed;
}

/** Fold an import into the ledger. Running the same file twice changes nothing. */
export function mergeImport(ledger, items, today) {
  const report = { added: 0, updated: 0, unchanged: 0, rows: [] };
  for (const item of items) {
    const source = item.source === 'other' ? 'direct-import' : item.source;
    let rec = findRecord(ledger, { source, code: item.code, start: item.start });
    const before = rec ? JSON.stringify(rec) : null;
    if (!rec) {
      const key = item.code ? `${source}:${item.code}` : `${source}@${item.start}`;
      rec = ledger.records[key] = { key, source, code: item.code || null, origin: 'import', status: 'ok', firstSeen: today };
    }
    // the platform books the dates it sold; a guest who left early is the host's correction to keep
    if (!rec.datesEdited) { rec.start = item.start; rec.end = item.end; }
    if (item.code) rec.code = item.code;
    if (item.status) rec.status = item.status;
    if (rec.origin === 'ical') rec.origin = 'import';
    if (item.money) {
      rec.money = item.money;
      // final totals replace the adjustments an earlier export recorded, or a
      // refund would be taken off twice
      if (item.final) delete rec.adjustments;
    }
    if (item.notes && !rec.notes) rec.notes = item.notes;
    // the platform's spelling of the name wins only until the host corrects it
    if (item.guest) {
      const g = rec.guest || {};
      for (const [k, v] of Object.entries(item.guest)) if (g[k] == null || (k === 'name' && !rec.nameEdited)) g[k] = v;
      rec.guest = g;
    }
    const adj = rec.adjustments || [];
    for (const a of item.adjustments || []) {
      if (!adj.some(x => x.type === a.type && x.date === a.date && x.amount === a.amount)) adj.push(a);
    }
    if (adj.length) rec.adjustments = adj;

    const after = JSON.stringify(rec);
    const action = !before ? 'added' : before === after ? 'unchanged' : 'updated';
    report[action]++;
    report.rows.push({ action, source, code: rec.code, start: rec.start, end: rec.end, guest: rec.guest?.name || '' });
  }
  return report;
}

// ------------------------------------------------------------ the view

/**
 * One list for the page: platform stays from the ledger, direct ones from the
 * booking calendar. Money is totalled with any adjustments already applied.
 */
export function ledgerView(ledger, blocks) {
  const out = [];
  for (const r of Object.values(ledger.records)) {
    const adj = r.adjustments || [];
    const m = r.money;
    out.push({
      key: r.key, source: r.source === 'direct-import' ? 'direct' : r.source, code: r.code || null,
      start: r.start, end: r.end, nights: nightsBetween(r.start, r.end),
      status: r.status, ignored: !!r.ignored, origin: r.origin,
      guest: r.guest || {}, notes: r.notes || '', declared: !!r.declared,
      hasMoney: !!m,
      gross: m ? round((m.gross || 0) + adj.reduce((s, a) => s + (a.gross ?? a.amount), 0)) : null,
      commission: m ? round(m.commission || 0) : null,
      net: m ? round((m.net || 0) + adj.reduce((s, a) => s + a.amount, 0)) : null,
      adjustments: adj,
    });
  }
  for (const b of blocks) {
    const g = b.guest || {};
    const key = `direct:${b.id}`;
    const over = ledger.overlay[key] || {};
    out.push({
      key, source: 'direct', code: null, start: b.start, end: b.end, nights: nightsBetween(b.start, b.end),
      status: 'ok', ignored: !g.name && g.total == null,   // no guest and no money: closed for maintenance
      origin: 'direct', guest: g, notes: b.note || '', declared: !!over.declared,
      hasMoney: g.total != null, gross: g.total ?? null, commission: g.total != null ? 0 : null, net: g.total ?? null,
      adjustments: [], blockId: b.id,
    });
  }
  return out.sort((a, b) => b.start.localeCompare(a.start));
}

const counts = v => v.status === 'ok' && !v.ignored;

/** A cancelled stay the host was still paid for: money, but no nights, no ΤΑΚΚ. */
export const earnsOnly = v => v.status === 'cancelled' && !v.ignored && v.hasMoney && !!(v.net || v.gross);

/* Which stays the ΑΑΔΕ figures (tax estimate, ΤΑΚΚ, declarations) cover. The
   owner chooses whether direct bookings are among them. */
export const forAade = (v, settings) => v.source !== 'direct' || !!settings.aadeDirect;

export function taxFor(base, brackets) {
  let left = Math.max(0, base), from = 0, tax = 0;
  for (const { upTo, rate } of brackets) {
    const top = upTo == null ? Infinity : upTo;
    const slice = Math.min(left, top - from);
    if (slice <= 0) break;
    tax += slice * rate / 100;
    left -= slice;
    from = top;
  }
  return round(tax);
}

const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/**
 * Month by month, per calendar year. Money is spread over a stay's nights, so a
 * stay across the end of a month counts in both: the occupancy and the euro
 * then describe the same thing.
 */
export function summarize(view, expenses, settings, today) {
  const years = {};
  const base = settings.tax.base === 'net' ? 'net' : 'gross';
  const blank = () => ({
    nights: 0, gross: 0, commission: 0, net: 0, takk: 0, expenses: 0, missing: 0, taxBase: 0,
    bySource: { airbnb: { nights: 0, gross: 0, net: 0 }, booking: { nights: 0, gross: 0, net: 0 }, direct: { nights: 0, gross: 0, net: 0 } },
    byCategory: {},
  });
  const month = (y, m) => {
    years[y] ||= { months: Array.from({ length: 12 }, blank) };
    return years[y].months[m - 1];
  };

  const earn = (row, v, share) => {
    const src = row.bySource[v.source] || row.bySource.direct;
    row.gross += v.gross * share; row.commission += v.commission * share; row.net += v.net * share;
    src.gross += v.gross * share; src.net += v.net * share;
    if (forAade(v, settings)) row.taxBase += v[base] * share;
  };

  for (const v of view.filter(counts)) {
    const n = v.nights || 1;
    const aade = forAade(v, settings);
    for (let d = v.start; d < v.end; d = addDays(d, 1)) {
      const y = +d.slice(0, 4), m = +d.slice(5, 7);
      const row = month(y, m);
      row.nights++;
      if (aade) row.takk += m >= 4 && m <= 10 ? settings.takk.high : settings.takk.low;
      (row.bySource[v.source] || row.bySource.direct).nights++;
      if (!v.hasMoney) { row.missing++; continue; }
      earn(row, v, 1 / n);
    }
  }
  // what a cancellation still paid lands in the month the stay would have begun
  for (const v of view.filter(earnsOnly)) {
    earn(month(+v.start.slice(0, 4), +v.start.slice(5, 7)), v, 1);
  }
  for (const e of expenses) {
    const row = month(+e.month.slice(0, 4), +e.month.slice(5, 7));
    row.expenses += e.amount;
    row.byCategory[e.category] = (row.byCategory[e.category] || 0) + e.amount;
  }

  for (const [y, data] of Object.entries(years)) {
    const yearBase = data.months.reduce((s, r) => s + r.taxBase, 0);
    const tax = taxFor(yearBase, settings.tax.brackets);
    data.months.forEach((r, i) => {
      for (const k of ['gross', 'commission', 'net', 'takk', 'expenses', 'taxBase']) r[k] = round(r[k]);
      for (const s of Object.values(r.bySource)) { s.gross = round(s.gross); s.net = round(s.net); }
      r.tax = yearBase ? round(tax * r.taxBase / yearBase) : 0;
      r.profit = round(r.net - r.expenses - r.takk - r.tax);
      r.days = daysIn(+y, i + 1);
      r.occupancy = round(100 * r.nights / r.days);
    });
    const t = { nights: 0, gross: 0, commission: 0, net: 0, takk: 0, expenses: 0, tax: 0, profit: 0, missing: 0, taxBase: 0, days: 0 };
    for (const r of data.months) for (const k of Object.keys(t)) if (k !== 'days') t[k] += r[k];
    for (const k of Object.keys(t)) t[k] = round(t[k]);
    // Occupancy over the months the apartment was let, not the whole year: a
    // listing that opened in September is not 9% full. The span runs from the
    // first month with a stay to the last, or to this month if that is later.
    const active = data.months.map((r, i) => (r.nights ? i : -1)).filter(i => i >= 0);
    let first = active.length ? active[0] : 0, last = active.length ? active[active.length - 1] : -1;
    if (today && today.slice(0, 4) === y) last = Math.max(last, +today.slice(5, 7) - 1);
    for (let i = first; i <= last; i++) t.days += data.months[i].days;
    t.fromMonth = first;
    t.tax = tax;
    t.profit = round(t.net - t.expenses - t.takk - t.tax);
    t.occupancy = t.days ? round(100 * t.nights / t.days) : 0;
    t.adr = t.nights - t.missing > 0 ? round(t.gross / (t.nights - t.missing)) : 0;
    data.totals = t;
  }
  return years;
}

/** The AADE declaration for a stay is due by the 20th of the month after check-out. */
export function declarationDue(end) {
  const y = +end.slice(0, 4), m = +end.slice(5, 7);
  return m === 12 ? `${y + 1}-01-20` : `${y}-${pad(m + 1)}-20`;
}
