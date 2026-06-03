import { afterEach, describe, expect, it } from 'vitest';
import { costOf, isPriced, normalizeModelFamily, setRemoteRates } from './pricing';

afterEach(() => setRemoteRates(new Map())); // clear remote rates between tests

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
    expect(isPriced('meta', 'llama-3')).toBe(false);
    expect(isPriced('anthropic', 'claude-opus-4-8')).toBe(true);
  });
});

describe('costOf', () => {
  it('prices each bucket per million tokens', () => {
    // opus: input 5, output 25, cacheRead 0.5, cacheWrite 6.25 (per 1M)
    const cost = costOf(
      { input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheWrite: 1_000_000 },
      'anthropic',
      'claude-opus-4-8'
    );
    expect(cost).toBeCloseTo(5 + 25 + 0.5 + 6.25, 6);
  });

  it('returns 0 for unpriced models', () => {
    expect(
      costOf({ input: 9e9, output: 9e9, cacheRead: 0, cacheWrite: 0 }, 'meta', 'llama-3')
    ).toBe(0);
  });
});

describe('costOf with remote (models.dev) rates', () => {
  it('prefers an exact remote rate over the bundled family rate', () => {
    // models.dev gpt-5.5 is 5/30/0.5 — far higher than the bundled gpt5 family (1.25/10/0.125)
    setRemoteRates(
      new Map([['openai:gpt-5.5', { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0 }]])
    );
    const cost = costOf(
      { input: 1_000_000, output: 1_000_000, cacheRead: 0, cacheWrite: 0 },
      'openai',
      'gpt-5.5'
    );
    expect(cost).toBeCloseTo(5 + 30, 6); // not the bundled 1.25 + 10
  });

  it('falls back to the bundled family when the model is not in the remote table', () => {
    setRemoteRates(
      new Map([['openai:gpt-5.5', { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0 }]])
    );
    // claude-opus-4-8 absent from remote -> bundled opus rate (5/25)
    const cost = costOf(
      { input: 1_000_000, output: 1_000_000, cacheRead: 0, cacheWrite: 0 },
      'anthropic',
      'claude-opus-4-8'
    );
    expect(cost).toBeCloseTo(5 + 25, 6);
  });

  it('applies the long-context tier when the prompt exceeds the threshold', () => {
    setRemoteRates(
      new Map([
        [
          'openai:gpt-5.5',
          {
            input: 5,
            output: 30,
            cacheRead: 0.5,
            cacheWrite: 0,
            tierSize: 272_000,
            tier: { input: 10, output: 45, cacheRead: 1, cacheWrite: 0 },
          },
        ],
      ])
    );
    // prompt = input + cacheRead = 300k > 272k -> tier rates apply to the whole request
    const over = costOf(
      { input: 300_000, output: 0, cacheRead: 0, cacheWrite: 0 },
      'openai',
      'gpt-5.5'
    );
    expect(over).toBeCloseTo((300_000 / 1e6) * 10, 6); // tier input rate 10
    // prompt = 100k < 272k -> base rate
    const under = costOf(
      { input: 100_000, output: 0, cacheRead: 0, cacheWrite: 0 },
      'openai',
      'gpt-5.5'
    );
    expect(under).toBeCloseTo((100_000 / 1e6) * 5, 6); // base input rate 5
  });
});
