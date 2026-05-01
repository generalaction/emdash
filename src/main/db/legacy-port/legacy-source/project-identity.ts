import { parseGitHubRepository } from '@shared/github-repository';
import { normalizeLocalPath, normalizeRemotePath } from './normalize';

export function localProjectIdentityKey(projectPath: string): string {
  return `local:${normalizeLocalPath(projectPath)}`;
}

export function sshProjectIdentityKey(fingerprint: string, projectPath: string): string {
  return `ssh:${fingerprint}:${normalizeRemotePath(projectPath)}`;
}

function gitRemoteIdentityKey(remote: string): string | null {
  const input = remote.trim();
  const normalized = (parseGitHubRepository(input)?.repositoryUrl ?? input)
    .replace(/\.git$/i, '')
    .replace(/\/+$/g, '');
  if (!normalized) return null;
  return `git:${normalized.toLowerCase()}`;
}

function githubRepositoryIdentityKey(repository: string): string | null {
  const normalized = repository
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .replace(/\.git$/i, '');
  if (!normalized.includes('/')) return null;
  return gitRemoteIdentityKey(`https://github.com/${normalized}`);
}

export function gitRemoteIdentityKeys(value: string): string[] {
  return [gitRemoteIdentityKey(value), githubRepositoryIdentityKey(value)].filter(
    (key, index, keys): key is string => Boolean(key) && keys.indexOf(key) === index
  );
}
