import { isGitHubDotComHost, normalizeRepositoryHost } from '@shared/repository-ref';
import { err, ok, type Result } from '@shared/result';
import { ghCliGitHubEnterpriseAuthSource } from './ghes-auth-source';
import { githubAccountRegistry } from './github-account-registry-instance';
import { githubApiAuthRequired, type GitHubApiAuthError } from './github-api-auth-errors';
import { githubConnectionService } from './github-connection-service';

export type GitHubApiAuthContext = {
  accountId?: string | null;
};

export class GitHubApiAuthService {
  async getToken(
    host: string,
    context: GitHubApiAuthContext = {}
  ): Promise<Result<string, GitHubApiAuthError>> {
    const normalizedHost = normalizeRepositoryHost(host);
    const token = isGitHubDotComHost(normalizedHost)
      ? await this.getGitHubDotComToken(normalizedHost, context)
      : await ghCliGitHubEnterpriseAuthSource.getToken(normalizedHost);

    if (!token) return err(githubApiAuthRequired(normalizedHost));
    return ok(token);
  }

  private async getGitHubDotComToken(
    normalizedHost: string,
    context: GitHubApiAuthContext
  ): Promise<string | null> {
    const accountId = context.accountId?.trim();
    if (!accountId) return githubConnectionService.getToken();

    const accounts = await githubAccountRegistry.listAccounts();
    const account = accounts.find((candidate) => candidate.id === accountId);
    if (!account || normalizeRepositoryHost(account.host) !== normalizedHost) return null;

    return githubAccountRegistry.resolveToken(account.id);
  }
}

export const githubApiAuthService = new GitHubApiAuthService();
