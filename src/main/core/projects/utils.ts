export function parseGitHubRepo(remoteUrl: string): { host: string; nameWithOwner: string } | null {
  // https://github.mycompany.com/owner/repo.git
  const httpsMatch = remoteUrl.match(/https?:\/\/(github\.[^/]+)\/([^/]+\/[^/.]+)(?:\.git)?$/);
  if (httpsMatch) {
    return { host: httpsMatch[1], nameWithOwner: httpsMatch[2] };
  }
  // git@github.mycompany.com:owner/repo.git
  const sshMatch = remoteUrl.match(/git@(github\.[^:]+):([^/]+\/[^/.]+)(?:\.git)?$/);
  if (sshMatch) {
    return { host: sshMatch[1], nameWithOwner: sshMatch[2] };
  }
  return null;
}
