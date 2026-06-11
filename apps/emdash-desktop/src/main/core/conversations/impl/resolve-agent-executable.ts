import type { DependencyId } from '@emdash/shared/deps';
import { resolveCommandPath } from '@emdash/shared/deps/runtime';
import type { IExecutionContext } from '@emdash/shared/exec';
import type { IHostDependencyStore } from '@main/core/dependencies/host-dependency-store';
import { log } from '@main/lib/logger';

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
 * 1. HostDependencySelection.usedId === 'path' and selection.path is set
 *    → use selection.path if it exists on disk, otherwise warn and fall through.
 * 2. HostDependencySelection.usedId === 'cli' and selection.cli is set
 *    → return selection.cli as-is (PTY resolves on PATH).
 * 3. HostDependencySelection.usedId starts with 'method:' → fall through to
 *    cachedStatePath (probe result for the detected method).
 * 4. auto (no selection, or fallthrough from invalid path):
 *    a. In-memory cached path from dependency probe (cachedStatePath).
 *    b. Probe via ctx (resolveCommandPath).
 *    c. Bare binaryName.
 *    d. providerId as last resort.
 */
export async function resolveAgentExecutable({
  providerId,
  binaryName,
  ctx,
  hostDependencyStore,
  cachedStatePath,
  connectionId,
}: {
  providerId: string;
  binaryName: string;
  ctx: IExecutionContext;
  /** Store for reading the persisted host-scoped installation selection. */
  hostDependencyStore: IHostDependencyStore;
  /** The absolute path the dependency manager resolved during its last probe, if available. */
  cachedStatePath?: string | null;
  connectionId?: string;
}): Promise<string> {
  const hostId = connectionId ?? 'local';
  const selection = await hostDependencyStore.getSelection(hostId, providerId as DependencyId);

  if (selection?.usedId === 'path' && selection.path) {
    const exists = await resolveCommandPath(selection.path, ctx);
    if (exists) return selection.path;
    log.warn(
      `[resolveAgentExecutable] Saved path "${selection.path}" for ${providerId} not found — falling back to auto-resolution`
    );
  }

  if (selection?.usedId === 'cli' && selection.cli) {
    return selection.cli;
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
