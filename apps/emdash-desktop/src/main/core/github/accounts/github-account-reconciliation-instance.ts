import { log } from '@main/lib/logger';
import { githubAccountBackfillService } from './github-account-backfill-instance';
import { GitHubAccountReconciliationService } from './github-account-reconciliation';
import { githubCliAccountImportService } from './github-cli-account-import-instance';

export const githubAccountReconciliationService = new GitHubAccountReconciliationService({
  legacyBackfill: githubAccountBackfillService,
  cliImporter: githubCliAccountImportService,
  logger: log,
});
