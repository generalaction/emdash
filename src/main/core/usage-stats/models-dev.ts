import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { parseModelsDevApi, type ModelsDevApi } from './models-dev-parse';
import { setRemoteRates, type ModelRate } from './pricing';

const API_URL = 'https://models.dev/api.json';
const TTL_MS = 24 * 60 * 60 * 1000; // 24h
const FETCH_TIMEOUT_MS = 10_000;

type PricingCache = { fetchedAt: number; date: string; rates: Record<string, ModelRate> };

function cachePath(): string {
  return join(app.getPath('userData'), 'models-dev-pricing.json');
}

function readCache(): PricingCache | null {
  try {
    const parsed = JSON.parse(readFileSync(cachePath(), 'utf8')) as PricingCache;
    if (parsed.rates && typeof parsed.fetchedAt === 'number') return parsed;
  } catch {
    /* missing/corrupt */
  }
  return null;
}

/**
 * Ensure the best-available models.dev rates are installed into the pricing module.
 * Uses the on-disk cache immediately; fetches (and rewrites the cache) when stale or
 * missing. Any network failure is non-fatal — we keep the cached/bundled rates.
 */
export async function ensureModelsDevPricing(now: number = Date.now()): Promise<void> {
  const cache = readCache();
  if (cache) {
    setRemoteRates(new Map(Object.entries(cache.rates)), cache.date);
    if (now - cache.fetchedAt < TTL_MS) return; // fresh — no fetch
  }

  try {
    const res = await fetch(API_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return;
    const api = (await res.json()) as ModelsDevApi;
    const map = parseModelsDevApi(api);
    if (map.size === 0) return;
    const date = new Date(now).toISOString().slice(0, 10);
    const next: PricingCache = { fetchedAt: now, date, rates: Object.fromEntries(map) };
    try {
      writeFileSync(cachePath(), JSON.stringify(next));
    } catch {
      /* cache write is best-effort */
    }
    setRemoteRates(map, date);
  } catch {
    /* offline / timeout — keep cached or bundled rates */
  }
}
