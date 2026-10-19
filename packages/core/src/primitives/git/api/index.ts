/**
 * Pure Git discovery policy shared by host runtimes. Call only for the initial
 * discovery command, with Git's diagnostic locale fixed to C.
 *
 * Exit 128 also covers broken gitfiles, configuration, ownership and permissions.
 * Only Git's specific discovery-miss diagnostics prove the absence of a repository.
 */
export function isGitDiscoveryMiss(failure: { exitCode: number | null; stderr: string }): boolean {
  if (failure.exitCode !== 128) return false;
  const diagnostic = failure.stderr.trim();
  return (
    diagnostic === 'fatal: not a git repository (or any of the parent directories): .git' ||
    /^fatal: not a git repository \(or any parent up to mount point [^\r\n]+\)\r?\nStopping at filesystem boundary \(GIT_DISCOVERY_ACROSS_FILESYSTEM not set\)\.$/.test(
      diagnostic
    )
  );
}

/**
 * Augments an execution environment for Git commands so that cross-boundary
 * repositories (such as WSL UNC shares `\\wsl.localhost\...` accessed on Windows)
 * are not rejected by Git's safe.directory ownership check (dubious ownership).
 *
 * Only applied on Windows (`win32`) where ownership checks against WSL Linux UIDs
 * fail by default, unless explicit GIT_CONFIG overrides are already present.
 */
export function withSafeGitDirectoryEnv(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform
): NodeJS.ProcessEnv {
  if (platform !== 'win32' || env.GIT_CONFIG_PARAMETERS || env.GIT_CONFIG_COUNT) {
    return env;
  }
  return {
    ...env,
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'safe.directory',
    GIT_CONFIG_VALUE_0: '*',
  };
}
