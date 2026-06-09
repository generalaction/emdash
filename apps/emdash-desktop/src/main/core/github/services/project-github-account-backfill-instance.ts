import { githubAccountRegistry } from '../accounts/github-account-registry-instance';
import { ProjectGitHubAccountBackfillService } from './project-github-account-backfill';

export const projectGitHubAccountBackfillService = new ProjectGitHubAccountBackfillService(
  githubAccountRegistry
);
