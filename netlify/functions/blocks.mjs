import { todayISO } from '../lib/ical.mjs';
import { ownerEvents } from '../lib/ownerfeed.mjs';
import { cleanGuest } from '../lib/ledger.mjs';
import { readBlocks, writeBlocks, readCache, passwordOK, readFeedToken, rotateFeedToken } from '../lib/store.mjs';

/* Admin CRUD for manually closed dates. Guarded by ADMIN_PASSWORD; the page
   that calls it also lives behind an unguessable URL, but the password is what
   actually protects writes. */

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/* Guest details for a direct booking. They are only ever returned by this
   password-guarded endpoint — calendar.ics and /api/availability are public
   and must never carry them. Cleaned by the same rules as the books. */

export default async (req) => {
  // header only — a key in the query string would leak into logs and referrers
  if (!passwordOK(req.headers.get('x-loam-key'))) return json({ error: 'unauthorised' }, 401);

  if (req.method === 'GET') {
    const blocks = await readBlocks();
    const cache = await readCache();
    // one entry per stay, so the month grid can mark each check-out on its own
    // even when two guests of the same platform change over on one day
    const stays = ownerEvents(blocks, cache?.ranges || [])
      .map(({ source, start, end, title, closed }) => ({ source, start, end, title, closed: !!closed }));
    return json({
      blocks,
      stays,
      feedToken: (await readFeedToken()) || (await rotateFeedToken()),
    });
  }

  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }

    // replace the private calendar link
    if (body.rotateFeed) return json({ ok: true, feedToken: await rotateFeedToken() });

    // delete
    if (body.remove) {
      const list = (await readBlocks()).filter(b => b.id !== body.remove);
      await writeBlocks(list);
      return json({ ok: true, blocks: list });
    }

    // create, or edit when body.update names an existing block
    const list = await readBlocks();
    const old = body.update ? list.find(b => b.id === body.update) : null;
    if (body.update && !old) return json({ error: 'booking not found' }, 404);

    const { start, end, note } = body;
    if (!ISO.test(start || '') || !ISO.test(end || '')) return json({ error: 'dates must be YYYY-MM-DD' }, 400);
    if (end <= start) return json({ error: 'end must be after start' }, 400);
    // an edit may keep a start that has since passed: the stay is under way
    if (start < todayISO() && !(old && start === old.start)) return json({ error: 'start is in the past' }, 400);

    // reject an overlap rather than silently double-booking ourselves
    const clash = list.find(b => b !== old && start < b.end && b.start < end);
    if (clash) return json({ error: `overlaps ${clash.start} → ${clash.end}` }, 409);

    let guest;
    try { guest = cleanGuest(body.guest); } catch (e) { return json({ error: e.message }, 400); }

    const entry = {
      id: old ? old.id : 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      start, end,
      note: String(note || '').slice(0, 500),
      createdAt: old ? old.createdAt : new Date().toISOString(),
    };
    if (guest) entry.guest = guest;
    if (old) entry.updatedAt = new Date().toISOString();

    const next = old ? list.map(b => (b === old ? entry : b)) : [...list, entry];
    next.sort((a, b) => a.start.localeCompare(b.start));
    await writeBlocks(next);
    return json({ ok: true, blocks: next });
  }

  return json({ error: 'method not allowed' }, 405);
};

export const config = { path: '/api/blocks' };
