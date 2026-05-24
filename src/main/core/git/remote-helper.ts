import { isGitHubDotComHost, parseRepositoryRef } from '@shared/repository-ref';

export function isSshRemoteUrl(remoteUrl: string): boolean {
  return /^git@[^:]+:/i.test(remoteUrl) || /^ssh:\/\//i.test(remoteUrl);
}

export function isGitHubSshRemoteUrl(remoteUrl: string): boolean {
  if (!isSshRemoteUrl(remoteUrl)) return false;
  const ref = parseRepositoryRef(remoteUrl);
  return ref ? isGitHubDotComHost(ref.host) : false;
}
