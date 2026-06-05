import { GitHubAccountBackfillService } from './github-account-backfill';
import { githubAccountRegistry } from './github-account-registry-instance';
import { githubConnectionService } from './github-connection-service';

export const githubAccountBackfillService = new GitHubAccountBackfillService(
  githubAccountRegistry,
  githubConnectionService
);
