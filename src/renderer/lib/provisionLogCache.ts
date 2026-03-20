/**
 * Module-level cache for workspace provisioning logs.
 *
 * Provisioning logs are stored in React state inside WorkspaceProvisioningOverlay,
 * which means they are lost when the component unmounts (e.g. switching tabs).
 * This cache persists logs by task ID so they can be restored on remount.
 */

const cache = new Map<string, string[]>();

export function getProvisionLogs(taskId: string): string[] {
  return cache.get(taskId) ?? [];
}

export function appendProvisionLog(taskId: string, line: string): string[] {
  const existing = cache.get(taskId) ?? [];
  const next = [...existing, line];
  cache.set(taskId, next);
  return next;
}

export function clearProvisionLogs(taskId: string): void {
  cache.delete(taskId);
}

/** For testing only — clears the entire cache. */
export function _resetCache(): void {
  cache.clear();
}
