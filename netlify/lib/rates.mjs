import { getStore } from '@netlify/blobs';
import { DEFAULT_RATES } from './pricing.mjs';

export { DEFAULT_RATES, rateFor, quote } from './pricing.mjs';

const KEY = 'rates.json';

function store() {
  return getStore({ name: 'loam-calendar', consistency: 'strong' });
}

export async function readRates() {
  try {
    const raw = await store().get(KEY, { type: 'json' });
    return raw && typeof raw === 'object' ? { ...DEFAULT_RATES, ...raw } : { ...DEFAULT_RATES };
  } catch {
    return { ...DEFAULT_RATES };
  }
}

export async function writeRates(rates) {
  await store().setJSON(KEY, rates);
}
