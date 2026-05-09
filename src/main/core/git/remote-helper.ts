export function isSshRemoteUrl(remoteUrl: string): boolean {
  return /^git@[^:]+:/i.test(remoteUrl) || /^ssh:\/\//i.test(remoteUrl);
}

export function isGitHubSshRemoteUrl(remoteUrl: string): boolean {
  return (
    /^git@github\.com:/i.test(remoteUrl) || /^ssh:\/\/git@github\.com(?::\d+)?\//i.test(remoteUrl)
  );
}
