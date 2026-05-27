import { isGitHubDotComHost } from '@shared/repository-ref';

export type GitHubApiAuthError = {
  type: 'auth_required';
  host: string;
  message: string;
  hint?: string;
};

export function githubApiAuthRequired(host: string): GitHubApiAuthError {
  if (isGitHubDotComHost(host)) {
    return { type: 'auth_required', host, message: 'GitHub authentication required.' };
  }
  const hint = `Run: gh auth login --hostname ${host}`;
  return {
    type: 'auth_required',
    host,
    message: `GitHub Enterprise authentication required for ${host}. ${hint}`,
    hint,
  };
}
