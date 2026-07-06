import { providerAccountRegistry } from '@main/core/provider-accounts/provider-account-registry-instance';
import { githubIdentityClient } from '../services/github-identity-client';
import { legacyGitHubTokenMigrationStore } from '../services/legacy-github-token-migration-store-instance';
import { GitHubAccountBackfillService } from './github-account-backfill';

export const githubAccountBackfillService = new GitHubAccountBackfillService(
  providerAccountRegistry,
  legacyGitHubTokenMigrationStore,
  githubIdentityClient
);
