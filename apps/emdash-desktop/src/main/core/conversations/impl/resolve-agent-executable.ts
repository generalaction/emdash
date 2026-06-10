import { resolveCommandPath } from '@main/core/dependencies/probe';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { log } from '@main/lib/logger';
import type { ProviderCustomConfig } from '@shared/core/app-settings';

/**
 * Per-context cache: keyed by `${connectionId ?? 'local'}:${providerId}` → resolved absolute path.
 * Populated on first successful resolution; cleared when a new installation is triggered.
 */
const resolvedPathCache = new Map<string, string>();

export function clearResolvedPathCache(providerId: string, connectionId?: string): void {
  resolvedPathCache.delete(cacheKey(providerId, connectionId));
}

function cacheKey(providerId: string, connectionId?: string): string {
  return `${connectionId ?? 'local'}:${providerId}`;
}

/**
 * Resolve the absolute path of the agent binary to use for conversation spawns.
 *
 * Resolution order:
 * 1. installSource === 'path' and cfg.path is set → use cfg.path if it exists on disk,
 *    otherwise warn and fall through to auto.
 * 2. installSource === 'cli' and cfg.cli is set → return cfg.cli as-is (PTY resolves on PATH).
 * 3. auto (no installSource, or fallthrough from invalid path):
 *    a. In-memory cached path from dependency probe (cachedStatePath).
 *    b. Probe via ctx (resolveCommandPath).
 *    c. Bare binaryName.
 *    d. providerId as last resort.
 */
export async function resolveAgentExecutable({
  providerId,
  cfg,
  binaryName,
  ctx,
  cachedStatePath,
  connectionId,
}: {
  providerId: string;
  cfg: ProviderCustomConfig | undefined;
  binaryName: string;
  ctx: IExecutionContext;
  /** The absolute path the dependency manager resolved during its last probe, if available. */
  cachedStatePath?: string | null;
  connectionId?: string;
}): Promise<string> {
  const source = cfg?.installSource;

  if (source === 'path' && cfg?.path) {
    const exists = await resolveCommandPath(cfg.path, ctx);
    if (exists) return cfg.path;
    log.warn(
      `[resolveAgentExecutable] Saved path "${cfg.path}" for ${providerId} not found — falling back to auto-resolution`
    );
  }

  if (source === 'cli' && cfg?.cli) {
    return cfg.cli;
  }

  // Auto-resolution with in-memory cache
  const key = cacheKey(providerId, connectionId);
  const cached = resolvedPathCache.get(key);
  if (cached) return cached;

  // Use the dependency manager's in-memory probe result if available
  if (cachedStatePath) {
    resolvedPathCache.set(key, cachedStatePath);
    return cachedStatePath;
  }

  // Live resolution via execution context
  const resolved = await resolveCommandPath(binaryName, ctx);
  if (resolved) {
    resolvedPathCache.set(key, resolved);
    return resolved;
  }

  log.warn(
    `[resolveAgentExecutable] Could not resolve binary "${binaryName}" for ${providerId} — using bare name`
  );
  return binaryName || providerId;
}
