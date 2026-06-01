import type { TokenBuckets } from '@shared/usage';

/** Date the bundled rate table was last reviewed. Surfaced in the UI. */
export const PRICING_UPDATED = '2026-05-31';

type Rates = { input: number; output: number; cacheRead: number; cacheWrite: number };

// Per MILLION tokens. Anthropic rates from the Readout pricing reference;
// OpenAI gpt-5 rates are approximate published API rates (editable here).
const FAMILY_RATES: Record<string, Rates> = {
  opus: { input: 5.0, output: 25.0, cacheRead: 0.5, cacheWrite: 6.25 },
  sonnet: { input: 3.0, output: 15.0, cacheRead: 0.3, cacheWrite: 3.75 },
  haiku: { input: 1.0, output: 5.0, cacheRead: 0.1, cacheWrite: 1.25 },
  gpt5mini: { input: 0.25, output: 2.0, cacheRead: 0.025, cacheWrite: 0 },
  gpt5: { input: 1.25, output: 10.0, cacheRead: 0.125, cacheWrite: 0 },
};

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

export function isPriced(model: string): boolean {
  return normalizeModelFamily(model) !== null;
}

export function costOf(b: TokenBuckets, model: string): number {
  const family = normalizeModelFamily(model);
  if (!family) return 0;
  const r = FAMILY_RATES[family];
  return (
    (b.input / 1e6) * r.input +
    (b.output / 1e6) * r.output +
    (b.cacheRead / 1e6) * r.cacheRead +
    (b.cacheWrite / 1e6) * r.cacheWrite
  );
}
