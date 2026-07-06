import { providerAccountRegistry } from '@main/core/provider-accounts/provider-account-registry-instance';
import { KV } from '@main/db/kv';
import {
  GitHubKvAccountBackfillService,
  type LegacyKvGitHubAccount,
} from './github-kv-account-backfill';

type GitHubAccountsKVSchema = {
  accounts: LegacyKvGitHubAccount[];
  defaultAccountId: string | null;
};

const githubAccountsKV = new KV<GitHubAccountsKVSchema>('githubAccounts');

export const githubKvAccountBackfillService = new GitHubKvAccountBackfillService(
  providerAccountRegistry,
  {
    getAccounts: () => githubAccountsKV.get('accounts'),
    getDefaultAccountId: () => githubAccountsKV.get('defaultAccountId'),
    clear: () => githubAccountsKV.clear(),
  }
);
