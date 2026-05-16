import { createRPCController } from '@shared/ipc/rpc';
import type { ProviderUsageResult } from '@shared/provider-usage';
import { TTLCache } from '@main/core/utils/ttl-cache';
import { fetchClaudeUsage } from './claude-usage';
import { fetchCodexUsage } from './codex-usage';

const CACHE_TTL_MS = 5 * 60 * 1000;

const claudeCache = new TTLCache<ProviderUsageResult>(CACHE_TTL_MS);
const codexCache = new TTLCache<ProviderUsageResult>(CACHE_TTL_MS);

export const providerUsageController = createRPCController({
  get: async (providerId: string): Promise<ProviderUsageResult> => {
    if (providerId === 'claude') return claudeCache.get(fetchClaudeUsage);
    if (providerId === 'codex') return codexCache.get(fetchCodexUsage);
    return { status: 'unsupported' };
  },
  refresh: async (providerId: string): Promise<ProviderUsageResult> => {
    if (providerId === 'claude') {
      claudeCache.invalidate();
      return claudeCache.get(fetchClaudeUsage);
    }
    if (providerId === 'codex') {
      codexCache.invalidate();
      return codexCache.get(fetchCodexUsage);
    }
    return { status: 'unsupported' };
  },
});
