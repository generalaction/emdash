import type { ProviderAccountStore } from '@core/services/provider-accounts/api/provider-account-store';
import {
  GITHUB_PROVIDER_ID,
  toGitHubAccount,
  type GitHubAccount,
  type GitHubAccountCredentialSource,
} from './github-accounts';

/** Secret key used by released builds for per-account GitHub tokens. */
export function legacyGitHubTokenRef(accountId: string): string {
  return `github-account-token:${accountId}`;
}

/** Account shape written to the `githubAccounts` KV namespace by released builds. */
export type LegacyKvGitHubAccount = {
  id: string;
  providerAccountId: string;
  host: string;
  login: string;
  avatarUrl: string;
  credentialSource: GitHubAccountCredentialSource;
  connectedAt: number;
  updatedAt: number;
};

export type LegacyGitHubAccountsKv = {
  getAccounts(): Promise<LegacyKvGitHubAccount[] | null>;
  getDefaultAccountId(): Promise<string | null>;
  /** Delete the entire namespace, including tombstones and the default pointer. */
  clear(): Promise<void>;
};

/**
 * One-shot startup backfill of GitHub account metadata from the legacy
 * `githubAccounts` KV namespace into `provider_accounts` rows.
 *
 * Metadata-only: tokens already live in the secrets store under
 * `github-account-token:<id>`, so each row's credentialRef points at that
 * released key and no secret material is moved. The KV namespace (accounts,
 * default pointer, CLI tombstones) is deleted afterwards, which makes the
 * backfill a no-op on every later startup.
 */
export class GitHubKvAccountBackfillService {
  constructor(
    private readonly accounts: Pick<ProviderAccountStore, 'upsertAccount' | 'setDefaultAccount'>,
    private readonly kv: LegacyGitHubAccountsKv
  ) {}

  async backfillFromKv(): Promise<GitHubAccount[]> {
    const stored = (await this.kv.getAccounts()) ?? [];
    const legacyDefaultAccountId = await this.kv.getDefaultAccountId();

    const imported: GitHubAccount[] = [];
    for (const account of stored) {
      if (typeof account?.id !== 'string' || account.id.length === 0) continue;
      const { account: row } = await this.accounts.upsertAccount({
        providerId: GITHUB_PROVIDER_ID,
        accountId: account.id,
        credentialRef: legacyGitHubTokenRef(account.id),
        meta: {
          providerAccountId: account.providerAccountId,
          host: account.host,
          login: account.login,
          avatarUrl: account.avatarUrl,
          credentialSource: account.credentialSource,
        },
      });
      imported.push(toGitHubAccount(row));
    }

    if (
      legacyDefaultAccountId &&
      imported.some((account) => account.id === legacyDefaultAccountId)
    ) {
      await this.accounts.setDefaultAccount(GITHUB_PROVIDER_ID, legacyDefaultAccountId);
    }

    await this.kv.clear();
    return imported;
  }
}
