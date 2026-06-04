import { encryptedAppSecretsStore } from '@main/core/secrets/encrypted-app-secrets-store';
import { KV } from '@main/db/kv';
import { GitHubAccountRegistry, type GitHubAccount } from './github-account-registry';

type GitHubAccountsKVSchema = {
  accounts: GitHubAccount[];
};

const githubAccountsKV = new KV<GitHubAccountsKVSchema>('githubAccounts');

const metadataStore = {
  get(): Promise<GitHubAccount[] | null> {
    return githubAccountsKV.get('accounts');
  },
  set(accounts: GitHubAccount[]): Promise<void> {
    return githubAccountsKV.set('accounts', accounts);
  },
};

export const githubAccountRegistry = new GitHubAccountRegistry(
  metadataStore,
  encryptedAppSecretsStore
);
