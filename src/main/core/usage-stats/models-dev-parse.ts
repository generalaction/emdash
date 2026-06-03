import type { ModelRate } from './pricing';

type ModelsDevCost = {
  input?: number;
  output?: number;
  cache_read?: number;
  cache_write?: number;
  tiers?: Array<{
    input?: number;
    output?: number;
    cache_read?: number;
    cache_write?: number;
    tier?: { size?: number };
  }>;
};
type ModelsDevModel = { cost?: ModelsDevCost };
type ModelsDevProvider = { models?: Record<string, ModelsDevModel> };
export type ModelsDevApi = Record<string, ModelsDevProvider>;

/**
 * Pure: turn the models.dev api.json shape into a `${vendor}:${modelId}` -> ModelRate map
 * (per-1M rates). Keying by provider keeps two vendors that share a model id from colliding,
 * and ingesting every provider means non-Anthropic/OpenAI models (e.g. Pi on Google) still price.
 */
export function parseModelsDevApi(api: ModelsDevApi): Map<string, ModelRate> {
  const map = new Map<string, ModelRate>();
  for (const [providerId, provider] of Object.entries(api ?? {})) {
    const models = provider?.models ?? {};
    for (const [id, model] of Object.entries(models)) {
      const c = model?.cost;
      if (!c || typeof c.input !== 'number') continue;
      const rate: ModelRate = {
        input: c.input,
        output: c.output ?? 0,
        cacheRead: c.cache_read ?? 0,
        cacheWrite: c.cache_write ?? 0,
      };
      const tier = c.tiers?.[0];
      if (tier?.tier?.size) {
        rate.tierSize = tier.tier.size;
        rate.tier = {
          input: tier.input ?? rate.input,
          output: tier.output ?? rate.output,
          cacheRead: tier.cache_read ?? rate.cacheRead,
          cacheWrite: tier.cache_write ?? rate.cacheWrite,
        };
      }
      map.set(`${providerId.toLowerCase()}:${id}`, rate);
    }
  }
  return map;
}
