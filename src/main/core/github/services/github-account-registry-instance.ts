import { encryptedAppSecretsStore } from '@main/core/secrets/encrypted-app-secrets-store';
import { KV } from '@main/db/kv';
import { GitHubAccountRegistry, type GitHubAccount } from './github-account-registry';

type GitHubAccountsKVSchema = {
  accounts: GitHubAccount[];
  defaultAccountId: string | null;
};

const githubAccountsKV = new KV<GitHubAccountsKVSchema>('githubAccounts');

const metadataStore = {
  getAccounts(): Promise<GitHubAccount[] | null> {
    return githubAccountsKV.get('accounts');
  },
  setAccounts(accounts: GitHubAccount[]): Promise<void> {
    return githubAccountsKV.set('accounts', accounts);
  },
  getDefaultAccountId(): Promise<string | null> {
    return githubAccountsKV.get('defaultAccountId');
  },
  setDefaultAccountId(accountId: string | null): Promise<void> {
    return githubAccountsKV.set('defaultAccountId', accountId);
  },
};

export const githubAccountRegistry = new GitHubAccountRegistry(
  metadataStore,
  encryptedAppSecretsStore
);
