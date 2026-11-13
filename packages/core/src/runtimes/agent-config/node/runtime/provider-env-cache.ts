/**
 * Last known per-instance Settings env (e.g. CLAUDE_CONFIG_DIR for a second
 * Claude account), shared across the hooks, auth, and MCP managers within one
 * agent-config runtime. Populated whenever a caller with fresh, authoritative
 * Settings data (the agents wire-controller, on
 * hooksStatus/refreshAuthStatus/startLogin) calls `set`; consulted by
 * operations triggered without fresh data of their own (internally triggered
 * refreshes, and MCP's cross-provider list/save/remove sweeps).
 *
 * `set` is a true set-or-clear: an explicit `undefined` deletes the entry, so
 * a caller that just learned "this instance's override was removed" can
 * actually clear it. Only call `set` when you have authoritative information
 * — a caller that simply doesn't know the current env (no fresh Settings
 * data to report) must not call `set` at all, since passing `undefined` in
 * that case would incorrectly wipe out whatever a different, authoritative
 * caller already warmed for this provider id.
 */
export class ProviderEnvCache {
  private readonly byProvider = new Map<string, Record<string, string>>();
  private readonly listeners = new Set<(providerId: string) => void>();

  get(providerId: string): Record<string, string> | undefined {
    return this.byProvider.get(providerId);
  }

  set(providerId: string, env: Record<string, string> | undefined): void {
    const previous = this.byProvider.get(providerId);
    if (env === undefined) this.byProvider.delete(providerId);
    else this.byProvider.set(providerId, env);
    if (envKey(previous) === envKey(env)) return;
    for (const listener of this.listeners) listener(providerId);
  }

  /**
   * Called with the provider id whenever `set` actually changes that
   * provider's env content (setting an identical env is not a change).
   * Returns an unsubscribe function.
   */
  onChange(listener: (providerId: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  clear(): void {
    this.byProvider.clear();
  }
}

function envKey(env: Record<string, string> | undefined): string | undefined {
  if (env === undefined) return undefined;
  return JSON.stringify(Object.entries(env).sort(([a], [b]) => a.localeCompare(b)));
}
