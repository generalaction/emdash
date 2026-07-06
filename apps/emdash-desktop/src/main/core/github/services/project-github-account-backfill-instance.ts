import { providerAccountRegistry } from '@main/core/provider-accounts/provider-account-registry-instance';
import { ProjectGitHubAccountBackfillService } from './project-github-account-backfill';

export const projectGitHubAccountBackfillService = new ProjectGitHubAccountBackfillService(
  providerAccountRegistry
);
