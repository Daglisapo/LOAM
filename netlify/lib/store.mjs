import { randomBytes } from 'node:crypto';
import { getStore } from '@netlify/blobs';

const BLOCKS = 'blocks.json';
const CACHE = 'feeds.json';
const FEED_TOKEN = 'owner-feed-token.json';

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

/** The secret in the owner's private calendar link, or null before the first one exists. */
export async function readFeedToken() {
  const saved = await store().get(FEED_TOKEN, { type: 'json' });
  return saved?.token || null;
}

/** Issue a new link. The old one stops working at once. */
export async function rotateFeedToken() {
  const token = randomBytes(24).toString('base64url');
  await store().setJSON(FEED_TOKEN, { token });
  return token;
}

export function passwordOK(given) {
  return sameSecret(given, process.env.ADMIN_PASSWORD);
}

/** Constant-time-ish comparison so a secret cannot be probed by timing. */
export function sameSecret(given, want) {
  if (!want) return false;
  const a = String(given || '');
  if (a.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= a.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}
