import { getStore } from '@netlify/blobs';

const BLOCKS = 'blocks.json';
const CACHE = 'feeds.json';

function store() {
  return getStore({ name: 'loam-calendar', consistency: 'strong' });
}

/** Direct bookings and any dates the host closes by hand. */
export async function readBlocks() {
  try {
    const raw = await store().get(BLOCKS, { type: 'json' });
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

export async function writeBlocks(list) {
  await store().setJSON(BLOCKS, list);
}

/** Cached copy of the remote feeds, so visitors never wait on Airbnb. */
export async function readCache() {
  try {
    return await store().get(CACHE, { type: 'json' });
  } catch {
    return null;
  }
}

export async function writeCache(payload) {
  await store().setJSON(CACHE, payload);
}

/** Constant-time-ish comparison so the admin password cannot be probed by timing. */
export function passwordOK(given) {
  const want = process.env.ADMIN_PASSWORD || '';
  if (!want) return false;
  const a = String(given || '');
  if (a.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= a.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}
