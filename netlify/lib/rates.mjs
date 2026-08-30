import { getStore } from '@netlify/blobs';
import { DEFAULT_RATES, SEASON_PRESET } from './pricing.mjs';

export { DEFAULT_RATES, rateFor, minStayFor, seasonFor, quote, orthodoxEaster, SEASON_PRESET } from './pricing.mjs';

const KEY = 'rates.json';

function store() {
  return getStore({ name: 'loam-calendar', consistency: 'strong' });
}

export async function readRates() {
  try {
    const raw = await store().get(KEY, { type: 'json' });
    const merged = raw && typeof raw === 'object' ? { ...DEFAULT_RATES, ...raw } : { ...DEFAULT_RATES };
    // a store written before seasons existed has none; fall back to the plan
    if (!merged.seasons || !merged.seasons.length) merged.seasons = SEASON_PRESET;
    return merged;
  } catch {
    return { ...DEFAULT_RATES };
  }
}

export async function writeRates(rates) {
  await store().setJSON(KEY, rates);
}
