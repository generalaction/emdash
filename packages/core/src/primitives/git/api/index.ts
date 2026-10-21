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
