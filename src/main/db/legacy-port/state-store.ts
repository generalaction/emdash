import type { LegacyPortStateStore } from './service';

type LegacyPortKvSchema = {
  status: Awaited<ReturnType<LegacyPortStateStore['getStatus']>>;
};

export async function createLegacyPortStateStore(): Promise<LegacyPortStateStore> {
  const { KV } = await import('../kv');
  const kv = new KV<LegacyPortKvSchema>('legacyPort');

  return {
    getStatus: async () => kv.get('status'),
    setStatus: async (status) => kv.set('status', status),
  };
}
