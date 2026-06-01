import { describe, expect, it } from 'vitest';
import { costOf, isPriced, normalizeModelFamily } from './pricing';

describe('normalizeModelFamily', () => {
  it('maps known families by substring, including future versions', () => {
    expect(normalizeModelFamily('claude-opus-4-8')).toBe('opus');
    expect(normalizeModelFamily('claude-opus-4-9-future')).toBe('opus'); // never silently $0
    expect(normalizeModelFamily('claude-sonnet-4-6')).toBe('sonnet');
    expect(normalizeModelFamily('claude-haiku-4-5-20251001')).toBe('haiku');
    expect(normalizeModelFamily('gpt-5.4-mini')).toBe('gpt5mini');
    expect(normalizeModelFamily('gpt-5.5')).toBe('gpt5');
    expect(normalizeModelFamily('codex-auto-review')).toBe('gpt5');
  });

  it('returns null for unknown models', () => {
    expect(normalizeModelFamily('llama-3')).toBeNull();
    expect(isPriced('llama-3')).toBe(false);
    expect(isPriced('claude-opus-4-8')).toBe(true);
  });
});

describe('costOf', () => {
  it('prices each bucket per million tokens', () => {
    // opus: input 5, output 25, cacheRead 0.5, cacheWrite 6.25 (per 1M)
    const cost = costOf(
      { input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheWrite: 1_000_000 },
      'claude-opus-4-8'
    );
    expect(cost).toBeCloseTo(5 + 25 + 0.5 + 6.25, 6);
  });

  it('returns 0 for unpriced models', () => {
    expect(costOf({ input: 9e9, output: 9e9, cacheRead: 0, cacheWrite: 0 }, 'llama-3')).toBe(0);
  });
});
