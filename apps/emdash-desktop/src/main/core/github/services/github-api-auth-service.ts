import { err, ok, type Result } from '@emdash/shared';
import { normalizeRepositoryHost } from '@shared/repository-ref';
import type { GitHubAccount } from '../accounts/github-account-registry';
import {
  githubApiAccountHostMismatch,
  githubApiAccountNotFound,
  githubApiAuthRequired,
  githubApiTokenMissing,
  type GitHubApiAuthError,
} from './github-api-auth-errors';

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
    const accountId = context.accountId?.trim() || null;
    const account = await this.resolveAccount(normalizedHost, accountId);
    if (!account) return err(githubApiAuthRequired(normalizedHost));
    if (!account.success) return err(account.error);

    const token = await this.accountLookup.resolveToken(account.data.id);
    if (!token) return err(githubApiTokenMissing(normalizedHost, account.data.id));
    return ok(token);
  }

  private async resolveAccount(
    normalizedHost: string,
    accountId: string | null
  ): Promise<Result<GitHubAccount, GitHubApiAuthError> | null> {
    const accounts = await this.accountLookup.listAccounts();
    if (accountId) {
      const account = accounts.find((candidate) => candidate.id === accountId);
      if (!account) return err(githubApiAccountNotFound(normalizedHost, accountId));

      const accountHost = normalizeRepositoryHost(account.host);
      if (accountHost !== normalizedHost) {
        return err(githubApiAccountHostMismatch(normalizedHost, account.id, accountHost));
      }

      return ok(account);
    }

    const defaultAccountId = await this.accountLookup.getDefaultAccountId();
    if (!defaultAccountId) return null;

    const defaultAccount =
      accounts.find(
        (candidate) =>
          candidate.id === defaultAccountId &&
          normalizeRepositoryHost(candidate.host) === normalizedHost
      ) ?? null;
    return defaultAccount ? ok(defaultAccount) : null;
  }
}
