import { passwordOK } from '../lib/store.mjs';
import { readRates, writeRates, DEFAULT_RATES } from '../lib/rates.mjs';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const num = (v, min, max) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};

export default async (req) => {
  if (!passwordOK(req.headers.get('x-loam-key'))) return json({ error: 'unauthorised' }, 401);

  if (req.method === 'GET') return json(await readRates());

  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }

  const rates = await readRates();

  // remove a seasonal period
  if (body.remove) {
    rates.periods = (rates.periods || []).filter(p => p.id !== body.remove);
    await writeRates(rates);
    return json({ ok: true, rates });
  }

  // add a seasonal period
  if (body.period) {
    const { start, end, price, label } = body.period;
    if (!ISO.test(start || '') || !ISO.test(end || '')) return json({ error: 'dates must be YYYY-MM-DD' }, 400);
    if (end <= start) return json({ error: 'end must be after start' }, 400);
    const p = num(price, 1, 100000);
    if (p === null) return json({ error: 'price must be a positive number' }, 400);

    rates.periods = rates.periods || [];
    rates.periods.push({
      id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      start, end, price: p, label: String(label || '').slice(0, 60),
    });
    rates.periods.sort((a, b) => a.start.localeCompare(b.start));
    await writeRates(rates);
    return json({ ok: true, rates });
  }

  // update the base settings
  const fields = {
    base: [1, 100000], extraGuest: [0, 10000],
    baseGuests: [1, 20], maxGuests: [1, 20],
    cleaningFee: [0, 10000], minStay: [1, 30],
    directDiscount: [0, 0.9],
  };
  for (const [k, [lo, hi]] of Object.entries(fields)) {
    if (body[k] === undefined) continue;
    const v = num(body[k], lo, hi);
    if (v === null) return json({ error: `${k} is out of range` }, 400);
    rates[k] = v;
  }
  if (rates.maxGuests < rates.baseGuests) {
    return json({ error: 'maxGuests cannot be below baseGuests' }, 400);
  }

  await writeRates(rates);
  return json({ ok: true, rates });
};

export const config = { path: '/api/rates' };
