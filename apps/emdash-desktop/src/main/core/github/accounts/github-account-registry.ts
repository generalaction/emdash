import type { GitHubTokenSource } from '@shared/github';
import { normalizeRepositoryHost } from '@shared/repository-ref';

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

export type GitHubRemovedCliAccount = {
  accountId: string;
  host: string;
  removedAt: number;
};

export type GitHubAccountUpsert = {
  accessToken: string;
  credentialSource: GitHubAccountCredentialSource;
  providerAccount: GitHubProviderAccount;
};

export type GitHubAccountUpsertResult = {
  account: GitHubAccount;
  status: 'created' | 'updated';
};

export type GitHubAccountMetadataStore = {
  getAccounts(): Promise<GitHubAccount[] | null>;
  setAccounts(accounts: GitHubAccount[]): Promise<void>;
  getDefaultAccountId(): Promise<string | null>;
  setDefaultAccountId(accountId: string | null): Promise<void>;
  getRemovedCliAccounts(): Promise<GitHubRemovedCliAccount[] | null>;
  setRemovedCliAccounts(accounts: GitHubRemovedCliAccount[]): Promise<void>;
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

  async upsertAccount(input: GitHubAccountUpsert): Promise<GitHubAccountUpsertResult> {
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
    const nextAccounts = existing
      ? accounts.map((account) => (account.id === id ? next : account))
      : [...accounts, next];
    await this.metadataStore.setAccounts(nextAccounts);
    await this.clearRemovedCliAccount(id);
    await this.ensureDefaultAccount(nextAccounts);
    return {
      account: next,
      status: existing ? 'updated' : 'created',
    };
  }

  async listAccounts(): Promise<GitHubAccount[]> {
    return (await this.metadataStore.getAccounts()) ?? [];
  }

  async getDefaultAccountId(): Promise<string | null> {
    const [accounts, storedDefaultAccountId] = await Promise.all([
      this.listAccounts(),
      this.metadataStore.getDefaultAccountId(),
    ]);
    const defaultAccount = storedDefaultAccountId
      ? accounts.find((account) => account.id === storedDefaultAccountId)
      : undefined;
    if (defaultAccount) return defaultAccount.id;

    const fallback = this.oldestAccount(accounts)?.id ?? null;
    if (fallback !== storedDefaultAccountId) {
      await this.metadataStore.setDefaultAccountId(fallback);
    }
    return fallback;
  }

  async setDefaultAccountId(accountId: string): Promise<GitHubAccount | null> {
    const account = (await this.listAccounts()).find((candidate) => candidate.id === accountId);
    if (!account) return null;
    await this.metadataStore.setDefaultAccountId(account.id);
    return account;
  }

  async resolveToken(accountId: string): Promise<string | null> {
    return this.secretStore.getSecret(this.tokenSecretKey(accountId));
  }

  async listRemovedCliAccounts(): Promise<GitHubRemovedCliAccount[]> {
    return (await this.metadataStore.getRemovedCliAccounts()) ?? [];
  }

  async removeAccount(accountId: string): Promise<void> {
    const accounts = await this.listAccounts();
    const removedAccount = accounts.find((account) => account.id === accountId);
    const nextAccounts = accounts.filter((account) => account.id !== accountId);
    await Promise.all([
      this.metadataStore.setAccounts(nextAccounts),
      this.secretStore.deleteSecret(this.tokenSecretKey(accountId)),
    ]);
    if (removedAccount?.credentialSource === 'cli') {
      await this.addRemovedCliAccount(removedAccount);
    }
    const defaultAccountId = await this.metadataStore.getDefaultAccountId();
    if (defaultAccountId === accountId) {
      await this.metadataStore.setDefaultAccountId(this.oldestAccount(nextAccounts)?.id ?? null);
    }
  }

  private accountId(providerAccount: GitHubProviderAccount): string {
    return `${this.normalizeHost(providerAccount.host)}:${providerAccount.providerAccountId}`;
  }

  private normalizeHost(host: string): string {
    return normalizeRepositoryHost(host) || 'github.com';
  }

  private tokenSecretKey(accountId: string): string {
    return `github-account-token:${accountId}`;
  }

  private async ensureDefaultAccount(accounts: GitHubAccount[]): Promise<void> {
    const defaultAccountId = await this.metadataStore.getDefaultAccountId();
    if (defaultAccountId && accounts.some((account) => account.id === defaultAccountId)) return;
    await this.metadataStore.setDefaultAccountId(this.oldestAccount(accounts)?.id ?? null);
  }

  private async addRemovedCliAccount(account: GitHubAccount): Promise<void> {
    const tombstone: GitHubRemovedCliAccount = {
      accountId: account.id,
      host: this.normalizeHost(account.host),
      removedAt: Date.now(),
    };
    const tombstones = await this.listRemovedCliAccounts();
    await this.metadataStore.setRemovedCliAccounts([
      ...tombstones.filter((candidate) => candidate.accountId !== account.id),
      tombstone,
    ]);
  }

  private async clearRemovedCliAccount(accountId: string): Promise<void> {
    const tombstones = await this.listRemovedCliAccounts();
    if (!tombstones.some((candidate) => candidate.accountId === accountId)) return;
    await this.metadataStore.setRemovedCliAccounts(
      tombstones.filter((candidate) => candidate.accountId !== accountId)
    );
  }

  private oldestAccount(accounts: GitHubAccount[]): GitHubAccount | undefined {
    return accounts.reduce<GitHubAccount | undefined>((oldest, account) => {
      if (!oldest || account.connectedAt < oldest.connectedAt) return account;
      return oldest;
    }, undefined);
  }
}
