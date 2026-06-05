import { normalizeRepositoryHost } from '@shared/repository-ref';
import { err, ok, type Result } from '@shared/result';
import type { GitHubAccount } from '../accounts/github-account-registry';
import { githubApiAuthRequired, type GitHubApiAuthError } from './github-api-auth-errors';

export type GitHubApiAuthContext = {
  accountId?: string;
};

type GitHubAccountLookup = {
  getDefaultAccountId(): Promise<string | null>;
  listAccounts(): Promise<GitHubAccount[]>;
  resolveToken(accountId: string): Promise<string | null>;
};

export class GitHubApiAuthService {
  constructor(private readonly accountLookup: GitHubAccountLookup) {}

  async getToken(
    host: string,
    context: GitHubApiAuthContext = {}
  ): Promise<Result<string, GitHubApiAuthError>> {
    const normalizedHost = normalizeRepositoryHost(host);
    const account = await this.resolveAccount(normalizedHost, context.accountId?.trim() || null);
    if (!account) return err(githubApiAuthRequired(normalizedHost));

    const token = await this.accountLookup.resolveToken(account.id);
    if (!token) return err(githubApiAuthRequired(normalizedHost));
    return ok(token);
  }

  private async resolveAccount(
    normalizedHost: string,
    accountId: string | null
  ): Promise<GitHubAccount | null> {
    const accounts = await this.accountLookup.listAccounts();
    if (accountId) {
      return (
        accounts.find(
          (candidate) =>
            candidate.id === accountId && normalizeRepositoryHost(candidate.host) === normalizedHost
        ) ?? null
      );
    }

    const defaultAccountId = await this.accountLookup.getDefaultAccountId();
    if (!defaultAccountId) return null;

    return (
      accounts.find(
        (candidate) =>
          candidate.id === defaultAccountId &&
          normalizeRepositoryHost(candidate.host) === normalizedHost
      ) ?? null
    );
  }
}
