/**
 * Migration 5 (spec: github-git-settings §10): the app-wide
 * `localProject.defaultWorktreeDirectory` setting is retired in favor of the
 * per-host default (`worktreeRoot` in the host-settings runtime). An explicit
 * app-wide value is copied once into the *local* host default — only when
 * that is still unset — and the app-wide override is then removed.
 *
 * Runs lazily from the settings provider read path. Throws on host-settings
 * failures so the caller retries on a later read; the app-wide override is
 * only cleared after the copy (or the decision not to copy) succeeded.
 */

export type AppWorktreeRootMigrationDeps = {
  /** Explicit app-wide override, or undefined when the user never set one. */
  getAppDefaultWorktreeDirectoryOverride(): Promise<string | undefined>;
  clearAppDefaultWorktreeDirectory(): Promise<void>;
  localHostSettings: {
    getWorktreeRoot(): Promise<
      { success: true; worktreeRoot: string | undefined } | { success: false }
    >;
    setWorktreeRoot(worktreeRoot: string): Promise<{ success: boolean }>;
  };
};

export async function migrateAppWorktreeRootToLocalHostDefault(
  deps: AppWorktreeRootMigrationDeps
): Promise<void> {
  const override = await deps.getAppDefaultWorktreeDirectoryOverride();
  if (override === undefined) return;

  const trimmed = override.trim();
  if (trimmed) {
    const current = await deps.localHostSettings.getWorktreeRoot();
    if (!current.success) {
      throw new Error('app worktree-root migration: local host settings unavailable');
    }
    if (current.worktreeRoot === undefined) {
      const updated = await deps.localHostSettings.setWorktreeRoot(trimmed);
      if (!updated.success) {
        throw new Error('app worktree-root migration: failed to write local host default');
      }
    }
  }

  await deps.clearAppDefaultWorktreeDirectory();
}
