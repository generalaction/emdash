import type { GitPlatform } from '../../../shared/git/platform';
import type { NormalizedPrStatus } from '../GitPlatformService';
import { getPlatformConfig, parseStatusResponse } from '../GitPlatformService';
import type { CommandExecutor } from './types';

/**
 * Strip the CLI name prefix (e.g. "gh " or "glab ") from a full command
 * produced by GitPlatformService builders, so it can be passed to execPlatformCli.
 */
export function stripCliPrefix(platform: GitPlatform, fullCmd: string): string {
  const prefix = getPlatformConfig(platform).cli + ' ';
  return fullCmd.startsWith(prefix) ? fullCmd.slice(prefix.length) : fullCmd;
}

/**
 * Parse a JSON array response, extract the first item, and pass it to parseStatusResponse.
 */
export function parseFirstFromList(
  platform: GitPlatform,
  rawJson: string
): NormalizedPrStatus | null {
  try {
    const parsed = JSON.parse(rawJson.trim());
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const firstItemJson = JSON.stringify(parsed[0]);
    return parseStatusResponse(platform, firstItemJson);
  } catch {
    return null;
  }
}

export async function getDefaultBranchFallback(executor: CommandExecutor): Promise<string> {
  try {
    const { stdout } = await executor.exec(
      'git remote show origin | sed -n "/HEAD branch/s/.*: //p"'
    );
    const branch = (stdout || '').trim();
    if (branch) return branch;
  } catch {}

  try {
    const { stdout } = await executor.execGit('symbolic-ref --short refs/remotes/origin/HEAD');
    const line = (stdout || '').trim();
    const last = line.split('/').pop();
    if (last) return last;
  } catch {}

  return 'main';
}
