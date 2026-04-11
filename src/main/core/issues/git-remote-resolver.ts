import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type ParsedGitRemote = {
  host: string;
  slug: string;
};

export async function getOriginRemoteUrl(projectPath: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin'], {
      cwd: projectPath,
      encoding: 'utf8',
    });
    const remote = String(stdout || '').trim();
    if (!remote) {
      throw new Error('No remote URL found for origin.');
    }
    return remote;
  } catch {
    throw new Error('No remote URL found for origin.');
  }
}

export function parseGitRemoteUrl(remoteUrl: string): ParsedGitRemote | null {
  const raw = String(remoteUrl || '').trim();
  if (!raw) return null;

  const scpLike = /^git@([^:]+):(.+?)(?:\.git)?$/.exec(raw);
  if (scpLike) {
    return {
      host: scpLike[1].toLowerCase(),
      slug: scpLike[2].replace(/\/+$/, ''),
    };
  }

  if (raw.startsWith('ssh://')) {
    try {
      const parsed = new URL(raw);
      const slug = parsed.pathname
        .replace(/^\/+/, '')
        .replace(/\.git$/, '')
        .replace(/\/+$/, '');
      if (!slug) return null;
      return { host: parsed.hostname.toLowerCase(), slug };
    } catch {
      return null;
    }
  }

  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    try {
      const parsed = new URL(raw);
      const slug = parsed.pathname
        .replace(/^\/+/, '')
        .replace(/\.git$/, '')
        .replace(/\/+$/, '');
      if (!slug) return null;
      return { host: parsed.hostname.toLowerCase(), slug };
    } catch {
      return null;
    }
  }

  return null;
}

export async function resolveOriginRemote(projectPath: string): Promise<ParsedGitRemote> {
  const remoteUrl = await getOriginRemoteUrl(projectPath);
  const remote = parseGitRemoteUrl(remoteUrl);
  if (!remote) {
    throw new Error('Unable to parse git remote URL from origin.');
  }
  return remote;
}
