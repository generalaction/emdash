import { describe, expect, it } from 'vitest';
import { parseModelsDevApi, type ModelsDevApi } from './models-dev-parse';

describe('parseModelsDevApi', () => {
  const api = {
    anthropic: {
      models: {
        'claude-opus-4-8': { cost: { input: 5, output: 25, cache_read: 0.5, cache_write: 6.25 } },
      },
    },
    openai: {
      models: {
        'gpt-5.5': {
          cost: {
            input: 5,
            output: 30,
            cache_read: 0.5,
            tiers: [{ input: 10, output: 45, cache_read: 1, tier: { size: 272_000 } }],
          },
        },
        'no-cost-model': { name: 'x' },
      },
    },
    google: { models: { 'gemini-x': { cost: { input: 1 } } } }, // ignored provider
  } as unknown as ModelsDevApi;

  it('maps anthropic + openai model costs to per-1M rates', () => {
    const map = parseModelsDevApi(api);
    expect(map.get('claude-opus-4-8')).toMatchObject({
      input: 5,
      output: 25,
      cacheRead: 0.5,
      cacheWrite: 6.25,
    });
    expect(map.get('gpt-5.5')).toMatchObject({ input: 5, output: 30, cacheRead: 0.5 });
  });

  it('extracts the long-context tier (size + above-threshold rates)', () => {
    const rate = parseModelsDevApi(api).get('gpt-5.5');
    expect(rate?.tierSize).toBe(272_000);
    expect(rate?.tier).toMatchObject({ input: 10, output: 45, cacheRead: 1 });
  });

  it('skips models without a cost and providers we do not price', () => {
    const map = parseModelsDevApi(api);
    expect(map.has('no-cost-model')).toBe(false);
    expect(map.has('gemini-x')).toBe(false); // google not in priced providers
  });
});
