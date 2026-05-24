import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DEFAULT_REMOTE_NAME } from '@shared/git-utils';
import { parseRepositoryRef } from '@shared/repository-ref';

const execFileAsync = promisify(execFile);

export type ParsedGitRemote = {
  host: string;
  slug: string;
};

export async function getRemoteUrl(projectPath: string, remoteName: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['remote', 'get-url', remoteName], {
      cwd: projectPath,
      encoding: 'utf8',
    });
    const remote = String(stdout || '').trim();
    if (!remote) {
      throw new Error(`No remote URL found for ${remoteName}.`);
    }
    return remote;
  } catch {
    throw new Error(`No remote URL found for ${remoteName}.`);
  }
}

export function parseGitRemoteUrl(remoteUrl: string): ParsedGitRemote | null {
  const ref = parseRepositoryRef(remoteUrl);
  return ref ? { host: ref.host, slug: ref.nameWithOwner } : null;
}

export async function resolvePreferredRemote(
  projectPath: string,
  configuredRemote?: string
): Promise<ParsedGitRemote> {
  const preferredRemote = configuredRemote?.trim();
  if (preferredRemote && preferredRemote !== DEFAULT_REMOTE_NAME) {
    try {
      const preferredUrl = await getRemoteUrl(projectPath, preferredRemote);
      const preferred = parseGitRemoteUrl(preferredUrl);
      if (!preferred) {
        throw new Error(`Unable to parse git remote URL from ${preferredRemote}.`);
      }
      return preferred;
    } catch {}
  }

  const originUrl = await getRemoteUrl(projectPath, DEFAULT_REMOTE_NAME);
  const origin = parseGitRemoteUrl(originUrl);
  if (!origin) {
    throw new Error(`Unable to parse git remote URL from ${DEFAULT_REMOTE_NAME}.`);
  }
  return origin;
}
