import type { TokenBuckets } from '@shared/usage';

/** Per-MILLION-token rates, with an optional long-context tier (e.g. gpt-5.5 over 272k). */
export type ModelRate = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  tierSize?: number; // prompt tokens (input + cacheRead) above which `tier` applies
  tier?: { input: number; output: number; cacheRead: number; cacheWrite: number };
};

// Bundled fallback by family. Used only when a model isn't in the remote table.
// Anthropic rates are accurate; OpenAI gpt-5 base rates are approximate (remote corrects them).
const FAMILY_RATES: Record<string, ModelRate> = {
  opus: { input: 5.0, output: 25.0, cacheRead: 0.5, cacheWrite: 6.25 },
  sonnet: { input: 3.0, output: 15.0, cacheRead: 0.3, cacheWrite: 3.75 },
  haiku: { input: 1.0, output: 5.0, cacheRead: 0.1, cacheWrite: 1.25 },
  gpt5mini: { input: 0.25, output: 2.0, cacheRead: 0.025, cacheWrite: 0 },
  gpt5: { input: 1.25, output: 10.0, cacheRead: 0.125, cacheWrite: 0 },
};

// Remote rates (models.dev), keyed by exact model id. Empty = bundled-only.
let remoteRates: Map<string, ModelRate> = new Map();

/** Installed by the models.dev loader. Pass an empty map to clear. */
export function setRemoteRates(rates: Map<string, ModelRate>): void {
  remoteRates = rates;
}

/** Current remote rates, so the main process can forward them into the worker (separate module state). */
export function getRemoteRates(): Map<string, ModelRate> {
  return remoteRates;
}

/** Substring match -> family, so new model versions still price instead of costing $0. */
export function normalizeModelFamily(model: string): string | null {
  const m = model.toLowerCase();
  if (m.includes('opus')) return 'opus';
  if (m.includes('sonnet')) return 'sonnet';
  if (m.includes('haiku')) return 'haiku';
  if (m.includes('gpt-5') && m.includes('mini')) return 'gpt5mini';
  if (m.includes('gpt-5') || m.includes('codex')) return 'gpt5';
  return null;
}

/**
 * Resolve a rate by vendor + model: exact `vendor:model` remote -> lowercased remote ->
 * bundled family -> null. Vendor scoping prevents two providers that share a model id from
 * cross-pricing; the family fallback is vendor-agnostic (matched on the model name) so a
 * known-family model still prices when the remote table is missing (e.g. first run, offline).
 */
function rateForModel(vendor: string, model: string): ModelRate | null {
  const v = vendor.toLowerCase();
  const exact = remoteRates.get(`${v}:${model}`);
  if (exact) return exact;
  const lower = remoteRates.get(`${v}:${model.toLowerCase()}`);
  if (lower) return lower;
  const family = normalizeModelFamily(model);
  return family ? FAMILY_RATES[family] : null;
}

export function isPriced(vendor: string, model: string): boolean {
  return rateForModel(vendor, model) !== null;
}

export function costOf(b: TokenBuckets, vendor: string, model: string): number {
  const r = rateForModel(vendor, model);
  if (!r) return 0;
  // Long-context tier: when the request's prompt (non-cached input + cached) exceeds the
  // threshold, the whole request is priced at the tier rates (models.dev "context_over_200k").
  const promptTokens = b.input + b.cacheRead;
  const eff = r.tier && r.tierSize && promptTokens > r.tierSize ? r.tier : r;
  return (
    (b.input / 1e6) * eff.input +
    (b.output / 1e6) * eff.output +
    (b.cacheRead / 1e6) * eff.cacheRead +
    (b.cacheWrite / 1e6) * eff.cacheWrite
  );
}
