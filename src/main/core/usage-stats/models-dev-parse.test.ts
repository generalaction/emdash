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
    google: { models: { 'gemini-x': { cost: { input: 1 } } } }, // non-anthropic/openai — now priced
  } as unknown as ModelsDevApi;

  it('maps every provider model cost to a vendor-scoped per-1M rate', () => {
    const map = parseModelsDevApi(api);
    expect(map.get('anthropic:claude-opus-4-8')).toMatchObject({
      input: 5,
      output: 25,
      cacheRead: 0.5,
      cacheWrite: 6.25,
    });
    expect(map.get('openai:gpt-5.5')).toMatchObject({ input: 5, output: 30, cacheRead: 0.5 });
    expect(map.get('google:gemini-x')).toMatchObject({ input: 1 }); // every provider, not just two
  });

  it('extracts the long-context tier (size + above-threshold rates)', () => {
    const rate = parseModelsDevApi(api).get('openai:gpt-5.5');
    expect(rate?.tierSize).toBe(272_000);
    expect(rate?.tier).toMatchObject({ input: 10, output: 45, cacheRead: 1 });
  });

  it('skips models without a cost field', () => {
    const map = parseModelsDevApi(api);
    expect(map.has('openai:no-cost-model')).toBe(false);
  });
});
