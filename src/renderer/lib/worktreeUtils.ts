/**
 * Pool prewarming is now handled automatically by EnvironmentProviderManager in the main
 * process when a project is bootstrapped or added. This function is intentionally a no-op.
 */
export function prewarmWorktreeReserve(
  _projectId: string,
  _projectPath: string,
  _isGitRepo: boolean | undefined,
  _baseRef?: string
): void {}
