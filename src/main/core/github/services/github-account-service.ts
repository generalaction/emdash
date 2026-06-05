import type { GitHubAccountSummary, GitHubImportCliAccountsResponse } from '@shared/github';
import type {
  GitHubAccount as StoredGitHubAccount,
  GitHubAccountRegistry,
} from './github-account-registry';
import type { GitHubCliAccountImportService } from './github-cli-account-import';

type GitHubAccountStore = Pick<
  GitHubAccountRegistry,
  'getDefaultAccountId' | 'listAccounts' | 'removeAccount' | 'setDefaultAccountId'
>;

type GitHubCliAccountImporter = Pick<GitHubCliAccountImportService, 'importAccounts'>;

export class GitHubAccountService {
  constructor(
    private readonly accountStore: GitHubAccountStore,
    private readonly cliAccountImporter: GitHubCliAccountImporter
  ) {}

  async listAccounts(): Promise<GitHubAccountSummary[]> {
    const [accounts, defaultAccountId] = await Promise.all([
      this.accountStore.listAccounts(),
      this.accountStore.getDefaultAccountId(),
    ]);
    return accounts.map((account) => this.toAccountSummary(account, defaultAccountId));
  }

  async importCliAccounts(): Promise<Extract<GitHubImportCliAccountsResponse, { success: true }>> {
    const imported = await this.cliAccountImporter.importAccounts();
    const importedAccountIds = [...new Set(imported.map((account) => account.id))];
    return {
      success: true,
      accounts: await this.listAccounts(),
      importedAccountIds,
    };
  }

  async setDefaultAccount(accountId: string): Promise<GitHubAccountSummary | null> {
    const account = await this.accountStore.setDefaultAccountId(accountId);
    if (!account) return null;
    return this.toAccountSummary(account, account.id);
  }

  async removeAccount(accountId: string): Promise<GitHubAccountSummary[] | null> {
    const accounts = await this.accountStore.listAccounts();
    if (!accounts.some((account) => account.id === accountId)) return null;

    await this.accountStore.removeAccount(accountId);
    return this.listAccounts();
  }

  private toAccountSummary(
    account: StoredGitHubAccount,
    defaultAccountId: string | null
  ): GitHubAccountSummary {
    return {
      accountId: account.id,
      host: account.host,
      login: account.login,
      avatarUrl: account.avatarUrl,
      credentialSource: account.credentialSource,
      isDefault: account.id === defaultAccountId,
    };
  }
}
