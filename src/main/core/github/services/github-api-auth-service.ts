import { normalizeRepositoryHost, isGitHubDotComHost } from '@shared/repository-ref';
import { err, ok, type Result } from '@shared/result';
import { ghCliGitHubEnterpriseAuthSource } from './ghes-auth-source';
import { githubConnectionService } from './github-connection-service';

export type GitHubApiAuthError = {
  type: 'auth_required';
  host: string;
  message: string;
  hint?: string;
};

function authRequired(host: string): GitHubApiAuthError {
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

export class GitHubApiAuthService {
  async getToken(host: string): Promise<Result<string, GitHubApiAuthError>> {
    const normalizedHost = normalizeRepositoryHost(host);
    const token = isGitHubDotComHost(normalizedHost)
      ? await githubConnectionService.getToken()
      : await ghCliGitHubEnterpriseAuthSource.getToken(normalizedHost);

    if (!token) return err(authRequired(normalizedHost));
    return ok(token);
  }
}

export const githubApiAuthService = new GitHubApiAuthService();
