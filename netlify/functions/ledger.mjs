import { todayISO } from '../lib/ical.mjs';
import {
  readExport, mergeImport, captureStays, ledgerView, summarize, cleanGuest, DEFAULT_SETTINGS,
} from '../lib/ledger.mjs';
import { readBlocks, readCache, readLedger, writeLedger, passwordOK } from '../lib/store.mjs';

/* The owner's books. Every stay, what it earned, what each month cost.
   Guarded by ADMIN_PASSWORD like the rest of the admin API: it holds guests'
   names, tax numbers and passports. */

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const money = (v, min = -100000) => {
  if (v === '' || v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > 100000) throw new Error('bad amount');
  return Math.round(n * 100) / 100;
};

function okSources(cache) {
  return Object.entries(cache?.sources || {}).filter(([, s]) => s.ok).map(([k]) => k);
}

async function payload(ledger) {
  const view = ledgerView(ledger, await readBlocks());
  return {
    reservations: view,
    expenses: ledger.expenses,
    settings: ledger.settings,
    years: summarize(view, ledger.expenses, ledger.settings, todayISO()),
    today: todayISO(),
  };
}

export default async (req) => {
  if (!passwordOK(req.headers.get('x-loam-key'))) return json({ error: 'unauthorised' }, 401);

  const ledger = await readLedger();
  const today = todayISO();

  if (req.method === 'GET' && new URL(req.url).searchParams.get('backup') === '1') {
    return json({ exportedAt: new Date().toISOString(), ledger, blocks: await readBlocks() });
  }

  if (req.method === 'GET') {
    // the sync job records new stays every few minutes; doing it here too means
    // a stay booked a minute ago is already in the list the owner opens
    const cache = await readCache();
    if (cache && captureStays(ledger, cache.ranges || [], today, okSources(cache))) await writeLedger(ledger);
    return json(await payload(ledger));
  }
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }

  try {
    // an uploaded export: preview first, then the same call without dryRun
    if (typeof body.import === 'string') {
      if (body.import.length > 2_000_000) return json({ error: 'file too large' }, 413);
      const { kind, items } = readExport(body.import);
      const report = mergeImport(ledger, items, today);
      if (body.dryRun) return json({ kind, report });
      await writeLedger(ledger);
      return json({ kind, report, ...(await payload(ledger)) });
    }

    // edit one stay. A direct booking's details live in the booking calendar;
    // only the AADE tick is kept here for it.
    if (typeof body.update === 'string') {
      const key = body.update;
      if (key.startsWith('direct:')) {
        ledger.overlay[key] = { ...(ledger.overlay[key] || {}), declared: !!body.declared };
      } else {
        const rec = ledger.records[key];
        if (!rec) return json({ error: 'not found' }, 404);
        if ('declared' in body) rec.declared = !!body.declared;
        if ('ignored' in body) rec.ignored = !!body.ignored;
        if (body.status === 'ok' || body.status === 'cancelled') rec.status = body.status;
        if ('notes' in body) rec.notes = String(body.notes || '').slice(0, 500);
        // the dates the guest really stayed, when they differ from what was sold
        if (body.start || body.end) {
          const start = body.start || rec.start, end = body.end || rec.end;
          if (!ISO.test(start) || !ISO.test(end) || end <= start) return json({ error: 'bad dates' }, 400);
          if (start !== rec.start || end !== rec.end) {
            rec.feedStart ||= rec.start;
            rec.start = start; rec.end = end; rec.datesEdited = true;
          }
        }
        if (body.guest) {
          const g = cleanGuest(body.guest) || {};
          if (g.name !== rec.guest?.name) rec.nameEdited = true;
          rec.guest = { ...(rec.guest?.phone4 ? { phone4: rec.guest.phone4 } : {}), ...g };
        }
        if (body.money) {
          const gross = money(body.money.gross, 0), commission = money(body.money.commission, 0) || 0;
          rec.money = gross == null ? null : {
            ...(rec.money || {}), gross, commission, net: money(body.money.net) ?? Math.round((gross - commission) * 100) / 100,
          };
        }
      }
      await writeLedger(ledger);
      return json(await payload(ledger));
    }

    // a stay neither feed nor export carries, typed in by hand
    if (body.create) {
      const c = body.create;
      if (!['airbnb', 'booking'].includes(c.source)) return json({ error: 'source must be airbnb or booking' }, 400);
      if (!ISO.test(c.start || '') || !ISO.test(c.end || '') || c.end <= c.start) return json({ error: 'bad dates' }, 400);
      const key = `${c.source}@${c.start}`;
      if (ledger.records[key]) return json({ error: 'a stay already starts that day' }, 409);
      ledger.records[key] = { key, source: c.source, code: null, start: c.start, end: c.end, origin: 'manual', status: 'ok', firstSeen: today };
      await writeLedger(ledger);
      return json({ key, ...(await payload(ledger)) });
    }

    if (typeof body.remove === 'string') {
      const rec = ledger.records[body.remove];
      // a stay the feed still shows would come straight back; ignoring it is the way
      if (!rec || rec.origin === 'ical') return json({ error: 'only stays added by hand or by import can be deleted' }, 400);
      delete ledger.records[body.remove];
      await writeLedger(ledger);
      return json(await payload(ledger));
    }

    if (body.expense) {
      const e = body.expense;
      if (!MONTH.test(e.month || '')) return json({ error: 'month must be YYYY-MM' }, 400);
      const category = String(e.category || '').trim().slice(0, 60);
      if (!category) return json({ error: 'category required' }, 400);
      const amount = money(e.amount, 0);
      const id = e.id || 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      ledger.expenses = ledger.expenses.filter(x => x.id !== id);
      // an emptied amount removes the line
      if (amount != null) ledger.expenses.push({ id, month: e.month, category, amount, note: String(e.note || '').slice(0, 200) });
      ledger.expenses.sort((a, b) => a.month.localeCompare(b.month) || a.category.localeCompare(b.category));
      await writeLedger(ledger);
      return json(await payload(ledger));
    }

    if (body.settings) {
      const s = body.settings;
      const rate = v => { const n = Number(v); if (!Number.isFinite(n) || n < 0 || n > 100) throw new Error('bad rate'); return n; };
      const next = structuredClone(ledger.settings);
      if (s.takk) next.takk = { high: rate(s.takk.high), low: rate(s.takk.low) };
      if (s.tax) {
        next.tax = {
          base: s.tax.base === 'net' ? 'net' : 'gross',
          brackets: (s.tax.brackets || DEFAULT_SETTINGS.tax.brackets).map((b, i, all) => ({
            upTo: i === all.length - 1 ? null : money(b.upTo, 0),
            rate: rate(b.rate),
          })),
        };
      }
      if ('aadeDirect' in s) next.aadeDirect = !!s.aadeDirect;
      if (Array.isArray(s.categories)) {
        next.categories = [...new Set(s.categories.map(c => String(c).trim().slice(0, 60)).filter(Boolean))].slice(0, 30);
      }
      ledger.settings = next;
      await writeLedger(ledger);
      return json(await payload(ledger));
    }
  } catch (e) {
    return json({ error: String(e.message || e) }, 400);
  }

  return json({ error: 'nothing to do' }, 400);
};

export const config = { path: '/api/ledger' };
