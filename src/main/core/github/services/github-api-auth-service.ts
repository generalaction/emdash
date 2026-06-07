import { err, ok, type Result } from '@shared/lib/result';
import { isGitHubDotComHost, normalizeRepositoryHost } from '@shared/repository-ref';
import { ghCliGitHubEnterpriseAuthSource } from './ghes-auth-source';
import { githubApiAuthRequired, type GitHubApiAuthError } from './github-api-auth-errors';
import { githubConnectionService } from './github-connection-service';

export class GitHubApiAuthService {
  async getToken(host: string): Promise<Result<string, GitHubApiAuthError>> {
    const normalizedHost = normalizeRepositoryHost(host);
    const token = isGitHubDotComHost(normalizedHost)
      ? await githubConnectionService.getToken()
      : await ghCliGitHubEnterpriseAuthSource.getToken(normalizedHost);

    if (!token) return err(githubApiAuthRequired(normalizedHost));
    return ok(token);
  }
}

export const githubApiAuthService = new GitHubApiAuthService();
