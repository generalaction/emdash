import { githubConnectionService } from '../services/github-connection-service';
import { GitHubAccountBackfillService } from './github-account-backfill';
import { githubAccountRegistry } from './github-account-registry-instance';

export const githubAccountBackfillService = new GitHubAccountBackfillService(
  githubAccountRegistry,
  githubConnectionService
);
