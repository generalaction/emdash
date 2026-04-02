import { ipcMain } from 'electron';
import https from 'https';
import { connectionsService } from '../services/ConnectionsService';
import {
  getProviderCustomConfig,
  getAllProviderCustomConfigs,
  updateProviderCustomConfig,
  type ProviderCustomConfig,
} from '../settings';

interface ClaudeModel {
  id: string;
  name: string;
  /**
   * Whether this model supports Claude Code's fast mode (--settings '{"fastMode":true}').
   * Derived from the model ID — currently only Opus models support it.
   * Not returned by the Anthropic API; computed locally.
   */
  supportsFast: boolean;
}

/**
 * Fast mode is documented for Opus models only.
 * The Anthropic API does not expose this capability, so we infer it from the model ID.
 */
function claudeModelSupportsFast(modelId: string): boolean {
  return modelId.toLowerCase().includes('opus');
}

/** Hardcoded fallback list used when the API is unavailable. */
const CLAUDE_FALLBACK_MODELS: ClaudeModel[] = [
  { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', supportsFast: true },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', supportsFast: false },
  { id: 'claude-sonnet-4-6[1m]', name: 'Claude Sonnet 4.6 (1M context)', supportsFast: false },
  { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', supportsFast: false },
];

/** In-memory cache so repeated opens of the modal don't hit the API every time. */
interface ModelCache {
  models: ClaudeModel[];
  expiresAt: number;
}
let claudeModelCache: ModelCache | null = null;
const MODEL_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/** Fetch available models from the Anthropic API. Returns null when unavailable. */
async function fetchAnthropicModels(): Promise<ClaudeModel[] | null> {
  // Prefer a key saved in the provider custom config (e.g. via Settings → Providers)
  // so users who configure Claude that way also get live model lists.
  const configuredKey = getProviderCustomConfig('claude')?.env?.['ANTHROPIC_API_KEY'];
  const apiKey =
    (typeof configuredKey === 'string' && configuredKey.trim() ? configuredKey.trim() : null) ??
    process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: 'api.anthropic.com',
        path: '/v1/models',
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        timeout: 5000,
      },
      (res) => {
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          resolve(null);
          return;
        }
        let data = '';
        res.on('data', (chunk: Buffer) => (data += chunk.toString()));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data) as {
              data?: Array<{ id: string; display_name?: string }>;
            };
            if (!Array.isArray(parsed?.data)) {
              resolve(null);
              return;
            }
            const models: ClaudeModel[] = parsed.data
              .filter((m) => typeof m.id === 'string' && m.id.startsWith('claude-'))
              .map((m) => ({
                id: m.id,
                name: m.display_name || m.id,
                supportsFast: claudeModelSupportsFast(m.id),
              }));
            resolve(models.length > 0 ? models : null);
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.end();
  });
}

export function registerConnectionsIpc() {
  ipcMain.handle(
    'providers:getStatuses',
    async (_event, opts?: { refresh?: boolean; providers?: string[]; providerId?: string }) => {
      const providers =
        Array.isArray(opts?.providers) && opts.providers.length > 0
          ? opts.providers
          : opts?.providerId
            ? [opts.providerId]
            : null;

      try {
        if (opts?.refresh) {
          if (providers && providers.length > 0) {
            for (const id of providers) {
              await connectionsService.checkProvider(id, 'manual');
            }
          } else {
            await connectionsService.refreshAllProviderStatuses();
          }
        }
        const statuses = connectionsService.getCachedProviderStatuses();
        return { success: true, statuses };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  // Get custom config for a specific provider
  ipcMain.handle('providers:getCustomConfig', (_event, providerId: string) => {
    try {
      const config = getProviderCustomConfig(providerId);
      return { success: true, config };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  // Get all custom configs
  ipcMain.handle('providers:getAllCustomConfigs', () => {
    try {
      const configs = getAllProviderCustomConfigs();
      return { success: true, configs };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  // List available models for a provider (currently only 'claude' is supported)
  ipcMain.handle('providers:listModels', async (_event, providerId: string) => {
    if (providerId !== 'claude') {
      return { success: true, models: [] };
    }

    // Return fresh cache when available
    if (claudeModelCache && Date.now() < claudeModelCache.expiresAt) {
      return { success: true, models: claudeModelCache.models };
    }

    try {
      const fetched = await fetchAnthropicModels();
      if (fetched) {
        claudeModelCache = { models: fetched, expiresAt: Date.now() + MODEL_CACHE_TTL_MS };
        return { success: true, models: fetched };
      }
    } catch {
      // fall through
    }

    // API unavailable — return stale cache if we have one, otherwise use hardcoded fallback
    if (claudeModelCache) {
      return { success: true, models: claudeModelCache.models };
    }
    return { success: true, models: CLAUDE_FALLBACK_MODELS };
  });

  // Update custom config for a specific provider
  ipcMain.handle(
    'providers:updateCustomConfig',
    (_event, providerId: string, config: ProviderCustomConfig | undefined) => {
      try {
        updateProviderCustomConfig(providerId, config);
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );
}
