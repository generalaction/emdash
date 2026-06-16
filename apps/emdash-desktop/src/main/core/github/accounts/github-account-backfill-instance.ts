import { githubIdentityClient } from '../services/github-identity-client';
import { legacyGitHubTokenMigrationStore } from '../services/legacy-github-token-migration-store-instance';
import { GitHubAccountBackfillService } from './github-account-backfill';
import { githubAccountRegistry } from './github-account-registry-instance';

export const githubAccountBackfillService = new GitHubAccountBackfillService(
  githubAccountRegistry,
  legacyGitHubTokenMigrationStore,
  githubIdentityClient
);
