import type { GitHubTokenSource } from '@shared/github';

export type GitHubAccountCredentialSource = Exclude<GitHubTokenSource, null>;

export type GitHubProviderAccount = {
  providerId: 'github';
  providerAccountId: string;
  host: string;
  login: string;
  avatarUrl: string;
};

export type GitHubAccount = {
  id: string;
  providerAccountId: string;
  host: string;
  login: string;
  avatarUrl: string;
  credentialSource: GitHubAccountCredentialSource;
  connectedAt: number;
  updatedAt: number;
};

export type GitHubAccountUpsert = {
  accessToken: string;
  credentialSource: GitHubAccountCredentialSource;
  providerAccount: GitHubProviderAccount;
};

export type GitHubAccountMetadataStore = {
  get(): Promise<GitHubAccount[] | null>;
  set(accounts: GitHubAccount[]): Promise<void>;
};

export type GitHubAccountSecretStore = {
  getSecret(key: string): Promise<string | null>;
  setSecret(key: string, value: string): Promise<void>;
  deleteSecret(key: string): Promise<void>;
};

export class GitHubAccountRegistry {
  constructor(
    private readonly metadataStore: GitHubAccountMetadataStore,
    private readonly secretStore: GitHubAccountSecretStore
  ) {}

  async upsertAccount(input: GitHubAccountUpsert): Promise<GitHubAccount> {
    const now = Date.now();
    const id = this.accountId(input.providerAccount);
    const accounts = await this.listAccounts();
    const existing = accounts.find((account) => account.id === id);
    const next: GitHubAccount = {
      id,
      providerAccountId: input.providerAccount.providerAccountId,
      host: this.normalizeHost(input.providerAccount.host),
      login: input.providerAccount.login,
      avatarUrl: input.providerAccount.avatarUrl,
      credentialSource: input.credentialSource,
      connectedAt: existing?.connectedAt ?? now,
      updatedAt: now,
    };

    await this.secretStore.setSecret(this.tokenSecretKey(id), input.accessToken);
    await this.metadataStore.set(
      existing
        ? accounts.map((account) => (account.id === id ? next : account))
        : [...accounts, next]
    );
    return next;
  }

  async listAccounts(): Promise<GitHubAccount[]> {
    return (await this.metadataStore.get()) ?? [];
  }

  async resolveToken(accountId: string): Promise<string | null> {
    return this.secretStore.getSecret(this.tokenSecretKey(accountId));
  }

  async removeAccount(accountId: string): Promise<void> {
    const accounts = await this.listAccounts();
    await Promise.all([
      this.metadataStore.set(accounts.filter((account) => account.id !== accountId)),
      this.secretStore.deleteSecret(this.tokenSecretKey(accountId)),
    ]);
  }

  private accountId(providerAccount: GitHubProviderAccount): string {
    return `${this.normalizeHost(providerAccount.host)}:${providerAccount.providerAccountId}`;
  }

  private normalizeHost(host: string): string {
    return host.trim().toLowerCase() || 'github.com';
  }

  private tokenSecretKey(accountId: string): string {
    return `github-account-token:${accountId}`;
  }
}
