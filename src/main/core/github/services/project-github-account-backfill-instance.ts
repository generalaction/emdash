import { githubAccountRegistry } from './github-account-registry-instance';
import { ProjectGitHubAccountBackfillService } from './project-github-account-backfill';

export const projectGitHubAccountBackfillService = new ProjectGitHubAccountBackfillService(
  githubAccountRegistry
);
