import { todayISO } from '../lib/ical.mjs';
import { readBlocks, writeBlocks, passwordOK } from '../lib/store.mjs';

/* Admin CRUD for manually closed dates. Guarded by ADMIN_PASSWORD; the page
   that calls it also lives behind an unguessable URL, but the password is what
   actually protects writes. */

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export default async (req) => {
  // header only — a key in the query string would leak into logs and referrers
  if (!passwordOK(req.headers.get('x-loam-key'))) return json({ error: 'unauthorised' }, 401);

  if (req.method === 'GET') {
    return json({ blocks: await readBlocks() });
  }

  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }

    // delete
    if (body.remove) {
      const list = (await readBlocks()).filter(b => b.id !== body.remove);
      await writeBlocks(list);
      return json({ ok: true, blocks: list });
    }

    // create
    const { start, end, note } = body;
    if (!ISO.test(start || '') || !ISO.test(end || '')) return json({ error: 'dates must be YYYY-MM-DD' }, 400);
    if (end <= start) return json({ error: 'end must be after start' }, 400);
    if (start < todayISO()) return json({ error: 'start is in the past' }, 400);

    const list = await readBlocks();
    // reject an overlap rather than silently double-booking ourselves
    const clash = list.find(b => start < b.end && b.start < end);
    if (clash) return json({ error: `overlaps ${clash.start} → ${clash.end}` }, 409);

    list.push({
      id: 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      start, end,
      note: String(note || '').slice(0, 120),
      createdAt: new Date().toISOString(),
    });
    list.sort((a, b) => a.start.localeCompare(b.start));
    await writeBlocks(list);
    return json({ ok: true, blocks: list });
  }

  return json({ error: 'method not allowed' }, 405);
};

export const config = { path: '/api/blocks' };
