import { encryptedAppSecretsStore } from '@main/core/secrets/encrypted-app-secrets-store';
import { KV } from '@main/db/kv';
import {
  GitHubAccountRegistry,
  type GitHubAccount,
  type GitHubRemovedCliAccount,
} from './github-account-registry';

type GitHubAccountsKVSchema = {
  accounts: GitHubAccount[];
  defaultAccountId: string | null;
  removedCliAccounts: GitHubRemovedCliAccount[];
};

const githubAccountsKV = new KV<GitHubAccountsKVSchema>('githubAccounts');

const metadataStore = {
  getAccounts(): Promise<GitHubAccount[] | null> {
    return githubAccountsKV.get('accounts');
  },
  setAccounts(accounts: GitHubAccount[]): Promise<void> {
    return githubAccountsKV.setOrThrow('accounts', accounts);
  },
  getDefaultAccountId(): Promise<string | null> {
    return githubAccountsKV.get('defaultAccountId');
  },
  setDefaultAccountId(accountId: string | null): Promise<void> {
    return githubAccountsKV.setOrThrow('defaultAccountId', accountId);
  },
  getRemovedCliAccounts(): Promise<GitHubRemovedCliAccount[] | null> {
    return githubAccountsKV.get('removedCliAccounts');
  },
  setRemovedCliAccounts(accounts: GitHubRemovedCliAccount[]): Promise<void> {
    return githubAccountsKV.setOrThrow('removedCliAccounts', accounts);
  },
};

export const githubAccountRegistry = new GitHubAccountRegistry(
  metadataStore,
  encryptedAppSecretsStore
);
